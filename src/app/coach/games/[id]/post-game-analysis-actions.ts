"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { generatePostGameAnalysis, type PostGameAnalysisType } from "@/lib/post-game-analysis";

async function requireCoachGame(gameId: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data: profile } = await supabase.from("profiles").select("role, team_id").eq("id", user.id).single();
  if (!profile || profile.role !== "coach" || !profile.team_id) throw new Error("Not authorized");
  const { data: game } = await supabase.from("games").select("*").eq("id", gameId).eq("team_id", profile.team_id).single();
  if (!game) throw new Error("Game not found");
  return { supabase, teamId: profile.team_id, game };
}

export type GameAnalysisResult = { ok: true; content: string; reliabilityPct: number } | { ok: false; error: string };

export async function getStoredGameAnalysis(gameId: string): Promise<{ content: string; reliabilityPct: number; analysisType: string } | null> {
  const { supabase, teamId } = await requireCoachGame(gameId);
  const { data } = await supabase.from("game_analyses").select("content, reliability_pct, analysis_type").eq("game_id", gameId).eq("team_id", teamId).maybeSingle();
  if (!data) return null;
  return { content: data.content, reliabilityPct: data.reliability_pct ?? 0, analysisType: data.analysis_type };
}

// Part 4: "Analyze this game" manual button -- for a win (never
// auto-triggered) or to re-run an existing one. analysisType is derived
// from the game's own actual result, not trusted from the caller, so
// this can't be used to mislabel a loss as a win or vice versa.
export async function requestPostGameAnalysis(gameId: string): Promise<GameAnalysisResult> {
  try {
    const { supabase, teamId, game } = await requireCoachGame(gameId);
    if (game.status !== "completed") return { ok: false, error: "This game hasn't been completed yet." };
    const analysisType: PostGameAnalysisType = game.our_score < game.opponent_score ? "post_game_loss" : "post_game_win";
    const result = await generatePostGameAnalysis(supabase, gameId, teamId, analysisType);
    revalidatePath(`/coach/games/${gameId}/scorebook`);
    revalidatePath("/coach");
    return { ok: true, content: result.content, reliabilityPct: result.reliabilityPct };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to analyze game" };
  }
}
