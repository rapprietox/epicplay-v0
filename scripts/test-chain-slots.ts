// "Prove it" replay for fix/chain-slots. Exercises the real exported
// functions in src/lib/operator/chain-slots.ts directly -- the same
// functions src/app/operator/actions.ts calls unmodified. No DB, no
// Next.js, no React: pure function in, result out, same spirit as this
// repo's other scripts/test-*.ts replays.
//
// Usage: npx tsx scripts/test-chain-slots.ts

import { computeChainSlots, applyChainWrites, type SlotRow, type ChainWriteOps, type SubstitutionPair } from "../src/lib/operator/chain-slots";

let failures = 0;
function expect(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} -- ${label}: got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

function slotOf(rows: SlotRow[], playerId: string): number | null {
  return rows.find((r) => r.playerId === playerId)?.battingOrder ?? null;
}
function positionOf(rows: SlotRow[], playerId: string): string | null {
  return rows.find((r) => r.playerId === playerId)?.position ?? null;
}
function statusOf(rows: SlotRow[], playerId: string): string | undefined {
  return rows.find((r) => r.playerId === playerId)?.status;
}

// Applies a computeChainSlots result's updates onto a snapshot, for
// feeding one call's output into the next call's input -- exactly what
// getLineupForGame's full re-read does between two separate, real
// confirmChainSubstitution calls.
function applyUpdates(rows: SlotRow[], updates: { playerId: string; battingOrder: number | null; position: string | null; status: string }[]): SlotRow[] {
  const byId = new Map(rows.map((r) => [r.playerId, { ...r }]));
  for (const u of updates) byId.set(u.playerId, { playerId: u.playerId, battingOrder: u.battingOrder, position: u.position, status: u.status });
  return Array.from(byId.values());
}

async function main() {
console.log("\n=== 1. The exact incident, fixed: combined chain (Owen fills Jordan's vacated P), then a plain Sam-for-Jordan ===");
{
  // Pre-chain: Jordan starts at P/slot1, Marcus at C/slot2, Owen and Sam
  // on the bench (null slot), slots 3-10 held by other starters.
  const others: SlotRow[] = [3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ playerId: `other${n}`, battingOrder: n, position: `pos${n}`, status: "starting" }));
  const rows0: SlotRow[] = [
    { playerId: "jordan", battingOrder: 1, position: "P", status: "starting" },
    { playerId: "marcus", battingOrder: 2, position: "C", status: "starting" },
    { playerId: "owen", battingOrder: null, position: null, status: "reserve" },
    { playerId: "sam", battingOrder: null, position: null, status: "reserve" },
    ...others,
  ];

  // Call 1: Owen enters at P (vacated by Jordan moving to C), Jordan
  // moves to C taking Marcus's slot, Marcus benched -- one chain, per
  // the fix's own rule ("within this same chain").
  const call1 = computeChainSlots(rows0, {
    incomingPlayerId: "owen",
    entryPosition: "P",
    outgoingPlayerId: "marcus",
    positionMoves: [{ playerId: "jordan", position: "C" }],
  });
  if (call1.ok) {
    expect("call 1: Owen inherits Jordan's vacated slot 1", slotOf(call1.updates, "owen"), 1);
    expect("call 1: Jordan inherits Marcus's slot 2", slotOf(call1.updates, "jordan"), 2);
    expect("call 1: Marcus is benched", statusOf(call1.updates, "marcus"), "reserve");
    expect("call 1: substitution pairs", call1.substitutionPairs, [{ playerInId: "jordan", playerOutId: "marcus" }]);
  } else {
    expect("call 1 should succeed", call1, { ok: true });
  }

  const rows1 = call1.ok ? applyUpdates(rows0, call1.updates) : rows0;

  // Call 2: an ordinary one-for-one, Sam replaces Jordan at C.
  const call2 = computeChainSlots(rows1, { incomingPlayerId: "sam", entryPosition: "C", outgoingPlayerId: "jordan", positionMoves: [] });
  if (call2.ok) {
    const final = applyUpdates(rows1, call2.updates);
    expect("final: Owen ends at slot 1, P", [slotOf(final, "owen"), positionOf(final, "owen")], [1, "P"]);
    expect("final: Sam ends at slot 2, C", [slotOf(final, "sam"), positionOf(final, "sam")], [2, "C"]);
    expect("final: Jordan benched", statusOf(final, "jordan"), "reserve");
    expect("final: Marcus still benched", statusOf(final, "marcus"), "reserve");
    const slots = new Set(final.filter((r) => r.status === "starting").map((r) => r.battingOrder));
    expect("final: every slot 1..10 filled exactly once", Array.from(slots).sort((a, b) => (a ?? 0) - (b ?? 0)), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  } else {
    expect("call 2 should succeed", call2, { ok: true });
  }
}

console.log("\n=== 2. The Camels chain: Alex for Bryan, Jose 1B-to-P (open), Mike for Pedro ===");
{
  const others: SlotRow[] = [4, 5, 6, 7, 8, 9, 10].map((n) => ({ playerId: `other${n}`, battingOrder: n, position: `pos${n}`, status: "starting" }));
  const rows0: SlotRow[] = [
    { playerId: "bryan", battingOrder: 1, position: "SS", status: "starting" },
    { playerId: "jose", battingOrder: 2, position: "1B", status: "starting" },
    { playerId: "pedro", battingOrder: 3, position: "RF", status: "starting" },
    { playerId: "alex", battingOrder: null, position: null, status: "reserve" },
    { playerId: "mike", battingOrder: null, position: null, status: "reserve" },
    ...others,
    // P starts this test genuinely open -- nobody plays it before Jose moves there.
  ];

  const result = computeChainSlots(rows0, {
    incomingPlayerId: "alex",
    entryPosition: "SS",
    outgoingPlayerId: "bryan",
    positionMoves: [
      { playerId: "jose", position: "P" },
      { playerId: "mike", position: "RF" },
    ],
  });

  if (result.ok) {
    const final = applyUpdates(rows0, result.updates);
    expect("Alex inherits Bryan's slot 1 at SS", [slotOf(final, "alex"), positionOf(final, "alex")], [1, "SS"]);
    expect("Jose KEEPS his own slot 2, now at P (R4 -- moved, displaced no one)", [slotOf(final, "jose"), positionOf(final, "jose")], [2, "P"]);
    expect("Mike inherits Pedro's slot 3 at RF", [slotOf(final, "mike"), positionOf(final, "mike")], [3, "RF"]);
    expect("Bryan benched", statusOf(final, "bryan"), "reserve");
    expect("Pedro benched", statusOf(final, "pedro"), "reserve");
    expect("two distinct substitution pairs recorded", result.substitutionPairs.sort((a, b) => a.playerInId.localeCompare(b.playerInId)), [
      { playerInId: "alex", playerOutId: "bryan" },
      { playerInId: "mike", playerOutId: "pedro" },
    ]);
    const slots = new Set(final.filter((r) => r.status === "starting").map((r) => r.battingOrder));
    expect("every slot 1..10 filled exactly once", Array.from(slots).sort((a, b) => (a ?? 0) - (b ?? 0)), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  } else {
    expect("Camels chain should succeed", result, { ok: true });
  }
}

console.log("\n=== 3. A simple one-for-one (bench replaces starter) -- unchanged from today ===");
{
  const others: SlotRow[] = [2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ playerId: `other${n}`, battingOrder: n, position: `pos${n}`, status: "starting" }));
  const rows0: SlotRow[] = [
    { playerId: "starter1", battingOrder: 1, position: "LF", status: "starting" },
    { playerId: "benchguy", battingOrder: null, position: null, status: "reserve" },
    ...others,
  ];
  const result = computeChainSlots(rows0, { incomingPlayerId: "benchguy", entryPosition: "LF", outgoingPlayerId: "starter1", positionMoves: [] });
  if (result.ok) {
    expect("bench player inherits the starter's slot", slotOf(result.updates, "benchguy"), 1);
    expect("outgoing starter benched", statusOf(result.updates, "starter1"), "reserve");
    expect("one substitution pair", result.substitutionPairs, [{ playerInId: "benchguy", playerOutId: "starter1" }]);
  } else {
    expect("simple one-for-one should succeed", result, { ok: true });
  }
}

console.log("\n=== 4. A chain that would leave a slot empty -- must block ===");
{
  // Jordan moves to C for Marcus ALONE, with nobody filling the P he
  // leaves behind -- exactly the original incident's first half, on its
  // own, which is exactly what must now be refused rather than silently
  // written with a null batting_order.
  const others: SlotRow[] = [3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ playerId: `other${n}`, battingOrder: n, position: `pos${n}`, status: "starting" }));
  const rows0: SlotRow[] = [
    { playerId: "jordan", battingOrder: 1, position: "P", status: "starting" },
    { playerId: "marcus", battingOrder: 2, position: "C", status: "starting" },
    ...others,
  ];
  const result = computeChainSlots(rows0, { incomingPlayerId: "jordan", entryPosition: "C", outgoingPlayerId: "marcus", positionMoves: [] });
  expect("blocked: slot 1 (Jordan's vacated P) has no batter", result, { ok: false, emptySlots: [1], duplicateSlots: [] });
}

console.log("\n=== 5. A failed write restores the pre-chain rows ===");
{
  const rows0: SlotRow[] = [
    { playerId: "starter1", battingOrder: 1, position: "LF", status: "starting" },
    { playerId: "benchguy", battingOrder: null, position: null, status: "reserve" },
  ];
  const result = computeChainSlots(rows0, { incomingPlayerId: "benchguy", entryPosition: "LF", outgoingPlayerId: "starter1", positionMoves: [] });
  if (!result.ok) {
    expect("setup: this chain should compute successfully", result, { ok: true });
  } else {
    // computeChainSlots touches the displaced occupant (starter1) before
    // the entrant (benchguy) -- see its own insertion order into
    // `touched` -- so result.updates is [starter1, benchguy]. The forward
    // pass is let to succeed for the first update and fail on the second,
    // modeling a transient write failure partway through the chain.
    expect("sanity: update order is [starter1, benchguy]", result.updates.map((u) => u.playerId), ["starter1", "benchguy"]);

    // A playerId moves from "attempted" to "succeeded" on its first
    // (forward) write; any LATER call for a playerId already in
    // `forwardSucceeded` can only be the compensating restore write
    // applyChainWrites issues in its catch block -- this is what lets
    // the mock tell the two directions apart without the function
    // under test needing to say which phase it's in.
    const forwardAttempts: string[] = [];
    const forwardSucceeded = new Set<string>();
    const restoreCalls: { playerId: string; battingOrder: number | null; position: string | null; status: string }[] = [];
    const ops: ChainWriteOps = {
      async updateLineupRow(playerId, values) {
        if (forwardSucceeded.has(playerId)) {
          restoreCalls.push({ playerId, ...values });
          return;
        }
        forwardAttempts.push(playerId);
        if (forwardAttempts.length === 2) throw new Error("simulated write failure");
        forwardSucceeded.add(playerId);
      },
      async insertSubstitution(_pair: SubstitutionPair) {
        forwardAttempts.push("insert:substitution");
        return "sub-1";
      },
      async deleteSubstitution(id) {
        restoreCalls.push({ playerId: `deleted-sub:${id}`, battingOrder: null, position: null, status: "" });
      },
      async insertGameEvent() {
        forwardAttempts.push("insert:event");
        return "event-1";
      },
      async deleteGameEvent(id) {
        restoreCalls.push({ playerId: `deleted-event:${id}`, battingOrder: null, position: null, status: "" });
      },
    };

    let threw = false;
    try {
      await applyChainWrites(ops, rows0, result);
    } catch {
      threw = true;
    }

    expect("the failure propagates to the caller", threw, true);
    expect("both lineup writes were attempted, the second one failing", forwardAttempts, ["starter1", "benchguy"]);
    expect("exactly one lineup row actually succeeded before the failure", Array.from(forwardSucceeded), ["starter1"]);
    expect("that one row was restored to its pre-chain value", restoreCalls, [{ playerId: "starter1", battingOrder: 1, position: "LF", status: "starting" }]);
  }
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("SCRIPT ERROR:", e);
  process.exit(1);
});
