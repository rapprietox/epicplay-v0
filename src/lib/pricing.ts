// Clubhouse Pro pitch batch: the Founding-price wording lives here once
// so the checkout copy never drifts from itself across the locked
// section, the button, and the price note under it.
export const PRO_PRICE_DISPLAY = "$10";
export const PRO_VALID_UNTIL_LABEL = "the end of the 2026 season";
export const PRO_NEXT_PRICE_NOTE = "Founding price. It goes to $30 in January.";

// Launch-capture batch: the main platform is free until Dec 31, 2026
// (see Hero.tsx/LaunchBanner.tsx copy) with no pricing shown anywhere
// on the launch page yet -- "Pricing stays hidden." This is a
// placeholder for whatever the post-free-period price turns out to be,
// defined now so a future un-hide of the Pricing section has one place
// to read it from instead of being invented inline wherever it's first
// needed. TODO: not yet decided -- update this before it's ever shown.
export const POST_LAUNCH_PRICE_PLACEHOLDER = "[TODO: price after Dec 31, 2026 not yet decided]";

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
