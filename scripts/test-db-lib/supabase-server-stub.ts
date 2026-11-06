// Test-only stand-in for src/lib/supabase/server.ts's createClient(). The
// real one depends on next/headers' cookies(), which throws immediately
// outside an actual Next.js request ("called outside a request scope") --
// there is no way to exercise the real "use server" actions from a plain
// script without replacing that one dependency. Everything else is the
// real client: same @supabase/supabase-js library, same tables, backed by
// the service role key (bypassing RLS, which isn't what's under test
// here) -- only supabase.auth.getUser() is swapped for a fixed test user,
// since requireOperatorGame() in actions.ts calls that to authorize.
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

function loadEnv(): Record<string, string> {
  const text = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    if (!line.includes("=") || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

let testUserId: string | null = null;

export function __setTestUserId(id: string) {
  testUserId = id;
}

export function createClient() {
  const env = loadEnv();
  const client = createServiceClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  client.auth.getUser = (async () => {
    if (!testUserId) throw new Error("test stub: __setTestUserId() was never called");
    return { data: { user: { id: testUserId } }, error: null };
  }) as typeof client.auth.getUser;
  return client;
}
