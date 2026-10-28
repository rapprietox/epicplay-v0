"use server";

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { computeBattingLines } from "@/lib/stats";
import { calculateReliability } from "@/lib/reliability";
import { AI_MODELS } from "@/lib/ai-models";

const client = new Anthropic();

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

export type LiveRating = "EXCELLENT" | "GOOD" | "CONSIDER" | "MISTAKE" | "BLUNDER";

export interface LiveLineupFeedback {
  rating: LiveRating;
  message: string;
  alternative: string | null;
  reliabilityScore: number;
  reliabilityGames: number;
}

export type LiveFeedbackResult = { ok: true; feedback: LiveLineupFeedback } | { ok: false; error: string };

const SLOT_RULES = `Lineup slot rules:
- Slot 1 (Leadoff): Needs OBP > .350, Speed 3+, low K%. NEVER put Speed 1-2 here regardless of OBP.
- Slot 2: High OBP, makes contact, can hit and run
- Slots 3-4 (Core): Highest OPS, best hitters, power OK here
- Slot 4 (Cleanup): Power hitters, HR threat, Speed 1-2 OK here
- Slot 5: Second best power hitter
- Slots 6-7: Solid contact, avg OBP
- Slots 8-9: Weakest hitters, high K% goes here
- NEVER put 100% K% player above slot 7
- Power hitters (HR rate > 0, Speed 1-2) belong in slots 3-6, NOT leadoff`;

// Part 2 (live feedback). "When a player is dragged to a slot" -> this
// fires from LineupBuilder's placePlayer, where the batting slot number
// is already decided (auto-assigned on drop, see that file's own
// comment). Re-derives the player's stats/attributes and the rest of
// the lineup-so-far server-side rather than trusting client-supplied
// numbers for what feeds the AI call -- same principle as Lineup
// Intelligence 1.0's getLineupInsights.
export async function getLiveLineupFeedback(
  gameId: string,
  playerId: string,
  slotNumber: number,
  lineupSoFarPlayerIds: { slot: number; playerId: string }[]
): Promise<LiveFeedbackResult> {
  try {
    const { supabase, teamId } = await requireCoachGame(gameId);

    const [{ data: player }, { data: team }, { data: completedGames }] = await Promise.all([
      supabase.from("players").select("*").eq("id", playerId).eq("team_id", teamId).single(),
      supabase.from("teams").select("name").eq("id", teamId).single(),
      supabase.from("games").select("id, opponent_name").eq("team_id", teamId).eq("status", "completed"),
    ]);
    if (!player) return { ok: false, error: "Player not found" };

    const gameIds = (completedGames ?? []).map((g) => g.id);
    const { data: atBats } = gameIds.length
      ? await supabase.from("at_bats").select("*").eq("player_id", playerId).in("game_id", gameIds).eq("mode", "hitting").not("confirmed_at", "is", null)
      : { data: [] };
    const { data: stolenBases } = gameIds.length ? await supabase.from("stolen_bases").select("*").eq("player_id", playerId).in("game_id", gameIds) : { data: [] };
    const line = computeBattingLines(atBats ?? [], stolenBases ?? []).get(playerId);

    const playedGameIds = new Set((atBats ?? []).map((ab) => ab.game_id));
    const opponentNamesPlayed = new Set(
      (completedGames ?? []).filter((g) => playedGameIds.has(g.id)).map((g) => g.opponent_name)
    );
    const { score: reliabilityScore } = calculateReliability({
      totalAB: line?.ab ?? 0,
      gamesPlayed: playedGameIds.size,
      opponentsCount: opponentNamesPlayed.size,
    });

    const otherPlayerIds = lineupSoFarPlayerIds.map((p) => p.playerId);
    const { data: lineupSoFarPlayers } = otherPlayerIds.length
      ? await supabase.from("players").select("id, name").in("id", otherPlayerIds)
      : { data: [] };
    const nameById = new Map((lineupSoFarPlayers ?? []).map((p) => [p.id, p.name]));
    const lineupSoFarText = lineupSoFarPlayerIds
      .sort((a, b) => a.slot - b.slot)
      .map((p) => `Slot ${p.slot}: ${nameById.get(p.playerId) ?? "Unknown"}`)
      .join(", ") || "Empty so far";

    const avg = line?.avg ?? 0;
    const obp = line?.obp ?? 0;
    const slg = line?.slg ?? 0;
    const ops = line?.ops ?? 0;
    const kPct = line && line.pa > 0 ? line.k / line.pa : 0;
    const bbPct = line && line.pa > 0 ? line.bb / line.pa : 0;

    const system = `You are KAIROS, an elite baseball lineup analyst for EpicPlay AI.
A coach just placed ${player.name} in batting slot ${slotNumber}.

Player data:
- Season stats: AVG ${avg.toFixed(3)}, OBP ${obp.toFixed(3)}, SLG ${slg.toFixed(3)}, OPS ${ops.toFixed(3)}
- K%: ${Math.round(kPct * 100)}%, BB%: ${Math.round(bbPct * 100)}%
- Speed rating: ${player.speed_rating}/5
- Player type: ${player.player_type}
- Home runs: ${line?.hr ?? 0}, Stolen bases: ${line?.sb ?? 0}

Current full lineup so far: ${lineupSoFarText}
Team context: ${team?.name ?? "the team"}, ${gameIds.length} games played

${SLOT_RULES}

Respond with EXACTLY this JSON format:
{
  "rating": "EXCELLENT|GOOD|CONSIDER|MISTAKE|BLUNDER",
  "message": "One sentence explanation with specific numbers",
  "alternative": "One sentence suggesting better option if rating is CONSIDER/MISTAKE/BLUNDER, null if EXCELLENT/GOOD"
}`;

    const response = await client.messages.create({
      model: AI_MODELS.liveLineupFeedback,
      max_tokens: 300,
      system,
      messages: [{ role: "user", content: "Rate this placement now." }],
    });
    const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { ok: false, error: "KAIROS didn't return a readable rating" };
    const parsed = JSON.parse(jsonMatch[0]) as { rating: LiveRating; message: string; alternative: string | null };

    return {
      ok: true,
      feedback: {
        rating: parsed.rating,
        message: parsed.message,
        alternative: parsed.alternative ?? null,
        reliabilityScore,
        reliabilityGames: playedGameIds.size,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to get live feedback" };
  }
}

export type OverrideResult = { ok: true } | { ok: false; error: string };

// Part 2 (override tracking).
export async function logLineupOverride(
  gameId: string,
  playerId: string,
  slot: number,
  aiRating: string,
  overrideReason: string
): Promise<OverrideResult> {
  try {
    const { supabase, teamId } = await requireCoachGame(gameId);
    const { error } = await supabase.from("lineup_overrides").insert({
      team_id: teamId,
      game_id: gameId,
      player_id: playerId,
      slot,
      ai_rating: aiRating,
      override_reason: overrideReason,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to log override" };
  }
}
