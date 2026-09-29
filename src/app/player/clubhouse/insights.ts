import "server-only";
import { unstable_cache } from "next/cache";
import { generatePregameMessage, type PregameMessageInput } from "@/lib/anthropic";

// Clubhouse batch: same caching rationale as src/app/coach/players/[id]/insights.ts
// -- unstable_cache's key includes this function's own argument, so an
// unchanged pregame input (same lineup spot, same recent form, same
// opponent) hits the cache, and a changed one (a new game logged, a new
// day's lineup) is a different key and regenerates automatically. No new
// DB table for the cache.
export const getPregameMessage = unstable_cache(async (input: PregameMessageInput) => generatePregameMessage(input), [
  "pregame-message",
]);
