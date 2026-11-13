import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { FOUNDING_TEAM_LIMIT } from "@/lib/pricing";
import type { Database } from "@/lib/supabase/types";
import type { TeamPassAccessFields } from "@/lib/team-pass";

// Team Pass batch: every "is this player unlocked" call site (the
// Clubhouse page, askPlayerKairos, the individual checkout guard) needs
// its team's current pass too, not just the player row -- centralized
// here so each one fetches it the same way (status + date-range
// filtered server-side, not fetched raw and filtered in JS) instead of
// several slightly different copies of the same query. Each caller runs
// this once per request/page-load/action invocation, not once per
// individual isClubhouseActive check within it.
export async function getActiveTeamPass(supabase: SupabaseClient<Database>, teamId: string, now: Date = new Date()): Promise<TeamPassAccessFields | null> {
  const iso = now.toISOString();
  const { data } = await supabase
    .from("team_passes")
    .select("status, starts_at, ends_at")
    .eq("team_id", teamId)
    .eq("status", "active")
    .lte("starts_at", iso)
    .gte("ends_at", iso)
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

// Coach dashboard's "N of 20 founding spots left" counter. A team that
// has EVER bought a team pass has claimed its founding spot, even if
// that pass later expired or was refunded -- the founding discount was
// already extended at purchase time, and reclaiming the slot on a
// refund would let the same team claim it twice. Needs the service
// role: this counts across every team, not just the caller's own
// (team_passes' RLS only lets a team read its own rows). Computed in
// TypeScript from the distinct team_id values -- fine at this app's
// data volume, the same convention src/lib/stats.ts's own cross-team
// aggregates already use rather than committing to a SQL aggregation
// this early.
export async function getFoundingTeamPassSpotsRemaining(): Promise<number> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase.from("team_passes").select("team_id");
  const distinctTeams = new Set((data ?? []).map((r) => r.team_id)).size;
  return Math.max(0, FOUNDING_TEAM_LIMIT - distinctTeams);
}
