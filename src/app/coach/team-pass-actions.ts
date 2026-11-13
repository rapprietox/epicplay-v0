"use server";

import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";
import type { CheckoutResult } from "@/lib/checkout-result";

// Team Pass batch: a server action, coach-only -- a player hitting this
// directly (shouldn't happen through the UI, since the Buy button only
// renders on the coach dashboard, but the action itself still has to
// refuse it) gets a message pointing them back to their coach rather
// than a Stripe error or a silent no-op.
export async function createTeamPassCheckoutSession(): Promise<CheckoutResult> {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Not signed in -- try signing in again." };

    const { data: profile } = await supabase.from("profiles").select("role, team_id").eq("id", user.id).single();
    if (!profile?.team_id) return { ok: false, error: "Couldn't find your team -- try reloading the page." };
    if (profile.role !== "coach") return { ok: false, error: "Ask your coach to buy the Team Pass." };

    const priceId = process.env.TEAM_PASS_PRICE_ID;
    if (!priceId) {
      console.error("[createTeamPassCheckoutSession] TEAM_PASS_PRICE_ID is not set");
      return { ok: false, error: "Payment is temporarily unavailable. Please try again later." };
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${siteUrl}/coach?team_pass=1`,
      cancel_url: `${siteUrl}/coach`,
      // kind: "team_pass" is what the webhook branches on
      // (src/app/api/stripe/webhook/route.ts, resolveEpicPlaySession) --
      // team_id/purchased_by are what it needs to actually grant the
      // pass once the checkout completes.
      metadata: { kind: "team_pass", team_id: profile.team_id, purchased_by: user.id },
    });

    if (!session.url) {
      console.error("[createTeamPassCheckoutSession] Stripe session created with no url", session.id);
      return { ok: false, error: "Payment is temporarily unavailable. Please try again later." };
    }
    return { ok: true, url: session.url };
  } catch (err) {
    console.error("[createTeamPassCheckoutSession] unexpected error", err);
    return { ok: false, error: "Payment is temporarily unavailable. Please try again later." };
  }
}
