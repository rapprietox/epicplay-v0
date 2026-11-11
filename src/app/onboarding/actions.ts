"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type OnboardResult = { ok: true } | { ok: false; error: string };

// Sport-choice batch: same allowed values as the launch-page lead
// form (src/app/_marketing/actions.ts). Softball isn't supported yet
// (see the app's own FAQ) -- this only records the team's choice; it
// doesn't change any stats/positions/ERA/innings logic, which still
// assumes baseball rules regardless of what's stored here.
const ALLOWED_SPORTS = ["baseball", "softball", "both"] as const;

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
  const sport = String(formData.get("sport") ?? "").trim();
  const jerseyRaw = String(formData.get("jerseyNumber") ?? "").trim();
  if (!teamName) return { ok: false, error: "Team name is required" };
  if (!yourName) return { ok: false, error: "Your name is required" };
  if (!ALLOWED_SPORTS.includes(sport as (typeof ALLOWED_SPORTS)[number])) {
    return { ok: false, error: "Select baseball, softball, or both." };
  }

  const adminSupabase = createServiceRoleClient();
  const { data: team, error: teamError } = await adminSupabase
    .from("teams")
    .insert({ name: teamName, created_by: user.id, sport: sport as (typeof ALLOWED_SPORTS)[number] })
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

export type SoloSignupResult =
  | { ok: true; isMinor: boolean; playerName: string; teamLabel: string }
  | { ok: false; error: string };

// feature/solo-signup, Phase 0: the third /pending path -- a parent or
// player with no team at all yet. Deliberately the SAME underlying
// mechanism as createTeamAndOnboardCoach above (service-role client,
// same "no existing team_id" precondition enforced in application code,
// same self-serve-onboarding policies left untouched and still
// effectively unused for the reason documented on that function) --
// this isn't a new onboarding path at the data layer, just a different
// form in front of it with one real behavioral difference: a minor
// never gets profiles.player_id set (so they never see a Clubhouse
// view -- they have no account to sign into in the first place, since
// this whole flow never asks them to) and their players.user_id stays
// null, since no invite was ever issued for them. An adult signing up
// to track themselves gets both set, since they ARE the account that
// just signed up.
export async function createSoloPlayerAccount(formData: FormData): Promise<SoloSignupResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in -- try signing in again." };

  const { data: profile } = await supabase.from("profiles").select("team_id").eq("id", user.id).single();
  if (profile?.team_id) return { ok: false, error: "You already belong to a team." };

  const playerName = String(formData.get("playerName") ?? "").trim();
  const teamLabel = String(formData.get("teamLabel") ?? "").trim();
  const sport = String(formData.get("sport") ?? "").trim();
  const jerseyRaw = String(formData.get("jerseyNumber") ?? "").trim();
  const underEighteen = String(formData.get("underEighteen") ?? "") === "yes";
  const guardianConfirmed = formData.get("guardianConfirmed") === "on";

  if (!playerName) return { ok: false, error: "The player's first name is required" };
  if (!teamLabel) return { ok: false, error: "A team label is required" };
  if (!ALLOWED_SPORTS.includes(sport as (typeof ALLOWED_SPORTS)[number])) {
    return { ok: false, error: "Select baseball, softball, or both." };
  }
  if (String(formData.get("underEighteen") ?? "") === "") {
    return { ok: false, error: "Let us know whether the player is under 18." };
  }
  if (underEighteen && !guardianConfirmed) {
    return { ok: false, error: "Please confirm you're the player's parent or legal guardian." };
  }

  const adminSupabase = createServiceRoleClient();
  const { data: team, error: teamError } = await adminSupabase
    .from("teams")
    .insert({ name: teamLabel, created_by: user.id, sport: sport as (typeof ALLOWED_SPORTS)[number] })
    .select("id")
    .single();
  if (teamError || !team) return { ok: false, error: teamError?.message ?? "Failed to create team -- try again?" };

  const { error: profileError } = await adminSupabase
    .from("profiles")
    .update({ role: "coach", team_id: team.id })
    .eq("id", user.id);
  if (profileError) {
    return { ok: false, error: `Team was created, but setting up your account failed: ${profileError.message} -- try reloading and signing in again.` };
  }

  const jerseyNumber = jerseyRaw ? Number(jerseyRaw) : null;
  // A child never gets user_id set -- there's no invite link for this
  // row and none is ever generated automatically (see roster-section.tsx:
  // the "Link Account" button is still a deliberate, separate coach
  // action). An adult tracking themselves IS the account that just
  // signed up, so their own players row links back to it directly.
  const { data: player, error: playerError } = await supabase
    .from("players")
    .insert({
      team_id: team.id,
      name: playerName,
      jersey_number: Number.isFinite(jerseyNumber as number) ? jerseyNumber : null,
      user_id: underEighteen ? null : user.id,
    })
    .select("id")
    .single();
  if (playerError || !player) {
    return { ok: false, error: `Team was created, but adding the player failed: ${playerError?.message ?? "unknown error"} -- try again from the Roster page.` };
  }

  // profiles.player_id (and therefore the Clubhouse) is only ever set
  // for an adult tracking their own at-bats -- a minor has no account
  // of their own to attach it to, by design.
  if (!underEighteen) {
    await supabase.from("profiles").update({ player_id: player.id }).eq("id", user.id);
  }

  return { ok: true, isMinor: underEighteen, playerName, teamLabel };
}
