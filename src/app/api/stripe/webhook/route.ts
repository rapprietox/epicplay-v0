import { NextResponse } from "next/server";
import { headers } from "next/headers";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { extendExpiry, expireNowIfActive } from "@/lib/clubhouse-access";
import { extractPlayerIdMetadata, isEpicPlayPrice } from "@/lib/stripe-events";
import { computeTeamPassTerm, refundedTeamPassUpdate } from "@/lib/team-pass";
import { getActiveTeamPass } from "@/lib/team-pass-queries";
import { PRO_VALID_UNTIL, TEAM_PASS_TERM_DAYS } from "@/lib/pricing";

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
// flag for local testing) -- no new event types as of the Team Pass
// batch, the same three still cover both products.
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
    const resolved = await resolveEpicPlaySession(session, event.type);

    if (resolved?.kind === "individual") {
      const supabase = createServiceRoleClient();
      const { data: current } = await supabase.from("players").select("clubhouse_unlocked, clubhouse_unlocked_until").eq("id", resolved.playerId).single();
      const nextUntil = extendExpiry(current ?? { clubhouse_unlocked: false, clubhouse_unlocked_until: null }, PRO_VALID_UNTIL);
      await supabase.from("players").update({ clubhouse_unlocked: true, clubhouse_unlocked_until: nextUntil }).eq("id", resolved.playerId);
    } else if (resolved?.kind === "team_pass") {
      await insertTeamPassFromCheckout(resolved.teamId, resolved.purchasedBy, session);
    }
  }

  // Refunds batch: a full refund expires access immediately; a partial
  // refund (a coach/support goodwill gesture that doesn't void the
  // purchase) is ignored outright -- Stripe's own `refunded` flag on the
  // Charge is true only once the entire amount has been refunded, which
  // is exactly the distinction asked for. The charge only carries a
  // payment_intent id, not our metadata, so the purchase has to be found
  // by looking up the Checkout Session that used that payment_intent --
  // metadata lives on the Session, not the Charge or PaymentIntent.
  if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    if (charge.refunded) {
      const session = await findCheckoutSessionByPaymentIntent(charge.payment_intent);
      const resolved = await resolveEpicPlaySession(session, event.type);

      if (resolved?.kind === "individual") {
        const supabase = createServiceRoleClient();
        const { data: current } = await supabase.from("players").select("clubhouse_unlocked_until").eq("id", resolved.playerId).single();
        const expiredUntil = expireNowIfActive(current?.clubhouse_unlocked_until ?? null, new Date());
        // null means "already expired, nothing to do" -- this is what
        // keeps a retried/duplicate charge.refunded event idempotent
        // instead of pushing the expiry forward to a later `now` on
        // every retry.
        if (expiredUntil) {
          await supabase.from("players").update({ clubhouse_unlocked_until: expiredUntil }).eq("id", resolved.playerId);
        }
      } else if (resolved?.kind === "team_pass" && session) {
        const supabase = createServiceRoleClient();
        // Scoped to status = 'active' in the WHERE, not just the id --
        // a retried/duplicate charge.refunded event matches 0 rows the
        // second time (already 'refunded'), making this idempotent the
        // same way the individual path's expireNowIfActive is.
        await supabase
          .from("team_passes")
          .update(refundedTeamPassUpdate(new Date()))
          .eq("stripe_checkout_session_id", session.id)
          .eq("status", "active");
      }
    }
  }

  // Disputes batch: log only, per spec -- a chargeback is a signal for a
  // human to look into, not an automatic revocation (the cardholder's
  // bank, not Stripe or this app, has already pulled the funds; locking
  // the player/team out on top of that is a product decision, not
  // something to silently automate here). Still runs through
  // resolveEpicPlaySession so a Futureel dispute is never logged as if
  // it were an EpicPlay player's or team's -- not a write-path risk
  // (this never writes regardless), but a correctness one for whoever
  // reads these logs.
  if (event.type === "charge.dispute.created") {
    const dispute = event.data.object as Stripe.Dispute;
    const session = await findCheckoutSessionByPaymentIntent(dispute.payment_intent);
    const resolved = await resolveEpicPlaySession(session, event.type);
    console.error("[stripe webhook] charge.dispute.created -- access NOT revoked, needs manual review", {
      disputeId: dispute.id,
      resolved: resolved ?? "unknown (no matching EpicPlay checkout session found)",
    });
  }

  return NextResponse.json({ received: true });
}

async function findCheckoutSessionByPaymentIntent(paymentIntent: string | Stripe.PaymentIntent | null): Promise<Stripe.Checkout.Session | null> {
  const paymentIntentId = typeof paymentIntent === "string" ? paymentIntent : paymentIntent?.id;
  if (!paymentIntentId) return null;
  const sessions = await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 });
  return sessions.data[0] ?? null;
}

type ResolvedIndividual = { kind: "individual"; playerId: string };
type ResolvedTeamPass = { kind: "team_pass"; teamId: string; purchasedBy: string | null };

// Shared-Stripe-account batch (extended for Team Pass): the only place
// that decides "is this event actually EpicPlay's, and which of our two
// products is it." Every write path above calls this instead of reading
// session.metadata directly. metadata.kind distinguishes the two
// products; isEpicPlayPrice (src/lib/stripe-events.ts) then confirms the
// session's line item price actually matches that product's own price
// id(s) -- without that second check, a Futureel session that happened
// to carry a metadata key literally named player_id, or kind=team_pass,
// for whatever unrelated reason would have been trusted blindly. The
// price check needs its own Stripe call (listLineItems) since a webhook
// payload never carries line items.
async function resolveEpicPlaySession(session: Stripe.Checkout.Session | null, eventType: string): Promise<ResolvedIndividual | ResolvedTeamPass | null> {
  if (!session) return null;

  if (session.metadata?.kind === "team_pass") {
    const teamId = session.metadata?.team_id;
    if (!teamId) {
      console.log(`[stripe webhook] ignoring ${eventType}: kind=team_pass but no metadata.team_id`, { sessionId: session.id });
      return null;
    }

    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
    const priceId = lineItems.data[0]?.price?.id ?? null;
    if (!isEpicPlayPrice(priceId, [process.env.TEAM_PASS_PRICE_ID])) {
      console.log(`[stripe webhook] ignoring ${eventType}: kind=team_pass session's line item price isn't TEAM_PASS_PRICE_ID (likely a different product on this shared Stripe account)`, {
        sessionId: session.id,
        priceId: priceId ?? "none",
      });
      return null;
    }

    return { kind: "team_pass", teamId, purchasedBy: session.metadata?.purchased_by ?? null };
  }

  const playerId = extractPlayerIdMetadata(session);
  if (!playerId) {
    console.log(`[stripe webhook] ignoring ${eventType}: no metadata.player_id and no kind=team_pass (likely a different product on this shared Stripe account)`, { sessionId: session.id });
    return null;
  }

  const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
  const priceId = lineItems.data[0]?.price?.id ?? null;
  // A second individual price id can be added to this list (e.g. a
  // January price change, run alongside the old one during a
  // transition) without touching isEpicPlayPrice itself.
  if (!isEpicPlayPrice(priceId, [process.env.STRIPE_PRICE_ID])) {
    console.log(`[stripe webhook] ignoring ${eventType}: line item price is not Clubhouse Pro's individual price (likely a different product on this shared Stripe account)`, {
      sessionId: session.id,
      priceId: priceId ?? "none",
    });
    return null;
  }

  return { kind: "individual", playerId };
}

// Team Pass batch: "if a pass is already active, the new term starts
// when the current one ends" is resolved here, at webhook-completion
// time against the team's current state -- not at checkout-creation
// time -- since that's the state that actually matters for correctness
// (the checkout window between creating and completing a session could
// span days). Idempotent via the unique stripe_checkout_session_id:
// ignoreDuplicates means a retried/duplicate checkout.session.completed
// event is a true no-op the second time, not just a harmlessly-equal
// overwrite.
async function insertTeamPassFromCheckout(teamId: string, purchasedBy: string | null, session: Stripe.Checkout.Session): Promise<void> {
  const supabase = createServiceRoleClient();
  const now = new Date();
  const currentActivePass = await getActiveTeamPass(supabase, teamId, now);
  const term = computeTeamPassTerm(currentActivePass, now, TEAM_PASS_TERM_DAYS);

  await supabase.from("team_passes").upsert(
    {
      team_id: teamId,
      starts_at: term.starts_at,
      ends_at: term.ends_at,
      purchased_by: purchasedBy,
      stripe_checkout_session_id: session.id,
      amount_cents: session.amount_total ?? null,
      status: "active",
    },
    { onConflict: "stripe_checkout_session_id", ignoreDuplicates: true }
  );
}
