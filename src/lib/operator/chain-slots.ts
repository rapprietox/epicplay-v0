// fix/chain-slots: the whole batting-order-slot rule for a chain
// substitution, computed in memory BEFORE any database write, plus the
// write-and-restore-on-failure orchestration. Pure and DB/React-free on
// purpose -- scripts/test-chain-slots.ts calls computeChainSlots and
// applyChainWrites directly, with no server, no Supabase, no React.
//
// The rule (see CLAUDE.md's chain-substitution writeup for the incident
// this fixes):
//   R1. A player already in the lineup (status 'starting', a real
//       batting_order) who moves into another player's slot gives up
//       his own old slot -- it becomes vacated, available to a LATER
//       placement in this same chain.
//   R2. A player entering with no one displaced (landing on an open
//       position) and with no batting_order of his own (a true bench
//       player) takes the slot vacated by whoever most recently held
//       the position he's entering, within this same chain -- or, if
//       that position's own vacator isn't tracked (nobody in this
//       chain held it), any other slot this chain vacated.
//   R3. A bench player replacing a starter (landing on an occupied
//       position) takes that starter's slot -- unchanged from before
//       this fix.
//   R4. A player already in the lineup who moves to an open position
//       (displacing no one) keeps his own slot -- also unchanged.
//
// "This same chain" is the load-bearing phrase: everything a single
// confirmChainSubstitution call touches is visible to this function at
// once, so a move that would otherwise orphan a slot (R1's vacator) and
// the move that would otherwise orphan an entrant (R2's bench player
// with nothing to inherit) can resolve each other within one call. A
// slot vacated by an EARLIER, separate call has nothing left to prove
// this function wrong with -- which is exactly the original bug: Jordan
// moving off P and Owen entering at P were two separate calls, so
// Owen's call had no vacated slot to inherit and silently got null.
// The fix is the validation below refusing to let that call complete on
// its own -- the operator has to extend the same chain (add Owen as a
// positionMoves entry) before the slot math can balance.

export interface SlotRow {
  playerId: string;
  battingOrder: number | null;
  position: string | null;
  status: string;
}

export interface ChainPlacement {
  playerId: string;
  position: string;
}

export interface ChainSlotsInput {
  incomingPlayerId: string;
  entryPosition: string;
  // Kept for the caller's own bookkeeping/chainNote purposes and as a
  // defensive fallback (see the end of computeChainSlots) -- the real
  // in/out pairing is derived from occupancy, not trusted blindly from
  // this field alone, since a multi-hop chain can bench more than one
  // player and this field only ever named one of this codebase's shape.
  outgoingPlayerId: string | null;
  positionMoves: ChainPlacement[];
}

export interface SlotUpdate {
  playerId: string;
  battingOrder: number | null;
  position: string | null;
  status: "starting" | "reserve";
}

export interface SubstitutionPair {
  playerInId: string;
  playerOutId: string;
}

export type ChainSlotsResult =
  | { ok: true; updates: SlotUpdate[]; substitutionPairs: SubstitutionPair[] }
  | { ok: false; emptySlots: number[]; duplicateSlots: number[] };

interface VacatedSlot {
  slot: number;
  fromPosition: string | null;
}

export function computeChainSlots(currentRows: SlotRow[], input: ChainSlotsInput): ChainSlotsResult {
  const working = new Map<string, SlotRow>();
  for (const row of currentRows) working.set(row.playerId, { ...row });

  const placements: ChainPlacement[] = [{ playerId: input.incomingPlayerId, position: input.entryPosition }, ...input.positionMoves];

  const vacatedSlots: VacatedSlot[] = [];
  const substitutionPairs: SubstitutionPair[] = [];
  const touched = new Set<string>();

  for (let i = 0; i < placements.length; i++) {
    const placement = placements[i];
    const mover = working.get(placement.playerId);
    if (!mover) {
      throw new Error(`Cannot complete this substitution: no lineup row found for ${placement.playerId}.`);
    }
    const priorSlot = mover.status === "starting" ? mover.battingOrder : null;
    const priorPosition = mover.position;

    const occupant = Array.from(working.values()).find(
      (row) => row.playerId !== placement.playerId && row.status === "starting" && row.position === placement.position
    );

    let newSlot: number | null;
    if (occupant) {
      // R1/R3: inherit whoever's here now. Capture their slot before
      // anything else touches their row.
      const inheritedSlot = occupant.battingOrder;
      const occupantId = occupant.playerId;
      const occupantMovesLater = placements.some((p, j) => j > i && p.playerId === occupantId);
      if (!occupantMovesLater) {
        // Nothing else in this chain relocates them -- this is where
        // they actually leave the field, and whoever's taking their
        // spot (bench entrant or a repositioned existing starter --
        // R1 and R3 both land here) is recorded as replacing them,
        // regardless of where the mover came from.
        working.set(occupantId, { ...occupant, battingOrder: null, position: null, status: "reserve" });
        touched.add(occupantId);
        substitutionPairs.push({ playerInId: placement.playerId, playerOutId: occupantId });
      }
      newSlot = inheritedSlot;
      if (priorSlot !== null) {
        // R1: the mover was already a starter elsewhere -- that old
        // slot is now up for grabs within this same chain.
        vacatedSlots.push({ slot: priorSlot, fromPosition: priorPosition });
      }
    } else if (priorSlot !== null) {
      // R4: landing on an open spot, displacing no one -- keep the slot
      // already held, nothing vacated.
      newSlot = priorSlot;
    } else {
      // R2: a true bench entrant landing on an open spot. Prefer the
      // slot vacated by whoever held exactly this position earlier in
      // this chain; otherwise take whatever this chain vacated, in
      // the order it was vacated.
      const matchIdx = vacatedSlots.findIndex((v) => v.fromPosition === placement.position);
      const idx = matchIdx !== -1 ? matchIdx : 0;
      if (idx < vacatedSlots.length) {
        newSlot = vacatedSlots[idx].slot;
        vacatedSlots.splice(idx, 1);
      } else {
        // Nothing this chain vacated -- there is genuinely no slot to
        // give this player. Left null on purpose so the validation pass
        // below reports it as an empty slot, rather than this function
        // guessing or throwing here (the caller gets one uniform
        // "slot N has no batter" story, not a mix of exceptions and
        // validation results).
        newSlot = null;
      }
    }

    working.set(placement.playerId, { playerId: placement.playerId, battingOrder: newSlot, position: placement.position, status: "starting" });
    touched.add(placement.playerId);
  }

  // Defensive fallback: the caller's own named outgoingPlayerId should
  // already be covered by occupancy above in every well-formed chain --
  // this only fires if it somehow isn't, so a real out/in pair is never
  // silently dropped from the substitutions table.
  if (input.outgoingPlayerId && !substitutionPairs.some((p) => p.playerOutId === input.outgoingPlayerId)) {
    substitutionPairs.push({ playerInId: input.incomingPlayerId, playerOutId: input.outgoingPlayerId });
  }

  // Validate every slot 1..N -- N is however many numbered slots this
  // lineup had before the chain started (the chain only ever moves
  // existing slot numbers between players, it never invents or retires
  // one), re-checked against the post-chain state too as a pure safety
  // net.
  const workingRows = Array.from(working.values());
  const maxSlot = Math.max(0, ...currentRows.map((r) => r.battingOrder ?? 0), ...workingRows.map((r) => r.battingOrder ?? 0));
  const countBySlot = new Map<number, number>();
  for (const row of workingRows) {
    if (row.status === "starting" && row.battingOrder !== null) {
      countBySlot.set(row.battingOrder, (countBySlot.get(row.battingOrder) ?? 0) + 1);
    }
  }
  const emptySlots: number[] = [];
  const duplicateSlots: number[] = [];
  for (let slot = 1; slot <= maxSlot; slot++) {
    const count = countBySlot.get(slot) ?? 0;
    if (count === 0) emptySlots.push(slot);
    else if (count > 1) duplicateSlots.push(slot);
  }
  if (emptySlots.length > 0 || duplicateSlots.length > 0) {
    return { ok: false, emptySlots, duplicateSlots };
  }

  const updates: SlotUpdate[] = Array.from(touched).map((playerId) => {
    const row = working.get(playerId)!;
    return { playerId, battingOrder: row.battingOrder, position: row.position, status: row.status as "starting" | "reserve" };
  });

  return { ok: true, updates, substitutionPairs };
}

// Shared message builder -- the client (pre-confirm picker) and the
// server (defense-in-depth refusal) both show the operator the exact
// same words for the exact same failure.
export function describeSlotError(result: { emptySlots: number[]; duplicateSlots: number[] }): string {
  const parts: string[] = [];
  for (const slot of result.emptySlots) {
    parts.push(`Slot ${slot} has no batter, choose who bats there.`);
  }
  for (const slot of result.duplicateSlots) {
    parts.push(`Slot ${slot} has two batters assigned -- pick one.`);
  }
  return parts.join(" ");
}

// Write-and-restore-on-failure, expressed against a minimal, injectable
// operations interface rather than the real Supabase client directly --
// this is what makes scripts/test-chain-slots.ts able to prove the
// restore path with a fake that fails on command, with no database and
// no Next.js request context (confirmChainSubstitution itself can't run
// outside one, same reason chain-substitution.ts's pure functions exist
// at all). src/app/operator/actions.ts supplies the real
// Supabase-backed implementation.
export interface ChainWriteOps {
  // status is a plain string, not the narrower SlotUpdate union -- the
  // restore-on-failure path below writes back a player's exact
  // pre-chain status, which (for a mover who came from the bench) can
  // legitimately be 'late_arrival', not just 'starting'/'reserve'.
  updateLineupRow(playerId: string, values: { battingOrder: number | null; position: string | null; status: string }): Promise<void>;
  insertSubstitution(pair: SubstitutionPair): Promise<string>;
  deleteSubstitution(id: string): Promise<void>;
  insertGameEvent(): Promise<string>;
  deleteGameEvent(id: string): Promise<void>;
}

// "Atomic or restored": there's no real multi-table transaction
// available here (no migration in this batch means no Postgres RPC
// function either) -- this is a best-effort compensating-write sequence
// instead. Every lineup row this chain touches is written first; only
// once ALL of them succeed do the substitutions row(s) and the
// game_events row get inserted. If ANYTHING in that sequence throws,
// every lineup row already written this attempt is written back to its
// exact pre-chain value (from `preChainRows`, the same snapshot
// computeChainSlots was given), and any substitutions/game_events rows
// already inserted this attempt are deleted -- leaving the database
// exactly as it was before this confirm, for the caller's existing
// error-banner-with-Retry to act on.
export async function applyChainWrites(
  ops: ChainWriteOps,
  preChainRows: SlotRow[],
  result: { updates: SlotUpdate[]; substitutionPairs: SubstitutionPair[] }
): Promise<void> {
  const appliedPlayerIds: string[] = [];
  const insertedSubstitutionIds: string[] = [];
  let insertedEventId: string | null = null;

  try {
    for (const update of result.updates) {
      await ops.updateLineupRow(update.playerId, { battingOrder: update.battingOrder, position: update.position, status: update.status });
      appliedPlayerIds.push(update.playerId);
    }
    for (const pair of result.substitutionPairs) {
      insertedSubstitutionIds.push(await ops.insertSubstitution(pair));
    }
    insertedEventId = await ops.insertGameEvent();
  } catch (err) {
    const preChainById = new Map(preChainRows.map((r) => [r.playerId, r]));
    for (const playerId of appliedPlayerIds) {
      const original = preChainById.get(playerId);
      if (!original) continue;
      // Best-effort: if even a restore write fails, there's nothing
      // further to do here -- the original error below is still what
      // the operator needs to see and retry.
      try {
        await ops.updateLineupRow(playerId, { battingOrder: original.battingOrder, position: original.position, status: original.status });
      } catch {
        // swallow -- restoring is best-effort, the real error rethrows below
      }
    }
    for (const id of insertedSubstitutionIds) {
      try {
        await ops.deleteSubstitution(id);
      } catch {
        // best-effort, see above
      }
    }
    if (insertedEventId) {
      try {
        await ops.deleteGameEvent(insertedEventId);
      } catch {
        // best-effort, see above
      }
    }
    throw err;
  }
}
