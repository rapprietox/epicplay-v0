// "View as player" batch: lets exactly one coach account (named by this
// env var, not hardcoded in source) preview the real player experience
// without a second Google account. Pure, side-effect-free checks only --
// imported from middleware (Edge runtime), Server Components, and the
// server actions in view-switch-actions.ts alike, so nothing here can
// depend on Node-only APIs.
//
// Deliberately an env var rather than a DB flag: the request was
// explicit that no other coach, player, or operator should ever be able
// to see or use this, and a column on `profiles` (even one only an
// admin could set) would need its own RLS policy to stay that private --
// an env var only the deploy environment controls is a smaller, harder-
// to-accidentally-widen surface for a feature meant for one person.
export const VIEW_SWITCH_USER_ID = process.env.VIEW_SWITCH_USER_ID || null;
export const VIEW_SWITCH_COOKIE = "view_as";

// Eligible to use the toggle at all: the exact account this env var
// names, and still really a coach (profiles.role is never written by
// this feature -- see view-switch-actions.ts). Used by the coach-header
// button and the player-page pill to decide whether to render anything;
// neither ever appears for anyone else.
export function isViewSwitchEligible(userId: string | null | undefined, role: string | null | undefined): boolean {
  return !!VIEW_SWITCH_USER_ID && userId === VIEW_SWITCH_USER_ID && role === "coach";
}

// Currently viewing as a player: eligible, AND the cookie is exactly
// the one value enableViewAsPlayer ever sets. Every other combination --
// a different user, a different real role, a cookie set to anything
// else (including "coach", which this never checks for) -- is false.
// There is no code path anywhere that upgrades a non-matching user's
// access; the cookie can only ever narrow this one coach down to a
// player's own view, never widen anyone else's.
export function isViewSwitchActive(userId: string | null | undefined, role: string | null | undefined, cookieValue: string | undefined): boolean {
  return isViewSwitchEligible(userId, role) && cookieValue === "player";
}
