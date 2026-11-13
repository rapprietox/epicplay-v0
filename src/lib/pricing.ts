// Clubhouse Pro pitch batch: the Founding-price wording lives here once
// so the checkout copy never drifts from itself across the locked
// section, the button, and the price note under it.
export const PRO_PRICE_DISPLAY = "$10";
export const PRO_VALID_UNTIL_LABEL = "the end of the 2026 season";
export const PRO_NEXT_PRICE_NOTE = "Founding price. It goes to $30 in January.";

// Pro expiry batch: the single source of truth for "when does a fresh
// unlock expire" -- both write paths (the Stripe webhook's
// checkout.session.completed handler and promo-code redemption) read
// this one constant rather than each hardcoding the season-end date.
// Matches PRO_VALID_UNTIL_LABEL's "the end of the 2026 season" copy
// above as an actual enforced timestamp, not just marketing text.
export const PRO_VALID_UNTIL = "2026-12-31T23:59:59Z";

// Team Pass batch: a one-time, coach/parent-purchased unlock for the
// whole roster at once, layered on top of (never replacing) each
// player's own individual clubhouse_unlocked/_until -- see
// src/lib/clubhouse-access.ts (isClubhouseActive) and
// src/lib/team-pass.ts (isTeamPassActive, computeTeamPassTerm).
// TEAM_PASS_TERM_DAYS is a rolling term from whenever it starts (a
// first purchase: today; an extension bought while already active:
// the current pass's own end date) -- not a fixed calendar date like
// PRO_VALID_UNTIL -- matching the "season term up to 6 months" framing
// from the original team-plan scoping discussion.
export const TEAM_PASS_TERM_DAYS = 180;

// Placeholder fallback only -- the real charged amount lives on the
// Stripe Price TEAM_PASS_PRICE_ID points to (same "derive from Stripe,
// fall back to this constant" pattern as PRO_PRICE_DISPLAY). Update
// this to match whatever that Price is actually configured to, so the
// fallback shown during a Stripe outage isn't misleading.
export const TEAM_PASS_PRICE_DISPLAY = "$150";

// One sales-limited batch of founding-price team passes --
// src/app/coach/team-pass-card.tsx's "N of 20 founding spots left"
// counter, and supabase/data-ops/grant-team-pass.mjs's own check, both
// read against this same ceiling.
export const FOUNDING_TEAM_LIMIT = 20;

// Only features that are actually built and live today -- same
// "don't claim more than what's real" rule src/app/player/clubhouse/pro/what-you-get.tsx
// already follows for the individual Pro pitch.
export const TEAM_PASS_WHATS_INCLUDED = [
  "Clubhouse Pro for every player on the roster",
  "2D and 3D spray charts",
  "Personal KAIROS coaching -- 20 messages a month per player",
  "EPS for every player",
  "Pitch-by-pitch heat maps, for games logged with full detail",
];

// Launch-capture batch: the main platform is free until Dec 31, 2026
// (see Hero.tsx/LaunchBanner.tsx copy) with no pricing shown anywhere
// on the launch page yet -- "Pricing stays hidden." This is a
// placeholder for whatever the post-free-period price turns out to be,
// defined now so a future un-hide of the Pricing section has one place
// to read it from instead of being invented inline wherever it's first
// needed. TODO: not yet decided -- update this before it's ever shown.
export const POST_LAUNCH_PRICE_PLACEHOLDER = "[TODO: price after Dec 31, 2026 not yet decided]";

// FAQ copy-fixes batch: the "What does it cost, and what's free?"
// answer (src/app/_marketing/components/Faq.tsx), kept as its own
// constant specifically so a real post-founding-period price can be
// dropped into this one string later without hunting it down inside
// the FAQ array.
export const FAQ_PRICING_ANSWER =
  "Free until Dec 31, 2026. After that, plans start after the founding period, and we'll tell you before anything changes. Your data stays yours.";

// Banner-redesign batch: the sport wording for the launch banner's main
// line, kept as its own constant per the request rather than hardcoded
// inline. Checked against the actual codebase before setting this --
// the app's own FAQ (src/app/_marketing/components/Faq.tsx) already
// says "Not yet. EpicPlay AI is built for baseball today -- softball
// isn't supported," and a closer look confirms concrete reasons why:
// (1) the pre-game lineup builder's position picker
// (src/app/coach/games/[id]/setup/lineup-builder.tsx, STANDARD_POSITIONS)
// is hardcoded to the 9 standard baseball defensive positions, with no
// slot for the extra short-fielder position a 10-player slow-pitch
// softball lineup needs; (2) computePitchingLines' ERA formula
// (src/lib/stats.ts) hardcodes "runs / innings * 9" -- baseball's
// 9-inning ERA convention -- which would understate a softball
// pitcher's real ERA relative to softball's own 7-inning convention
// without anyone having decided that tradeoff on purpose. Neither is
// fatal, but together they're enough that "BASEBALL & SOFTBALL" would
// overstate what's actually supported today -- so this stays
// baseball-only until those are addressed.
export const SPORT_WORDING = "BASEBALL";
