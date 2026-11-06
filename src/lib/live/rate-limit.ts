// Same in-memory sliding-window rate limit as the marketing lead form
// (src/app/_marketing/actions.ts) -- module-scoped, resets on a cold
// start, doesn't share state across server instances. Accepted for a
// public, unauthenticated polling endpoint at V0's scale; not a
// substitute for a real distributed limiter if this ever needs one.
const requestsByKey = new Map<string, number[]>();
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 30; // generous headroom over the page's own 3s poll (~20/min)

export function isRateLimited(key: string): boolean {
  const now = Date.now();
  const existing = (requestsByKey.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (existing.length >= MAX_PER_WINDOW) {
    requestsByKey.set(key, existing);
    return true;
  }
  existing.push(now);
  requestsByKey.set(key, existing);
  return false;
}
