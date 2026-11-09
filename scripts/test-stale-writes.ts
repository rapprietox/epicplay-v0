// Proof script for the fix/stale-writes branch. Runs the REAL exported
// functions (not reimplementations) and asserts on their behavior.
//
// requireOperatorGame/confirmChainSubstitution themselves can't be
// invoked outside a live Next.js request (createClient() calls
// next/headers().cookies(), which needs the request's AsyncLocalStorage
// scope) -- that's why the status gate and the substitution write
// decision were pulled out into pure functions in
// src/lib/operator/chain-substitution.ts. Those real functions are what
// requireOperatorGame/confirmChainSubstitution call unmodified, so
// exercising them here is exercising the real logic, not a stand-in for
// it. The sync-queue case needs no such extraction -- sync-queue.ts has
// no Next.js/Supabase dependency at all, so it's imported and run as-is.

import { assertGameIsActive, decideChainSubstitutionWrite, GAME_NOT_ACTIVE_ERROR } from "../src/lib/operator/chain-substitution";
import { withOfflineRetry, pendingCount } from "../src/lib/operator/sync-queue";

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"} -- ${label}`);
  if (!cond) failures += 1;
}

async function expectThrow(fn: () => void | Promise<void>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

async function main() {
  console.log("=== Case 1: requireOperatorGame refuses a non-active game ===");
  {
    const msg = await expectThrow(() => assertGameIsActive({ status: "completed" }));
    check("assertGameIsActive throws for status='completed'", msg === GAME_NOT_ACTIVE_ERROR);

    const msg2 = await expectThrow(() => assertGameIsActive({ status: "setup" }));
    check("assertGameIsActive throws for status='setup'", msg2 === GAME_NOT_ACTIVE_ERROR);

    const msg3 = await expectThrow(() => assertGameIsActive({ status: "cancelled" }));
    check("assertGameIsActive throws for status='cancelled'", msg3 === GAME_NOT_ACTIVE_ERROR);

    let threw = false;
    try {
      assertGameIsActive({ status: "active" });
    } catch {
      threw = true;
    }
    check("assertGameIsActive does NOT throw for status='active'", !threw);
  }

  console.log("\n=== Case 2: confirmChainSubstitution's write decision ===");
  {
    // Replays the exact 2026-11-08 incident: a repeat submission for a
    // pair that already has a substitutions row, where the outgoing
    // player's batting_order has already been cleared to null by the
    // first run. Before the fix, confirmChainSubstitution would have
    // copied that null onto the incoming player's starting row.
    const repeat = decideChainSubstitutionWrite({
      existingSubstitutionExists: true,
      outgoingBattingOrder: null,
      incomingOwnBattingOrder: 10,
    });
    check("a repeat submission is skipped (no duplicate row, no re-derive)", repeat.skip === true);

    // First-time submission, outgoing player still has a real slot --
    // ordinary case, unaffected by the fix.
    const normal = decideChainSubstitutionWrite({
      existingSubstitutionExists: false,
      outgoingBattingOrder: 8,
      incomingOwnBattingOrder: null,
    });
    check("a normal first-time substitution uses the outgoing player's slot", !normal.skip && normal.incomingBattingOrder === 8);

    // First-time submission, but the outgoing player's slot already
    // reads null for some other reason (e.g. a second concurrent writer)
    // -- must fall back to the incoming player's own existing slot
    // instead of writing null over a row about to become 'starting'.
    const fallback = decideChainSubstitutionWrite({
      existingSubstitutionExists: false,
      outgoingBattingOrder: null,
      incomingOwnBattingOrder: 10,
    });
    check(
      "outgoing batting_order null -> falls back to incoming player's own slot",
      !fallback.skip && fallback.incomingBattingOrder === 10
    );

    // Both null -- refuse outright rather than write null onto a
    // starting row.
    const bothNullMsg = await expectThrow(() =>
      decideChainSubstitutionWrite({ existingSubstitutionExists: false, outgoingBattingOrder: null, incomingOwnBattingOrder: null })
    );
    check("both outgoing and incoming batting_order null -> throws instead of writing null", bothNullMsg !== null);
  }

  console.log("\n=== Case 3: the retry queue drops a permanent 'game not active' failure ===");
  {
    // A queued action whose retry now gets the permanent error must be
    // dropped, not retried forever. withOfflineRetry's first attempt
    // throwing this exact error must also never enqueue it in the first
    // place -- there's nothing to retry toward.
    let calls = 0;
    const before = pendingCount();
    await withOfflineRetry("prove-permanent-failure", async () => {
      calls += 1;
      throw new Error(GAME_NOT_ACTIVE_ERROR);
    });
    check("a first attempt that gets the permanent error is never enqueued", pendingCount() === before);
    check("the permanent-failure action was attempted exactly once", calls === 1);

    // A genuine transient failure (anything else) still queues for
    // retry, unchanged behavior.
    const beforeTransient = pendingCount();
    await withOfflineRetry("prove-transient-failure", async () => {
      throw new Error("network error");
    });
    check("a transient failure IS enqueued for retry", pendingCount() === beforeTransient + 1);
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("SCRIPT ERROR:", e);
  process.exit(1);
});
