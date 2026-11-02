import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface PresenceContext {
  userId: string;
  teamId: string;
  role: string;
  playerName: string | null;
}

// Team activity batch: shared by the three section layouts
// (coach/operator/player) that mount <PresenceTracker>. Returns null for
// anything short of "signed in with a team" -- no team_id means no
// per-team channel to join (same gate /pending itself uses), and that's
// not an error, just nothing to track yet.
//
// Wrapped so it can never throw: this runs in a layout, above every page
// under its section, so an unexpected failure here (a transient network
// hiccup talking to Supabase, for instance) must not take down the
// actual page underneath it -- presence is a nice-to-have overlay, not
// something any page's own functionality should ever depend on.
export async function getPresenceContext(): Promise<PresenceContext | null> {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: profile } = await supabase.from("profiles").select("role, team_id, player_id").eq("id", user.id).single();
    if (!profile?.team_id) return null;

    let playerName: string | null = null;
    if (profile.player_id) {
      const { data: player } = await supabase.from("players").select("name").eq("id", profile.player_id).single();
      playerName = player?.name ?? null;
    }

    return { userId: user.id, teamId: profile.team_id, role: profile.role, playerName };
  } catch {
    return null;
  }
}
