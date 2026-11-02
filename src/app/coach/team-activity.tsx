import { createClient } from "@/lib/supabase/server";
import { TeamActivityClient, type RosterMember } from "./team-activity-client";
import type { Database } from "@/lib/supabase/types";

type Player = Database["public"]["Tables"]["players"]["Row"];

// Team activity batch: coach-only card. Gated by the fact that this
// component is only ever rendered from /coach, which already redirects
// anyone whose profiles.role isn't 'coach' long before this renders --
// no separate check needed here, same as every other coach-dashboard
// section on this page. The "last seen" half reads straight from
// profiles (already selectable team-wide by a coach under the
// pre-existing "profiles: coach selects team" RLS policy -- no new
// policy needed for that part); the "online now" half is Realtime
// Presence, authorized separately by 20261102130001_team_presence.sql.
export async function TeamActivity({ teamId, players }: { teamId: string; players: Player[] }) {
  const supabase = createClient();
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, player_id, last_seen_at")
    .eq("team_id", teamId);

  const playerById = new Map(players.map((p) => [p.id, p]));
  const roster: RosterMember[] = (profiles ?? []).map((p) => ({
    userId: p.id,
    role: p.role,
    displayName: (p.player_id ? playerById.get(p.player_id)?.name : undefined) ?? p.full_name ?? p.email ?? "Unknown",
    lastSeenAt: p.last_seen_at,
  }));

  return (
    <section className="glossy rounded-lg border border-border bg-surface p-5">
      <h2 className="font-heading text-xl font-bold uppercase tracking-wide text-white">Team Activity</h2>
      <p className="mt-1 text-xs text-foreground/40">Who&apos;s online now, and when everyone else was last active.</p>
      <TeamActivityClient teamId={teamId} roster={roster} />
    </section>
  );
}
