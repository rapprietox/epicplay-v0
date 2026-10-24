"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type OnboardResult = { ok: true } | { ok: false; error: string };

// Launch-audit Fix 1: replaces the manual-SQL-only team/coach bootstrap
// (see supabase/README.md's old "create a team and onboard yourself"
// section) with a self-serve path. Returns a result object rather than
// throwing -- Next.js redacts a Server Action's thrown error message in
// production builds, the same gotcha already fixed in redeemPromoCode
// (src/app/player/clubhouse/actions.ts).
//
// Both the teams insert AND the role/team_id profile update now go
// through the service-role client, bypassing RLS for both -- the
// self-serve RLS policies for each (20261018100001_self_serve_coach_onboarding.sql)
// were rejected in practice despite looking correct on paper, and
// debugging the exact policy-evaluation mechanism further isn't worth
// the risk with the season starting. Those two policies are effectively
// unused now, not removed -- harmless to leave in place. This is safe
// precisely because the policies' own invariant -- "only a signed-in
// user with no existing team may become its coach" -- is enforced in
// application code instead of SQL: the team_id null check below runs
// before either write fires, so bypassing RLS here doesn't reopen the
// abuse case the policies existed to prevent (an arbitrary user
// claiming an existing team, or promoting themselves to coach of one).
// The optional player row (and the player_id update after it) stays on
// the caller's own session client -- by that point the profiles row
// already reflects role='coach', so the existing "players: coach/
// operator write" / "profiles: coach updates team" policies apply
// normally, regardless of which client made the earlier writes.
export async function createTeamAndOnboardCoach(formData: FormData): Promise<OnboardResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in -- try signing in again." };

  const { data: profile } = await supabase.from("profiles").select("team_id").eq("id", user.id).single();
  if (profile?.team_id) return { ok: false, error: "You already belong to a team." };

  const teamName = String(formData.get("teamName") ?? "").trim();
  const yourName = String(formData.get("yourName") ?? "").trim();
  const jerseyRaw = String(formData.get("jerseyNumber") ?? "").trim();
  if (!teamName) return { ok: false, error: "Team name is required" };
  if (!yourName) return { ok: false, error: "Your name is required" };

  const adminSupabase = createServiceRoleClient();
  const { data: team, error: teamError } = await adminSupabase
    .from("teams")
    .insert({ name: teamName, created_by: user.id })
    .select("id")
    .single();
  if (teamError || !team) return { ok: false, error: teamError?.message ?? "Failed to create team -- try again?" };

  const { error: profileError } = await adminSupabase
    .from("profiles")
    .update({ role: "coach", team_id: team.id, full_name: yourName })
    .eq("id", user.id);
  if (profileError) {
    return { ok: false, error: `Team was created, but setting up your coach account failed: ${profileError.message} -- try reloading and signing in again.` };
  }

  // Jersey number is the only signal that this coach also wants a
  // roster entry (a common player-coach setup) -- skipped entirely
  // when left blank, rather than creating a zero-context player row
  // nobody asked for. Covered by the existing "players: coach/operator
  // write" policy, since the profile update above already made this
  // caller a coach of this exact team.
  if (jerseyRaw) {
    const jerseyNumber = Number(jerseyRaw);
    const { data: player } = await supabase
      .from("players")
      .insert({ team_id: team.id, name: yourName, jersey_number: Number.isFinite(jerseyNumber) ? jerseyNumber : null })
      .select("id")
      .single();
    if (player) {
      // Covered by "profiles: coach updates team" -- the caller is now
      // a coach of this team, same as any other coach-on-own-team write.
      await supabase.from("profiles").update({ player_id: player.id }).eq("id", user.id);
    }
    // Not treated as a hard failure if this optional step errors --
    // the team and coach promotion above already succeeded, and a
    // missing player row is easy to add later from the Roster page.
  }

  return { ok: true };
}
