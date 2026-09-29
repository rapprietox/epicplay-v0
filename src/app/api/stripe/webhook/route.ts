import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { stripe } from "@/lib/stripe";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

// Clubhouse Pro batch: App Router Route Handler -- reads the raw body via
// request.text() and the signature via headers() (NOT req.body, that's
// Pages-Router-only) for stripe.webhooks.constructEvent. No user session
// exists for this call at all (it's Stripe's server calling ours), so
// clubhouse_unlocked is written via the service-role client, same as the
// invite-claim and promo-redemption paths.
//
// Local testing: `stripe listen --forward-to localhost:3000/api/stripe/webhook`
// prints a dev-only signing secret for STRIPE_WEBHOOK_SECRET.
export async function POST(request: Request) {
  const body = await request.text();
  const signature = headers().get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const playerId = session.metadata?.player_id;
    if (playerId) {
      const supabase = createServiceRoleClient();
      await supabase.from("players").update({ clubhouse_unlocked: true }).eq("id", playerId);
    }
  }

  return NextResponse.json({ received: true });
}
