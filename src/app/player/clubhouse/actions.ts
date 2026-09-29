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

// Clubhouse Pro batch: uses a real pre-created Stripe Price
// (STRIPE_PRICE_ID) rather than inline price_data -- the $10 one-time
// Clubhouse Pro price now lives in the Stripe Dashboard, not hardcoded
// here. Checkout happens entirely server-side; the client just navigates
// to the returned URL (no @stripe/stripe-js, no Stripe Elements needed
// since this app never collects card details itself).
export async function createClubhouseCheckoutSession(): Promise<{ url: string }> {
  const { supabase, playerId } = await requirePlayer();

  const { data: player } = await supabase.from("players").select("name, clubhouse_unlocked").eq("id", playerId).single();
  if (!player) throw new Error("Player not found");
  if (player.clubhouse_unlocked) throw new Error("Already unlocked");

  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) throw new Error("Clubhouse Pro checkout isn't configured yet (missing STRIPE_PRICE_ID)");

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${siteUrl}/player/clubhouse?unlocked=1`,
    cancel_url: `${siteUrl}/player/clubhouse`,
    metadata: { player_id: playerId },
  });

  if (!session.url) throw new Error("Failed to create checkout session");
  return { url: session.url };
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
