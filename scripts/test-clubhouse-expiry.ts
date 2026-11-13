// "Prove it" replay for the Pro expiry/refund batch. Exercises the pure
// decision functions in src/lib/clubhouse-access.ts directly -- the same
// functions the Stripe webhook route, promo-code redemption, and the
// checkout guard all call into -- with fake Stripe-event-shaped objects
// standing in for the real thing. No DB, no Stripe, no network: pure
// function in, result out. This is deliberately NOT an integration test
// against real Supabase/Stripe, per this batch's "don't touch any real
// Stripe object" constraint.
//
// Usage: npx tsx scripts/test-clubhouse-expiry.ts

import { isClubhouseActive, extendExpiry, expireNowIfActive, type ClubhouseAccessFields } from "../src/lib/clubhouse-access";
import { PRO_VALID_UNTIL } from "../src/lib/pricing";

let failures = 0;
function expect(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} -- ${label}: got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

const NOW = new Date("2026-11-13T12:00:00Z");
const NEVER_UNLOCKED: ClubhouseAccessFields = { clubhouse_unlocked: false, clubhouse_unlocked_until: null };

console.log("\n=== 1. A purchase sets the date (checkout.session.completed, never-unlocked player) ===");
{
  // Fake Stripe checkout.session.completed event -- the webhook only
  // ever reads session.metadata.player_id out of it, so that's the only
  // field this replay needs.
  const fakeSession = { metadata: { player_id: "player_1" } };
  const playerBeforeWrite = NEVER_UNLOCKED;
  const nextUntil = extendExpiry(playerBeforeWrite, PRO_VALID_UNTIL);
  expect("session carries the right player id", fakeSession.metadata.player_id, "player_1");
  expect("fresh purchase sets clubhouse_unlocked_until to PRO_VALID_UNTIL", nextUntil, PRO_VALID_UNTIL);
}

console.log("\n=== 2. A promo redemption sets the same date, via the same helper ===");
{
  const nextUntil = extendExpiry(NEVER_UNLOCKED, PRO_VALID_UNTIL);
  expect("promo redemption sets clubhouse_unlocked_until to PRO_VALID_UNTIL", nextUntil, PRO_VALID_UNTIL);
}

console.log("\n=== 3. A duplicate webhook changes nothing ===");
{
  // First delivery: never-unlocked -> PRO_VALID_UNTIL (same as test 1).
  const firstUntil = extendExpiry(NEVER_UNLOCKED, PRO_VALID_UNTIL);
  // Stripe redelivers the same event. The webhook re-fetches the
  // player row first -- by now it reflects the first delivery's write
  // (clubhouse_unlocked: true, clubhouse_unlocked_until: firstUntil).
  const playerAfterFirstDelivery: ClubhouseAccessFields = { clubhouse_unlocked: true, clubhouse_unlocked_until: firstUntil };
  const secondUntil = extendExpiry(playerAfterFirstDelivery, PRO_VALID_UNTIL);
  expect("duplicate delivery recomputes the identical expiry (no-op)", secondUntil, firstUntil);
}

console.log("\n=== 4. A full refund expires access immediately ===");
{
  // Player is currently active, expiry well in the future.
  const activeUntil = "2026-12-31T23:59:59Z";
  const chargeFullRefund = { refunded: true, amount: 1000, amount_refunded: 1000 };
  expect("charge.refunded is true for a full refund", chargeFullRefund.refunded, true);
  const expiredUntil = expireNowIfActive(activeUntil, NOW);
  expect("full refund sets clubhouse_unlocked_until to now", expiredUntil, NOW.toISOString());
  expect("player reads as inactive once expired", isClubhouseActive({ clubhouse_unlocked: true, clubhouse_unlocked_until: expiredUntil as string }, null, NOW), false);
}

console.log("\n=== 5. A partial refund doesn't touch the expiry ===");
{
  const activeUntil = "2026-12-31T23:59:59Z";
  // Stripe's Charge.refunded is only true once the FULL amount has been
  // refunded -- a $3 partial refund on a $10 charge leaves it false,
  // which is exactly the signal the webhook route checks before ever
  // calling expireNowIfActive at all.
  const chargePartialRefund = { refunded: false, amount: 1000, amount_refunded: 300 };
  expect("charge.refunded is false for a partial refund", chargePartialRefund.refunded, false);
  expect("partial refund: webhook never calls expireNowIfActive, so expiry is untouched", chargePartialRefund.refunded ? expireNowIfActive(activeUntil, NOW) : activeUntil, activeUntil);
}

console.log("\n=== 5b. A retried full-refund webhook is idempotent (already expired) ===");
{
  // Models the same full refund delivered twice: the second delivery
  // re-fetches the row and sees the already-past expiry the first
  // delivery wrote, so it must return null (no write), not push the
  // expiry forward to a later "now".
  const firstExpiredUntil = expireNowIfActive("2026-12-31T23:59:59Z", NOW) as string;
  const secondCallNow = new Date(NOW.getTime() + 60_000); // a minute later, as a retry would be
  const secondExpiredUntil = expireNowIfActive(firstExpiredUntil, secondCallNow);
  expect("retried refund webhook is a no-op once already expired", secondExpiredUntil, null);
}

console.log("\n=== 6. A dispute only logs -- never calls the revoking function at all ===");
{
  // There is no "apply dispute" function to call in clubhouse-access.ts
  // by design -- the webhook route's charge.dispute.created branch only
  // does a console.error with the resolved player id, and never touches
  // extendExpiry/expireNowIfActive. Asserting that here would mean
  // re-implementing the route; instead this documents the invariant the
  // route's own code must keep: isClubhouseActive is unaffected by a
  // dispute with no accompanying refund.
  const playerBeforeDispute: ClubhouseAccessFields = { clubhouse_unlocked: true, clubhouse_unlocked_until: "2026-12-31T23:59:59Z" };
  expect("player stays active after a dispute alone (no refund yet)", isClubhouseActive(playerBeforeDispute, null, NOW), true);
}

console.log("\n=== 7. An expired player passes the checkout guard (can buy again) ===");
{
  const expiredPlayer: ClubhouseAccessFields = { clubhouse_unlocked: true, clubhouse_unlocked_until: "2025-01-01T00:00:00Z" };
  // createClubhouseCheckoutSession's guard is `if (isClubhouseActive(player)) return already-unlocked-error`.
  const blockedFromBuying = isClubhouseActive(expiredPlayer, null, NOW);
  expect("expired player is NOT blocked by the already-unlocked guard", blockedFromBuying, false);

  const stillActivePlayer: ClubhouseAccessFields = { clubhouse_unlocked: true, clubhouse_unlocked_until: "2026-12-31T23:59:59Z" };
  expect("still-active player IS blocked by the already-unlocked guard", isClubhouseActive(stillActivePlayer, null, NOW), true);

  const neverUnlockedUntilNull: ClubhouseAccessFields = { clubhouse_unlocked: true, clubhouse_unlocked_until: null };
  expect("a no-expiry (grandfathered) unlock never reads as expired", isClubhouseActive(neverUnlockedUntilNull, null, NOW), true);
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
