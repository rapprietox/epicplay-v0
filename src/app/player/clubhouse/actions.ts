"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";
import { redeemPromoCodeServerSide } from "@/lib/promo-codes";

async function requirePlayer() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { data: profile } = await supabase.from("profiles").select("role, team_id, player_id").eq("id", user.id).single();
  if (!profile || profile.role !== "player" || !profile.team_id || !profile.player_id) {
    throw new Error("Not authorized");
  }
  return { supabase, teamId: profile.team_id, playerId: profile.player_id };
}

export type CheckoutResult = { ok: true; url: string } | { ok: false; error: string };

// Clubhouse Pro batch: uses a real pre-created Stripe Price
// (STRIPE_PRICE_ID) rather than inline price_data -- the $10 one-time
// Clubhouse Pro price now lives in the Stripe Dashboard, not hardcoded
// here. Checkout happens entirely server-side; the client just navigates
// to the returned URL (no @stripe/stripe-js, no Stripe Elements needed
// since this app never collects card details itself).
//
// Launch-audit Fix 3: returns a result object instead of throwing --
// same reasoning as redeemPromoCode's own fix (Next.js redacts a thrown
// Server Action error message in production, and even where it
// doesn't, the raw "missing STRIPE_PRICE_ID" string is an internal
// detail that means nothing to a player and shouldn't reach them at
// all). A real misconfiguration still gets logged server-side for
// whoever can actually fix it.
export async function createClubhouseCheckoutSession(): Promise<CheckoutResult> {
  try {
    const { supabase, playerId } = await requirePlayer();

    const { data: player } = await supabase.from("players").select("name, clubhouse_unlocked").eq("id", playerId).single();
    if (!player) return { ok: false, error: "Couldn't find your player profile -- try reloading the page." };
    if (player.clubhouse_unlocked) return { ok: false, error: "Clubhouse Pro is already unlocked for you." };

    const priceId = process.env.STRIPE_PRICE_ID;
    if (!priceId) {
      console.error("[createClubhouseCheckoutSession] STRIPE_PRICE_ID is not set");
      return { ok: false, error: "Payment is temporarily unavailable. Please try again later or contact your coach for a promo code." };
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${siteUrl}/player/clubhouse?unlocked=1`,
      cancel_url: `${siteUrl}/player/clubhouse`,
      metadata: { player_id: playerId },
    });

    if (!session.url) {
      console.error("[createClubhouseCheckoutSession] Stripe session created with no url", session.id);
      return { ok: false, error: "Payment is temporarily unavailable. Please try again later or contact your coach for a promo code." };
    }
    return { ok: true, url: session.url };
  } catch (err) {
    console.error("[createClubhouseCheckoutSession] unexpected error", err);
    return { ok: false, error: "Payment is temporarily unavailable. Please try again later or contact your coach for a promo code." };
  }
}

// Promo codes batch: see src/lib/promo-codes.ts for the actual
// redemption logic (service-role, since both tables it touches are
// outside a player's own RLS write scope).
//
// Bug fix: this used to throw on a failed redemption and let the client
// catch it -- but Next.js redacts a Server Action's thrown error message
// in production builds (replaced with a generic digest-only error, by
// design, since a thrown error could otherwise leak server internals to
// the client). That's exactly why the real reason never showed up:
// "Server Component error... hidden in production." Returning a plain
// result object instead of throwing sidesteps that redaction entirely --
// the client reads result.error directly, no exception in the loop.
// requirePlayer()/redeemPromoCodeServerSide can still fail in ways this
// doesn't anticipate (e.g. requirePlayer's own Supabase calls), so the
// whole body is wrapped too, logged, and turned into the same friendly
// message rather than left to propagate and get redacted anyway.
export async function redeemPromoCode(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { teamId, playerId } = await requirePlayer();

    const code = String(formData.get("code") ?? "")
      .trim()
      .toUpperCase();
    if (!code) return { ok: false, error: "Enter a code" };

    const result = await redeemPromoCodeServerSide({ code, teamId, playerId });
    if (!result.ok) return result;

    revalidatePath("/player/clubhouse");
    return { ok: true };
  } catch (err) {
    console.error("[redeemPromoCode] unexpected error", err);
    return { ok: false, error: "Invalid code or already used — try again" };
  }
}
