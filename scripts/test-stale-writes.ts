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

import { assertGameIsActive, GAME_NOT_ACTIVE_ERROR } from "../src/lib/operator/chain-substitution";
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

  // Case 2 used to test decideChainSubstitutionWrite directly -- removed
  // along with that function (fix/chain-slots). Its job is now done by
  // computeChainSlots/applyChainWrites in src/lib/operator/chain-slots.ts,
  // which runs unconditionally for every chain (no more early skip for
  // the no-outgoing-player case) and validates the whole lineup's slots
  // at once. See scripts/test-chain-slots.ts for its replay proof,
  // including the exact incident this superseded.

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
