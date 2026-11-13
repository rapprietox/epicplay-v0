import "server-only";
import { unstable_cache } from "next/cache";
import { stripe } from "@/lib/stripe";
import { PRO_PRICE_DISPLAY } from "@/lib/pricing";

// Pro expiry batch: the checkout button used to hardcode PRO_PRICE_DISPLAY
// ("$10") -- changing the real charged amount (STRIPE_PRICE_ID, or the
// Price object it points to) never updated what the button displayed,
// which is exactly the drift already flagged against PRO_NEXT_PRICE_NOTE
// in the prior read-only investigation. This derives the display string
// from the live Stripe Price instead, so a January price bump changes
// the button automatically once STRIPE_PRICE_ID (or the Price's own
// amount) changes -- with the pricing.ts constant as a fallback, so a
// Stripe outage or a missing/invalid price id degrades to the old
// hardcoded behavior instead of breaking the page.
async function fetchClubhouseProPriceDisplay(): Promise<string> {
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) return PRO_PRICE_DISPLAY;

  try {
    const price = await stripe.prices.retrieve(priceId);
    if (price.unit_amount == null || !price.currency) return PRO_PRICE_DISPLAY;
    return formatPriceDisplay(price.unit_amount, price.currency);
  } catch (err) {
    console.error("[getClubhouseProPriceDisplay] Stripe price retrieve failed, falling back to pricing.ts constant", err);
    return PRO_PRICE_DISPLAY;
  }
}

function formatPriceDisplay(unitAmount: number, currency: string): string {
  const hasCents = unitAmount % 100 !== 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  }).format(unitAmount / 100);
}

// Cached for an hour via Next's Data Cache (persists across requests/
// invocations on Vercel, not just within one render) -- a Stripe Price
// changes rarely enough that fetching it on every single player-page
// load would be pure waste, and the whole point of this cache is to
// keep that Stripe call off the common path.
export const getClubhouseProPriceDisplay = unstable_cache(fetchClubhouseProPriceDisplay, ["clubhouse-pro-price-display"], { revalidate: 3600 });
