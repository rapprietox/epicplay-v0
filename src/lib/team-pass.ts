// Team Pass batch: pure checks for whether a team's pass is currently
// covering its roster, plus the pure term-extension math the checkout/
// webhook write path needs. No DB/Stripe access here -- see
// src/lib/team-pass-queries.ts for the actual Supabase reads, and
// src/lib/clubhouse-access.ts (isClubhouseActive) for how this combines
// with a player's own individual unlock.
export interface TeamPassAccessFields {
  status: "active" | "refunded";
  starts_at: string;
  ends_at: string;
}

export function isTeamPassActive(teamPass: TeamPassAccessFields | null, now: Date = new Date()): boolean {
  if (!teamPass || teamPass.status !== "active") return false;
  const nowMs = now.getTime();
  return nowMs >= new Date(teamPass.starts_at).getTime() && nowMs <= new Date(teamPass.ends_at).getTime();
}

// Checkout/webhook-time helper: "if a pass is already active, the new
// term starts when the current one ends." Never stacks a fresh
// `termDays` on top of "now" while time is still remaining (that would
// throw away the remainder of what's already been paid for), and never
// starts a second concurrent term from "now" on top of an active one
// (that would double-count the overlap). A team with no currently
// active pass (currentActivePass === null -- first purchase, or buying
// again after a previous term fully lapsed) just starts from `now`,
// the same as an individual's first unlock.
export function computeTeamPassTerm(currentActivePass: { ends_at: string } | null, now: Date, termDays: number): { starts_at: string; ends_at: string } {
  const startMs = currentActivePass ? new Date(currentActivePass.ends_at).getTime() : now.getTime();
  return {
    starts_at: new Date(startMs).toISOString(),
    ends_at: new Date(startMs + termDays * 24 * 60 * 60 * 1000).toISOString(),
  };
}

// Refund-path helper, mirroring clubhouse-access.ts's expireNowIfActive
// in spirit -- a full refund always ends the pass immediately, unlike
// the individual path there's no "already expired, skip" branch needed
// here, because the webhook route scopes its update to
// `.eq("status", "active")`: a retried/duplicate charge.refunded event
// matches 0 rows the second time (already 'refunded'), which is what
// makes that write idempotent, not this function's return value.
export function refundedTeamPassUpdate(now: Date): { status: "refunded"; ends_at: string } {
  return { status: "refunded", ends_at: now.toISOString() };
}
