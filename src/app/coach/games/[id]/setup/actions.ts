"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { extractOpponentRoster, type ExtractedOpponentPlayer } from "@/lib/anthropic";
import type { LineupStatus } from "@/lib/supabase/types";

async function requireCoachGame(gameId: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, team_id")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "coach" || !profile.team_id) {
    throw new Error("Not authorized");
  }

  const { data: game } = await supabase
    .from("games")
    .select("*")
    .eq("id", gameId)
    .eq("team_id", profile.team_id)
    .single();
  if (!game) throw new Error("Game not found");

  return { supabase, teamId: profile.team_id, game };
}

export interface LineupSlot {
  // Feature 1 (lineup-status batch): both nullable now -- a reserve or
  // absent row (status carries the meaning instead) has neither.
  batting_order: number | null;
  player_id: string;
  position: string | null;
  status: LineupStatus;
}

export async function saveLineupAndUmpire(
  gameId: string,
  input: { lineup: LineupSlot[]; umpireName: string }
) {
  const { supabase } = await requireCoachGame(gameId);

  const { error: deleteError } = await supabase.from("lineup").delete().eq("game_id", gameId);
  if (deleteError) throw new Error(deleteError.message);

  if (input.lineup.length > 0) {
    const { error: insertError } = await supabase.from("lineup").insert(
      input.lineup.map((slot) => ({
        game_id: gameId,
        player_id: slot.player_id,
        batting_order: slot.batting_order,
        position: slot.position || null,
        status: slot.status,
      }))
    );
    if (insertError) throw new Error(insertError.message);
  }

  const { error: umpireError } = await supabase
    .from("games")
    .update({ umpire_name: input.umpireName || null })
    .eq("id", gameId);
  if (umpireError) throw new Error(umpireError.message);

  revalidatePath(`/coach/games/${gameId}/setup`);
}

export async function startGame(gameId: string) {
  const { supabase, game } = await requireCoachGame(gameId);

  // Feature 1 (lineup-status batch): lineup now also holds reserve/absent
  // rows (no batting order), so counting every row would always clear 9
  // once the roster's large enough regardless of who's actually placed --
  // scope to status='starting' (has a real position + batting order).
  const { count } = await supabase
    .from("lineup")
    .select("id", { count: "exact", head: true })
    .eq("game_id", gameId)
    .eq("status", "starting");

  if (!count || count < 9) throw new Error("Lineup needs at least 9 players");
  if (!game.umpire_name) throw new Error("Umpire name is required");

  const { error } = await supabase.from("games").update({ status: "active" }).eq("id", gameId);
  if (error) throw new Error(error.message);

  revalidatePath("/coach");
}

export async function extractOpponentPhoto(formData: FormData): Promise<ExtractedOpponentPlayer[]> {
  const gameId = String(formData.get("gameId"));
  const { supabase, teamId } = await requireCoachGame(gameId);

  const file = formData.get("photo");
  if (!(file instanceof File)) throw new Error("No photo uploaded");
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Photo must be JPEG, PNG, or WebP");
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const path = `${teamId}/${Date.now()}-${file.name}`;
  const { error: uploadError } = await supabase.storage
    .from("opponent-photos")
    .upload(path, bytes, { contentType: file.type });
  if (uploadError) throw new Error(uploadError.message);

  return extractOpponentRoster(bytes.toString("base64"), file.type as "image/jpeg" | "image/png" | "image/webp");
}

export async function confirmOpponentRoster(
  gameId: string,
  players: { name: string; jersey_number: string; position: string | null }[]
) {
  const { supabase, game } = await requireCoachGame(gameId);
  if (!game.opponent_id) throw new Error("This game has no linked opponent to attach a roster to");
  if (players.length === 0) return;

  const { error } = await supabase.from("opponent_players").insert(
    players.map((p) => ({
      opponent_id: game.opponent_id!,
      name: p.name,
      jersey_number: p.jersey_number || "—",
      position: p.position,
    }))
  );
  if (error) throw new Error(error.message);

  revalidatePath(`/coach/games/${gameId}/setup`);
}

// Feature 2 (game-rules batch): "on the game creation form add a toggle"
// -- this app has no single unified game-creation form (a scheduled game
// comes from the PDF import table, a manual one from a small inline form
// in schedule-table.tsx, neither of which has room for a three-field
// sub-form), so this lives on the game setup page instead: the one
// screen every game -- however it was created -- passes through before
// Start Game. Toggling off clears the game's own values back to null so
// it cleanly falls back to inheriting the season's rules again.
export async function saveGameRulesOverride(
  gameId: string,
  input: { override: boolean; maxInnings: number | null; timeLimitMinutes: number | null; newInningThresholdMinutes: number | null }
) {
  const { supabase } = await requireCoachGame(gameId);
  const { error } = await supabase
    .from("games")
    .update({
      override_season_rules: input.override,
      max_innings: input.override ? input.maxInnings : null,
      time_limit_minutes: input.override ? input.timeLimitMinutes : null,
      new_inning_threshold_minutes: input.override ? input.newInningThresholdMinutes : null,
    })
    .eq("id", gameId);
  if (error) throw new Error(error.message);

  revalidatePath(`/coach/games/${gameId}/setup`);
}
