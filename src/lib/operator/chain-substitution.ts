// Pure, framework-free decision logic shared between the operator
// screen's server actions (src/app/operator/actions.ts) and its client
// retry queue (src/lib/operator/sync-queue.ts). Neither file can import
// the other directly without pulling Next.js server internals into the
// client bundle, so the shared piece -- "what does this error mean, and
// what should a repeat substitution submission do" -- lives here instead.
//
// Pulled out as real functions (not duplicated inline) specifically so
// they can be exercised directly in scripts/_prove_stale_writes_fixes.ts
// -- requireOperatorGame/confirmChainSubstitution themselves can't be
// called outside a live Next.js request (createClient() needs
// next/headers' request scope), so proving their logic means proving
// these functions, which the real code paths call unmodified.

// Thrown by requireOperatorGame when a game's status isn't 'active'.
// Matched by exact message on the client (sync-queue.ts) to distinguish
// a permanent rejection from a transient network failure -- Next.js
// Server Actions do propagate a thrown Error's message to the caller,
// so this string is safe to rely on across the server/client boundary.
export const GAME_NOT_ACTIVE_ERROR = "This game is no longer active, so this change can't be saved.";

export function assertGameIsActive(game: { status: string }): void {
  if (game.status !== "active") {
    throw new Error(GAME_NOT_ACTIVE_ERROR);
  }
}

export interface ChainSubstitutionWriteDecision {
  skip: boolean;
  incomingBattingOrder: number | null;
}

// Shared between the outgoing-player branch below and the no-outgoing-
// player branch (resolveIncomingBattingOrderWithoutOutgoing) -- both
// refuse to write a null batting_order onto a row about to become
// status='starting', for the exact same reason, so they share the exact
// same message rather than two copies that could drift apart.
export const NO_BATTING_ORDER_ERROR = "Cannot complete this substitution: no batting order could be determined for the incoming player.";

// Decides what confirmChainSubstitution should do once it has looked up
// (a) whether a substitutions row already exists for this exact
// (game_id, player_out_id, player_in_id) pair, and (b) the outgoing and
// incoming players' current lineup.batting_order. Only called for the
// outgoingPlayerId-present case (a real out/in pair) -- the "landed on
// an already-empty position, nobody goes to the bench" case has no
// substitutions row and is unaffected by any of this.
//
// A repeat submission of the same pair (operator retry-queue replay, a
// double tap) must not duplicate the substitutions row, and must not
// re-derive batting_order from an outgoing row a PRIOR run of this same
// call has already cleared to null -- that's exactly how Carlos De
// León's batting_order got silently nulled on 2026-11-08 (see
// CLAUDE.md's stale-writes note): the second call read the outgoing
// player's already-nulled slot and copied that null onto a row it was
// about to mark status='starting'.
export function decideChainSubstitutionWrite(input: {
  existingSubstitutionExists: boolean;
  outgoingBattingOrder: number | null;
  incomingOwnBattingOrder: number | null;
}): ChainSubstitutionWriteDecision {
  if (input.existingSubstitutionExists) {
    return { skip: true, incomingBattingOrder: null };
  }
  const incomingBattingOrder = input.outgoingBattingOrder ?? input.incomingOwnBattingOrder ?? null;
  if (incomingBattingOrder === null) {
    // Never write a null batting_order onto a row about to become
    // status='starting' -- that row would be unreachable by the
    // scorebook's chain walk. Neither the outgoing player's slot nor
    // the incoming player's own existing slot has a usable value, so
    // refuse instead of guessing.
    throw new Error(NO_BATTING_ORDER_ERROR);
  }
  return { skip: false, incomingBattingOrder };
}

// Vacant-slot batch: the no-outgoing-player branch of confirmChainSubstitution
// (a player entering a position nobody was displaced from, e.g. a new
// pitcher taking over a previously-uncovered spot) never ran the check
// above at all -- decideChainSubstitutionWrite is only called when
// outgoingPlayerId is set, so incomingBattingOrder stayed null with
// nothing to catch it. This is that same refusal, for that branch:
// prefer whatever slot the confirm panel's vacant-slot picker assigned
// to the incoming player (assignedBattingOrder), fall back to a batting
// order the incoming player might already hold in their own lineup row
// (a re-entry edge case), and refuse -- never write null -- if neither
// exists.
export function resolveIncomingBattingOrderWithoutOutgoing(input: {
  assignedBattingOrder: number | null;
  incomingOwnBattingOrder: number | null;
}): number {
  const incomingBattingOrder = input.assignedBattingOrder ?? input.incomingOwnBattingOrder ?? null;
  if (incomingBattingOrder === null) {
    throw new Error(NO_BATTING_ORDER_ERROR);
  }
  return incomingBattingOrder;
}
