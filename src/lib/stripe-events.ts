// Shared-Stripe-account batch: this account also processes a different
// product's (Futureel's) events, which arrive at the same webhook
// endpoint as EpicPlay's. Two independent, pure checks decide whether an
// incoming checkout.session.completed / charge.refunded /
// charge.dispute.created event is actually EpicPlay's before the
// webhook route trusts it enough to read metadata.player_id as a real
// player id:
//
//   1. extractPlayerIdMetadata -- does this session even carry our
//      metadata key at all? (A Futureel session simply won't.)
//   2. isEpicPlayPrice -- even if a session DOES carry a metadata key
//      literally named player_id (for whatever unrelated reason on
//      Futureel's side), was its line item actually priced at
//      EpicPlay's own STRIPE_PRICE_ID? Without this second check, that
//      coincidence alone would have been trusted.
//
// Both are pure -- no Stripe/DB calls -- so they're testable with fake
// event/session shapes (see scripts/test-stripe-foreign-events.ts). The
// actual Stripe API call needed to learn a session's line item price
// (stripe.checkout.sessions.listLineItems) lives in the webhook route
// itself, which calls isEpicPlayPrice with that result.
export function extractPlayerIdMetadata(session: { metadata?: Record<string, string | null | undefined> | null } | null): string | null {
  const playerId = session?.metadata?.player_id;
  return typeof playerId === "string" && playerId.length > 0 ? playerId : null;
}

export function isEpicPlayPrice(lineItemPriceId: string | null | undefined, configuredPriceId: string | undefined): boolean {
  // A missing configuredPriceId (STRIPE_PRICE_ID unset/misconfigured)
  // must never accidentally match -- that would turn "we don't know our
  // own price" into "treat everything as ours," the opposite of this
  // check's purpose.
  if (!configuredPriceId) return false;
  return lineItemPriceId === configuredPriceId;
}
