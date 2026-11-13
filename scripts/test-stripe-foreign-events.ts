// "Prove it" replay for the shared-Stripe-account hardening batch. This
// account also processes a different product's (Futureel's) events at
// the same webhook endpoint -- these tests exercise the two pure checks
// in src/lib/stripe-events.ts (extractPlayerIdMetadata, isEpicPlayPrice)
// that src/app/api/stripe/webhook/route.ts's resolveEpicPlayPlayerId
// calls before trusting ANY event enough to touch a player row. No DB,
// no Stripe, no network -- the one Stripe call resolveEpicPlayPlayerId
// itself makes (listLineItems, to learn a session's price) is exactly
// what these fake session/line-item objects stand in for.
//
// Usage: npx tsx scripts/test-stripe-foreign-events.ts

import { extractPlayerIdMetadata, isEpicPlayPrice } from "../src/lib/stripe-events";

let failures = 0;
function expect(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} -- ${label}: got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

const EPICPLAY_PRICE_ID = "price_1AbCdEfGhIjKlMnOp0HWE"; // stands in for STRIPE_PRICE_ID

console.log("\n=== 1. checkout.session.completed with no metadata.player_id (a plain Futureel session) ===");
{
  const futureelSession = { metadata: { futureel_order_id: "ord_789" } };
  expect("no player_id metadata -> not resolved as ours", extractPlayerIdMetadata(futureelSession), null);
}

console.log("\n=== 2. checkout.session.completed for another price (metadata.player_id present, wrong price) ===");
{
  // Models the coincidence this batch actually guards against: a
  // session that -- for whatever unrelated reason on Futureel's side --
  // DOES carry a key literally named player_id, but was never a
  // Clubhouse Pro purchase.
  const lookalikeSession = { metadata: { player_id: "player_42" } };
  const futureelLineItemPriceId = "price_futureelMonthlyPlan";
  expect("metadata.player_id is present", extractPlayerIdMetadata(lookalikeSession), "player_42");
  expect("but its line item price isn't ours -> rejected", isEpicPlayPrice(futureelLineItemPriceId, EPICPLAY_PRICE_ID), false);
}

console.log("\n=== 2b. Positive control: a real EpicPlay session passes both checks ===");
{
  const epicplaySession = { metadata: { player_id: "player_42" } };
  expect("metadata.player_id is present", extractPlayerIdMetadata(epicplaySession), "player_42");
  expect("line item price matches STRIPE_PRICE_ID -> accepted", isEpicPlayPrice(EPICPLAY_PRICE_ID, EPICPLAY_PRICE_ID), true);
}

console.log("\n=== 3. charge.refunded whose checkout session has no player_id ===");
{
  // Same extractPlayerIdMetadata check, applied to the session resolved
  // from the charge's payment_intent -- a Futureel refund's session
  // never carries our metadata key at all.
  const futureelRefundSession = { metadata: {} };
  expect("Futureel refund's session has no player_id -> ignored", extractPlayerIdMetadata(futureelRefundSession), null);
}

console.log("\n=== 3b. charge.refunded for another price (lookalike metadata, wrong price) ===");
{
  const lookalikeRefundSession = { metadata: { player_id: "player_42" } };
  const futureelLineItemPriceId = "price_futureelMonthlyPlan";
  expect("metadata.player_id present on the refunded session", extractPlayerIdMetadata(lookalikeRefundSession), "player_42");
  expect("price mismatch -> refund must NOT be able to expire this id", isEpicPlayPrice(futureelLineItemPriceId, EPICPLAY_PRICE_ID), false);
}

console.log("\n=== 3c. charge.refunded with no checkout session at all (e.g. a direct PaymentIntent charge, not via Checkout) ===");
{
  // resolveEpicPlayPlayerId's own `if (!session) return null;` guard --
  // modeled here as extractPlayerIdMetadata receiving null, which is
  // exactly what findCheckoutSessionByPaymentIntent returns when no
  // session matches that payment_intent.
  expect("no session found -> no player_id, no write", extractPlayerIdMetadata(null), null);
}

console.log("\n=== 4. charge.dispute.created for a foreign product (no player_id, and no revocation either way) ===");
{
  const futureelDisputeSession = { metadata: { futureel_order_id: "ord_789" } };
  expect("dispute's session has no player_id -> logged as unknown, never attributed to a real player", extractPlayerIdMetadata(futureelDisputeSession), null);
}

console.log("\n=== 4b. charge.dispute.created, lookalike metadata but wrong price -- still must not resolve to a real player id ===");
{
  const lookalikeDisputeSession = { metadata: { player_id: "player_42" } };
  const futureelLineItemPriceId = "price_futureelMonthlyPlan";
  expect("metadata.player_id present on the disputed session", extractPlayerIdMetadata(lookalikeDisputeSession), "player_42");
  expect("price mismatch -> this dispute must not be logged as player_42's", isEpicPlayPrice(futureelLineItemPriceId, EPICPLAY_PRICE_ID), false);
}

console.log("\n=== 5. isEpicPlayPrice never matches if STRIPE_PRICE_ID itself is unset (misconfiguration must not fail open) ===");
{
  expect("undefined configured price -> never matches, even with an identical-looking id", isEpicPlayPrice(EPICPLAY_PRICE_ID, undefined), false);
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
