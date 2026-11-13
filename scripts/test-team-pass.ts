// "Prove it" replay for the Team Pass batch. Exercises the pure
// functions in src/lib/team-pass.ts, src/lib/clubhouse-access.ts, and
// src/lib/stripe-events.ts directly -- the same functions
// src/app/api/stripe/webhook/route.ts, src/app/coach/team-pass-actions.ts,
// and the Clubhouse page/KAIROS/checkout-guard call sites all call into
// -- with fake event/session/row objects standing in for the real
// thing. No DB, no Stripe, no network.
//
// Usage: npx tsx scripts/test-team-pass.ts

import { isTeamPassActive, computeTeamPassTerm, refundedTeamPassUpdate, type TeamPassAccessFields } from "../src/lib/team-pass";
import { isClubhouseActive, isIndividuallyActive, extendExpiry, type ClubhouseAccessFields } from "../src/lib/clubhouse-access";
import { extractPlayerIdMetadata, isEpicPlayPrice } from "../src/lib/stripe-events";
import { PRO_VALID_UNTIL, TEAM_PASS_TERM_DAYS } from "../src/lib/pricing";

let failures = 0;
function expect(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} -- ${label}: got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

const NOW = new Date("2026-11-13T12:00:00Z");
const TEAM_PASS_PRICE_ID = "price_teamPass0ABCXYZ"; // stands in for TEAM_PASS_PRICE_ID
const NEVER_UNLOCKED: ClubhouseAccessFields = { clubhouse_unlocked: false, clubhouse_unlocked_until: null };

console.log("\n=== 1. A purchase creates a pass (no currently active pass for the team) ===");
{
  const term = computeTeamPassTerm(null, NOW, TEAM_PASS_TERM_DAYS);
  expect("starts now", term.starts_at, NOW.toISOString());
  expect("ends TEAM_PASS_TERM_DAYS later", term.ends_at, new Date(NOW.getTime() + TEAM_PASS_TERM_DAYS * 24 * 60 * 60 * 1000).toISOString());
}

console.log("\n=== 2. A duplicate webhook changes nothing ===");
{
  // The webhook's own idempotency for this path comes from the DB layer
  // (stripe_checkout_session_id is unique, and the insert uses
  // upsert(..., { onConflict: "stripe_checkout_session_id", ignoreDuplicates: true })
  // -- a retried event with the same session id is skipped outright,
  // never recomputed). What IS purely testable here: computeTeamPassTerm
  // itself is deterministic -- given the same "team has no active pass
  // yet" state twice, it computes the identical term both times, so even
  // if the DB-level guard were somehow bypassed, replaying the same
  // inputs would never silently drift to a different result.
  const firstTerm = computeTeamPassTerm(null, NOW, TEAM_PASS_TERM_DAYS);
  const secondTerm = computeTeamPassTerm(null, NOW, TEAM_PASS_TERM_DAYS);
  expect("recomputing from the same pre-purchase state is deterministic", secondTerm, firstTerm);
}

console.log("\n=== 3. A foreign event (Futureel) is ignored, even with lookalike team_pass metadata ===");
{
  const futureelSession = { metadata: { futureel_order_id: "ord_789" } };
  expect("no kind=team_pass, no player_id -> neither branch resolves it", extractPlayerIdMetadata(futureelSession), null);

  // A session that DOES carry kind=team_pass and a team_id (the
  // lookalike case this batch's price check exists for) but was priced
  // for something else on the shared account entirely.
  const lookalikeTeamPassLineItemPriceId = "price_futureelAnnualPlan";
  expect(
    "kind=team_pass lookalike, but line item price isn't TEAM_PASS_PRICE_ID -> rejected",
    isEpicPlayPrice(lookalikeTeamPassLineItemPriceId, [TEAM_PASS_PRICE_ID]),
    false
  );
}

console.log("\n=== 4. A full refund ends the pass ===");
{
  const update = refundedTeamPassUpdate(NOW);
  expect("status flips to refunded", update.status, "refunded");
  expect("ends_at is set to the refund time", update.ends_at, NOW.toISOString());

  const refundedPass: TeamPassAccessFields = { status: update.status, starts_at: "2026-06-01T00:00:00Z", ends_at: update.ends_at };
  expect("refunded pass reads as inactive even though ends_at is 'now', not past", isTeamPassActive(refundedPass, NOW), false);
}

console.log("\n=== 5. A player on the team is unlocked by an active team pass ===");
{
  const teamsActivePass: TeamPassAccessFields = { status: "active", starts_at: "2026-11-01T00:00:00Z", ends_at: "2027-05-01T00:00:00Z" };
  const playerWithNoIndividualUnlock = NEVER_UNLOCKED;
  expect("player with no purchase of their own is still unlocked via the team pass", isClubhouseActive(playerWithNoIndividualUnlock, teamsActivePass, NOW), true);
}

console.log("\n=== 6. A player on another team isn't unlocked by it ===");
{
  // Isolation is enforced by the team-scoped query + RLS
  // ("team_passes: team members select" ... using team_id = my_team_id()),
  // not by isClubhouseActive itself -- a player on a different team
  // never receives that other team's pass row in the first place. This
  // models exactly that: their own team's getActiveTeamPass lookup
  // correctly returns null, because the pass belongs to a different team.
  const otherTeamsPlayerOwnTeamPassLookup: TeamPassAccessFields | null = null;
  expect("player on a different team: their own team's pass lookup is null -> not unlocked", isClubhouseActive(NEVER_UNLOCKED, otherTeamsPlayerOwnTeamPassLookup, NOW), false);
}

console.log("\n=== 7. An extension starts at the old end date ===");
{
  const currentActivePass = { ends_at: "2027-02-01T00:00:00Z" };
  const term = computeTeamPassTerm(currentActivePass, NOW, TEAM_PASS_TERM_DAYS);
  expect("extension starts_at equals the current pass's own ends_at, not `now`", term.starts_at, new Date(currentActivePass.ends_at).toISOString());
  expect("extension ends_at is TEAM_PASS_TERM_DAYS after that old end date", term.ends_at, new Date(new Date(currentActivePass.ends_at).getTime() + TEAM_PASS_TERM_DAYS * 24 * 60 * 60 * 1000).toISOString());
}

console.log("\n=== 8. Individual Pro still works, unaffected by any of the above ===");
{
  const individuallyActivePlayer: ClubhouseAccessFields = { clubhouse_unlocked: true, clubhouse_unlocked_until: "2026-12-31T23:59:59Z" };
  expect("individually-active player, no team pass at all -> still unlocked", isClubhouseActive(individuallyActivePlayer, null, NOW), true);
  expect("isIndividuallyActive alone agrees", isIndividuallyActive(individuallyActivePlayer, NOW), true);

  const freshPurchase = extendExpiry(NEVER_UNLOCKED, PRO_VALID_UNTIL);
  expect("a fresh individual purchase still sets PRO_VALID_UNTIL, unchanged by this batch", freshPurchase, PRO_VALID_UNTIL);
}

console.log("\n=== 9. An expired pass locks again ===");
{
  const expiredTeamPass: TeamPassAccessFields = { status: "active", starts_at: "2026-01-01T00:00:00Z", ends_at: "2026-06-30T00:00:00Z" };
  expect("expired team pass reads as inactive", isTeamPassActive(expiredTeamPass, NOW), false);

  const playerWithNoIndividualUnlockEither = NEVER_UNLOCKED;
  expect("player covered only by the now-expired team pass is locked again", isClubhouseActive(playerWithNoIndividualUnlockEither, expiredTeamPass, NOW), false);
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
