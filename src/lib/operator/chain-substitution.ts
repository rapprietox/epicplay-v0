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

// fix/chain-slots: the batting-order-slot decision that used to live
// here (decideChainSubstitutionWrite) is gone -- it only ever ran when
// an outgoing player was named, which is exactly how the 2026-11-13
// empty-slot incident reached production (a no-outgoing-player entry
// skipped it entirely and silently wrote a null batting_order). The
// replacement, computeChainSlots in src/lib/operator/chain-slots.ts,
// runs for every chain unconditionally and validates the WHOLE lineup's
// slots at once, not just one in/out pair. See that file's own top
// comment for the full rule; see scripts/test-chain-slots.ts for the
// replay proof (the old scripts/test-stale-writes.ts's Case 2 tested
// the function removed here -- superseded, not duplicated).
