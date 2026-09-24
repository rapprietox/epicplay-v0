"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { extractSeasonSchedule, type ExtractedGame } from "@/lib/anthropic";
import type { BattingHand, GameType, ThrowingHand } from "@/lib/supabase/types";

async function requireCoachTeam() {
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
  return { supabase, teamId: profile.team_id };
}

export async function addPlayer(formData: FormData) {
  const { supabase, teamId } = await requireCoachTeam();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Player name is required");

  const jerseyRaw = String(formData.get("jersey_number") ?? "").trim();
  const jersey_number = jerseyRaw ? Number(jerseyRaw) : null;
  const position = String(formData.get("position") ?? "").trim() || null;
  const batting_hand = (String(formData.get("batting_hand") ?? "").trim() || "R") as BattingHand;
  const throwing_hand = (String(formData.get("throwing_hand") ?? "").trim() || "R") as ThrowingHand;

  const { error } = await supabase.from("players").insert({
    team_id: teamId,
    name,
    jersey_number,
    position,
    batting_hand,
    throwing_hand,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/coach");
}

export async function extractSchedulePdf(formData: FormData): Promise<ExtractedGame[]> {
  const { supabase, teamId } = await requireCoachTeam();

  const file = formData.get("pdf");
  if (!(file instanceof File)) throw new Error("No PDF uploaded");
  if (file.type !== "application/pdf") throw new Error("File must be a PDF");

  const { data: team } = await supabase.from("teams").select("name").eq("id", teamId).single();
  if (!team?.name) throw new Error("Team has no name on file");

  const bytes = Buffer.from(await file.arrayBuffer());

  const path = `${teamId}/${Date.now()}-${file.name}`;
  const { error: uploadError } = await supabase.storage
    .from("season-schedules")
    .upload(path, bytes, { contentType: "application/pdf" });
  if (uploadError) throw new Error(uploadError.message);

  return extractSeasonSchedule(bytes.toString("base64"), team.name);
}

export interface ConfirmScheduleGame {
  date: string;
  time: string;
  opponent_name: string;
  home_away: "home" | "away";
  game_type: GameType;
}

export async function confirmSeasonImport(input: {
  seasonName: string;
  seasonYear: number;
  games: ConfirmScheduleGame[];
  // Feature 2 (game-rules batch): all three optional, per spec ("leave
  // blank for no limit" / "default: 10 minutes") -- newInningThresholdMinutes
  // is the one exception with a real default, applied here rather than
  // left to the DB column default so a coach who clears the field back
  // to blank still gets 10, not null-meaning-unset.
  maxInnings: number | null;
  timeLimitMinutes: number | null;
  newInningThresholdMinutes: number | null;
}) {
  const { supabase, teamId } = await requireCoachTeam();
  if (input.games.length === 0) throw new Error("No games to import");

  const dates = [...input.games.map((g) => g.date)].sort();

  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .insert({
      team_id: teamId,
      name: input.seasonName,
      year: input.seasonYear,
      start_date: dates[0],
      end_date: dates[dates.length - 1],
      max_innings: input.maxInnings,
      time_limit_minutes: input.timeLimitMinutes,
      new_inning_threshold_minutes: input.newInningThresholdMinutes ?? 10,
    })
    .select("id")
    .single();
  if (seasonError || !season) throw new Error(seasonError?.message ?? "Failed to create season");

  const opponentIdByName = await upsertOpponents(
    supabase,
    teamId,
    Array.from(new Set(input.games.map((g) => g.opponent_name)))
  );

  const rows = input.games.map((g) => ({
    team_id: teamId,
    season_id: season.id,
    opponent_id: opponentIdByName.get(g.opponent_name) ?? null,
    opponent_name: g.opponent_name,
    game_date: g.date,
    game_time: g.time,
    game_type: g.game_type,
    home_away: g.home_away,
    status: "setup" as const,
  }));

  const { error: gamesError } = await supabase.from("games").insert(rows);
  if (gamesError) throw new Error(gamesError.message);

  revalidatePath("/coach");
}

async function upsertOpponents(
  supabase: Awaited<ReturnType<typeof requireCoachTeam>>["supabase"],
  teamId: string,
  names: string[]
) {
  const idByName = new Map<string, string>();
  for (const name of names) {
    const { data: existing } = await supabase
      .from("opponents")
      .select("id")
      .eq("team_id", teamId)
      .eq("name", name)
      .maybeSingle();
    if (existing) {
      idByName.set(name, existing.id);
      continue;
    }
    const { data: created, error } = await supabase
      .from("opponents")
      .insert({ team_id: teamId, name })
      .select("id")
      .single();
    if (error || !created) throw new Error(error?.message ?? `Failed to create opponent "${name}"`);
    idByName.set(name, created.id);
  }
  return idByName;
}

export async function addManualGame(formData: FormData) {
  const { supabase, teamId } = await requireCoachTeam();

  const opponent_name = String(formData.get("opponent_name") ?? "").trim();
  const game_date = String(formData.get("game_date") ?? "").trim();
  const game_time = String(formData.get("game_time") ?? "").trim() || "TBD";
  const home_away = String(formData.get("home_away") ?? "") as "home" | "away";
  const game_type = String(formData.get("game_type") ?? "") as GameType;

  if (!opponent_name || !game_date) throw new Error("Opponent and date are required");

  const opponentIdByName = await upsertOpponents(supabase, teamId, [opponent_name]);

  const { error } = await supabase.from("games").insert({
    team_id: teamId,
    opponent_id: opponentIdByName.get(opponent_name) ?? null,
    opponent_name,
    game_date,
    game_time,
    home_away,
    game_type,
    status: "setup",
  });
  if (error) throw new Error(error.message);

  revalidatePath("/coach");
}

export async function cancelGame(gameId: string) {
  const { supabase, teamId } = await requireCoachTeam();
  const { error } = await supabase
    .from("games")
    .update({ status: "cancelled" })
    .eq("id", gameId)
    .eq("team_id", teamId);
  if (error) throw new Error(error.message);
  revalidatePath("/coach");
}

export async function editGame(
  gameId: string,
  input: { game_date: string; game_time: string; home_away: "home" | "away"; game_type: GameType }
) {
  const { supabase, teamId } = await requireCoachTeam();
  const { error } = await supabase
    .from("games")
    .update(input)
    .eq("id", gameId)
    .eq("team_id", teamId);
  if (error) throw new Error(error.message);
  revalidatePath("/coach");
}
