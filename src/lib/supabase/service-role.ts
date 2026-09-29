import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

// Clubhouse batch: the first real consumer of SUPABASE_SERVICE_ROLE_KEY
// (previously present in .env.local.example/CLAUDE.md but unused by any
// route). Needed anywhere a write has to bypass RLS on behalf of a user
// whose own session legitimately can't perform it yet -- claiming an
// invite (writes players.user_id and profiles.player_id/team_id/role,
// both outside a plain player session's write scope), redeeming a promo
// code (writes players.clubhouse_unlocked, coach/operator-write-only),
// and the Stripe webhook (no user session at all, server-to-server).
// Never import this into anything reachable from the client -- the
// service role key bypasses every RLS policy in the database.
export function createServiceRoleClient() {
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
