import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface InvitePreview {
  playerId: string;
  playerName: string;
  jerseyNumber: number | null;
  position: string | null;
  teamId: string;
  teamName: string;
}

// Clubhouse batch: null covers both "this token never existed" and
// "already claimed" (claiming clears invite_token to null) -- the
// invite page shows the same "invalid or already used" message either
// way, since there's no meaningful difference for the person clicking
// an old link.
export async function getInvitePreview(token: string): Promise<InvitePreview | null> {
  const supabase = createServiceRoleClient();
  // Two-step query, not an embedded players(...).select("teams(name)")
  // join -- this hand-written types.ts stub sets Relationships: [] on
  // every table (see its own top-of-file comment), so an embedded join
  // would silently type-infer to `never` instead of erroring loudly.
  const { data: player } = await supabase
    .from("players")
    .select("id, name, jersey_number, position, team_id")
    .eq("invite_token", token)
    .maybeSingle();
  if (!player) return null;

  const { data: team } = await supabase.from("teams").select("name").eq("id", player.team_id).maybeSingle();

  return {
    playerId: player.id,
    playerName: player.name,
    jerseyNumber: player.jersey_number,
    position: player.position,
    teamId: player.team_id,
    teamName: team?.name ?? "your team",
  };
}

export type ClaimInviteResult = { ok: true } | { ok: false; reason: "invalid_or_used" | "already_linked_elsewhere" };

// Runs with the service-role client because both writes it needs are
// outside a plain player session's RLS write scope: players is
// coach/operator-write-only (the player is claiming a row that isn't
// "theirs" until this call finishes), and profiles has no self-update
// policy at all (only the security-definer handle_new_user trigger and a
// coach can write it). See src/lib/supabase/service-role.ts's own
// comment for why this is the first real consumer of that key.
export async function claimInvite({ token, userId }: { token: string; userId: string }): Promise<ClaimInviteResult> {
  const supabase = createServiceRoleClient();

  const { data: player } = await supabase.from("players").select("id, team_id, invite_token").eq("invite_token", token).maybeSingle();
  if (!player) return { ok: false, reason: "invalid_or_used" };

  const { data: alreadyLinked } = await supabase.from("players").select("id").eq("user_id", userId).neq("id", player.id).maybeSingle();
  if (alreadyLinked) return { ok: false, reason: "already_linked_elsewhere" };

  // The invite_token=token clause (not just id=player.id) is what makes
  // this atomically single-use even under a concurrent double-click or
  // two tabs: whichever request updates 0 rows lost the race and gets
  // the same "invalid or used" outcome as a genuinely stale link.
  const { data: updated } = await supabase
    .from("players")
    .update({ user_id: userId, invite_token: null })
    .eq("id", player.id)
    .eq("invite_token", token)
    .select("id")
    .maybeSingle();
  if (!updated) return { ok: false, reason: "invalid_or_used" };

  await supabase.from("profiles").update({ role: "player", team_id: player.team_id, player_id: player.id }).eq("id", userId);

  return { ok: true };
}
