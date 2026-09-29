import "server-only";
import Stripe from "stripe";

// Clubhouse Pro batch: single server-only client, same one-client-per-file
// pattern as src/lib/anthropic.ts. Pinned to the installed SDK's own
// current API version (node_modules/stripe/cjs/apiVersion.js) rather than
// left implicit, so a future `npm install stripe@latest` can't silently
// change request/response shapes underneath the webhook handler.
//
// Unlike `new Anthropic()`, the Stripe SDK throws immediately at
// construction time if given no key at all (not just an invalid one) --
// `next build`'s page-data-collection step actually imports every route
// module, so a genuinely-missing STRIPE_SECRET_KEY (e.g. local dev before
// Stripe is configured) would otherwise hard-fail the *entire* build, not
// just this one route. Falling back to an obvious placeholder string lets
// the module load; any real attempt to call the Stripe API with it fails
// at that call site with a clear "invalid API key" error instead, which
// is the right place for that failure to surface.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_missing_STRIPE_SECRET_KEY", {
  apiVersion: "2026-08-26.dahlia",
});
