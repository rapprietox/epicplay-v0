import { isTeamPassActive, type TeamPassAccessFields } from "@/lib/team-pass";

// Pro expiry batch: one shared check so "is Clubhouse Pro active for
// this player right now" is never re-derived from the raw
// clubhouse_unlocked boolean alone -- every call site that used to read
// player.clubhouse_unlocked directly now goes through isClubhouseActive
// instead, so an expired unlock (clubhouse_unlocked still true,
// clubhouse_unlocked_until in the past) is treated the same as a never-
// unlocked player everywhere at once, including the checkout guard
// (an expired player must be able to buy again).
//
// Pure, no DB/Stripe access -- takes whatever shape already has both
// columns (a full players Row, or a narrower select()). `now` is a
// parameter (not read internally via `new Date()`) so the test replay
// script can pass a fixed clock instead of racing real time.
export interface ClubhouseAccessFields {
  clubhouse_unlocked: boolean;
  clubhouse_unlocked_until: string | null;
}

// Individual-only check -- unchanged logic from before the Team Pass
// batch, just renamed/exported so callers that need to tell "unlocked
// via my own purchase" apart from "unlocked via my team's pass" (the
// Clubhouse page's "Included with your team's pass until..." banner)
// can call this and isTeamPassActive separately instead of only ever
// getting the combined boolean.
export function isIndividuallyActive(player: ClubhouseAccessFields, now: Date = new Date()): boolean {
  if (!player.clubhouse_unlocked) return false;
  if (player.clubhouse_unlocked_until === null) return true;
  return new Date(player.clubhouse_unlocked_until).getTime() > now.getTime();
}

// Team Pass batch: the combined check every other call site (header,
// KAIROS, the individual checkout guard) uses when it just needs "is
// this player unlocked at all," not which source unlocked them.
// teamPass defaults to null (not a required parameter) so every
// pre-existing 1-arg call site keeps compiling unchanged for a player
// whose team has no pass to check.
export function isClubhouseActive(player: ClubhouseAccessFields, teamPass: TeamPassAccessFields | null = null, now: Date = new Date()): boolean {
  return isIndividuallyActive(player, now) || isTeamPassActive(teamPass, now);
}

// Write-path helper for both unlock sources (Stripe checkout and promo
// redemption): "a purchase made after an earlier expiry must extend,
// not shorten." Needs the player's state *before* this write, not just
// the expiry column alone, to tell apart two different nulls:
//   - never unlocked before (clubhouse_unlocked false) -> a fresh
//     unlock starts at the target date, whatever the stale `until`
//     column currently holds (its default is null, but this makes the
//     intent explicit rather than relying on that default).
//   - already unlocked with no expiry (clubhouse_unlocked true, `until`
//     null -- a grandfathered player, or one unlocked by a path that
//     predates this column) -> no-expiry wins; don't newly time-limit
//     someone buying/redeeming again.
// Otherwise, the new expiry is the later of the existing date and the
// target -- never a blind overwrite -- which is also what makes a
// duplicate webhook a no-op: replaying the same event re-reads the same
// already-extended value and computes the same max again.
export function extendExpiry(current: ClubhouseAccessFields, targetUntil: string): string | null {
  if (!current.clubhouse_unlocked) return targetUntil;
  if (current.clubhouse_unlocked_until === null) return null;
  return new Date(targetUntil).getTime() > new Date(current.clubhouse_unlocked_until).getTime() ? targetUntil : current.clubhouse_unlocked_until;
}

// Refund-path helper: a full refund expires access immediately, but
// only if it's still active -- this is what makes the webhook handler
// idempotent for a retried/duplicate `charge.refunded` event. The first
// call sees an active (future-or-null) expiry and returns `now`'s ISO
// string to write; a retry then sees that already-past expiry and
// returns null (no change needed), rather than pushing the expiry
// forward to a later "now" on every retry.
export function expireNowIfActive(currentUntil: string | null, now: Date): string | null {
  const isActive = currentUntil === null || new Date(currentUntil).getTime() > now.getTime();
  return isActive ? now.toISOString() : null;
}
