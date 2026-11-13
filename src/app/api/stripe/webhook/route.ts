import { NextResponse } from "next/server";
import { headers } from "next/headers";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { extendExpiry, expireNowIfActive } from "@/lib/clubhouse-access";
import { PRO_VALID_UNTIL } from "@/lib/pricing";

// Clubhouse Pro batch: App Router Route Handler -- reads the raw body via
// request.text() and the signature via headers() (NOT req.body, that's
// Pages-Router-only) for stripe.webhooks.constructEvent. No user session
// exists for this call at all (it's Stripe's server calling ours), so
// clubhouse_unlocked is written via the service-role client, same as the
// invite-claim and promo-redemption paths.
//
// Local testing: `stripe listen --forward-to localhost:3000/api/stripe/webhook`
// prints a dev-only signing secret for STRIPE_WEBHOOK_SECRET.
//
// Pro expiry batch: this endpoint must have checkout.session.completed,
// charge.refunded, and charge.dispute.created enabled in the Stripe
// Dashboard's webhook configuration (or in `stripe listen`'s --events
// flag for local testing) -- charge.refunded and charge.dispute.created
// are new as of this batch; checkout.session.completed already was.
export async function POST(request: Request) {
  const body = await request.text();
  const signature = headers().get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const playerId = session.metadata?.player_id;
    if (playerId) {
      const supabase = createServiceRoleClient();
      const { data: current } = await supabase.from("players").select("clubhouse_unlocked, clubhouse_unlocked_until").eq("id", playerId).single();
      const nextUntil = extendExpiry(current ?? { clubhouse_unlocked: false, clubhouse_unlocked_until: null }, PRO_VALID_UNTIL);
      await supabase.from("players").update({ clubhouse_unlocked: true, clubhouse_unlocked_until: nextUntil }).eq("id", playerId);
    }
  }

  // Refunds batch: a full refund expires access immediately; a partial
  // refund (a coach/support goodwill gesture that doesn't void the
  // purchase) is ignored outright -- Stripe's own `refunded` flag on the
  // Charge is true only once the entire amount has been refunded, which
  // is exactly the distinction asked for. The charge only carries a
  // payment_intent id, not our metadata, so the player has to be found
  // by looking up the Checkout Session that used that payment_intent --
  // metadata lives on the Session, not the Charge or PaymentIntent.
  if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    if (charge.refunded) {
      const playerId = await findPlayerIdByPaymentIntent(charge.payment_intent);
      if (playerId) {
        const supabase = createServiceRoleClient();
        const { data: current } = await supabase.from("players").select("clubhouse_unlocked_until").eq("id", playerId).single();
        const expiredUntil = expireNowIfActive(current?.clubhouse_unlocked_until ?? null, new Date());
        // null means "already expired, nothing to do" -- this is what
        // keeps a retried/duplicate charge.refunded event idempotent
        // instead of pushing the expiry forward to a later `now` on
        // every retry.
        if (expiredUntil) {
          await supabase.from("players").update({ clubhouse_unlocked_until: expiredUntil }).eq("id", playerId);
        }
      }
    }
  }

  // Disputes batch: log only, per spec -- a chargeback is a signal for a
  // human to look into, not an automatic revocation (the cardholder's
  // bank, not Stripe or this app, has already pulled the funds; locking
  // the player out on top of that is a product decision, not something
  // to silently automate here).
  if (event.type === "charge.dispute.created") {
    const dispute = event.data.object as Stripe.Dispute;
    const playerId = await findPlayerIdByPaymentIntent(dispute.payment_intent);
    console.error("[stripe webhook] charge.dispute.created -- access NOT revoked, needs manual review", {
      disputeId: dispute.id,
      playerId: playerId ?? "unknown (no matching checkout session found)",
    });
  }

  return NextResponse.json({ received: true });
}

async function findPlayerIdByPaymentIntent(paymentIntent: string | Stripe.PaymentIntent | null): Promise<string | null> {
  const paymentIntentId = typeof paymentIntent === "string" ? paymentIntent : paymentIntent?.id;
  if (!paymentIntentId) return null;
  const sessions = await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 });
  return sessions.data[0]?.metadata?.player_id ?? null;
}
