// Shared return shape for every Stripe Checkout Session server action
// (individual Clubhouse Pro, Team Pass) -- a result object, never a
// thrown error, since Next.js redacts a Server Action's thrown error
// message in production builds (see createClubhouseCheckoutSession's
// own original comment on this).
export type CheckoutResult = { ok: true; url: string } | { ok: false; error: string };
