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
