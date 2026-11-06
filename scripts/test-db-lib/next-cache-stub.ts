// Test-only stand-in for next/cache -- revalidatePath() throws
// ("Invariant: static generation store missing") outside an actual
// Next.js request, same reason supabase-server-stub.ts exists.
// actions.ts only ever calls it to invalidate the /operator page cache,
// which has no meaning in a plain script.
export function revalidatePath(_path: string) {}
