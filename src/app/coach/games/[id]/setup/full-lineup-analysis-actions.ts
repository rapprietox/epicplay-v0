"use server";

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { computeBattingLines } from "@/lib/stats";
import { calculateReliability } from "@/lib/reliability";
import { recordAgainstOpponent, formatRecord, resultLetter } from "@/lib/opponent-history";
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

export interface SlotEvaluation {
  slot: number;
  rating: "optimal" | "suboptimal" | "problematic";
  note: string;
}

export interface OptimalLineupSlot {
  slot: number;
  playerName: string;
  playerId: string | null;
  reason: string;
}

export interface FullLineupAnalysis {
  overallAssessment: string;
  slotEvaluations: SlotEvaluation[];
  lineupHoles: string;
  strengthsToProtect: string;
  optimalLineup: OptimalLineupSlot[];
  thingsToWatch: string[];
  reliabilityStatement: string;
  reliabilityPct: number;
}

export type FullLineupAnalysisResult = { ok: true; analysis: FullLineupAnalysis } | { ok: false; error: string };

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

// Part 3 (full lineup analysis). The request's own system prompt asks
// for 7 prose sections with no stated response format (unlike Part 2's
// explicit JSON instruction) -- but "Apply suggested lineup" needs a
// machine-parseable slot/player list, not prose to re-parse by hand.
// Adapted to ask for the same 7 sections' content inside a JSON
// envelope, so the optimal-lineup suggestion is directly actionable
// while every section's wording still comes straight from the model.
export async function getFullLineupAnalysis(
  gameId: string,
  lineup: { slot: number; playerId: string }[]
): Promise<FullLineupAnalysisResult> {
  try {
    const { supabase, teamId, game } = await requireCoachGame(gameId);

    const [{ data: players }, { data: team }, { data: allGames }, { data: opponentPlayers }] = await Promise.all([
      supabase.from("players").select("*").eq("team_id", teamId),
      supabase.from("teams").select("name").eq("id", teamId).single(),
      supabase.from("games").select("*").eq("team_id", teamId),
      game.opponent_id
        ? supabase.from("opponent_players").select("name, position").eq("opponent_id", game.opponent_id)
        : Promise.resolve({ data: [] }),
    ]);
    const playerById = new Map((players ?? []).map((p) => [p.id, p]));

    const completed = (allGames ?? []).filter((g) => g.status === "completed");
    const gameIds = completed.map((g) => g.id);
    const { data: atBats } = gameIds.length
      ? await supabase.from("at_bats").select("*").eq("mode", "hitting").in("game_id", gameIds).not("confirmed_at", "is", null)
      : { data: [] };
    const { data: stolenBases } = gameIds.length ? await supabase.from("stolen_bases").select("*").in("game_id", gameIds) : { data: [] };
    const battingLines = computeBattingLines(atBats ?? [], stolenBases ?? []);

    const lineupWithStats = lineup
      .sort((a, b) => a.slot - b.slot)
      .map((l) => {
        const p = playerById.get(l.playerId);
        const line = battingLines.get(l.playerId);
        return {
          slot: l.slot,
          playerId: l.playerId,
          name: p?.name ?? "Unknown",
          jersey: p?.jersey_number ?? null,
          speedRating: p?.speed_rating ?? 3,
          playerType: p?.player_type ?? "all_rounder",
          avg: line?.avg ?? 0,
          obp: line?.obp ?? 0,
          slg: line?.slg ?? 0,
          ops: line?.ops ?? 0,
          kPct: line && line.pa > 0 ? line.k / line.pa : 0,
          bbPct: line && line.pa > 0 ? line.bb / line.pa : 0,
          hr: line?.hr ?? 0,
          sb: line?.sb ?? 0,
          ab: line?.ab ?? 0,
        };
      });

    const wins = completed.filter((g) => resultLetter(g) === "W").length;
    const losses = completed.filter((g) => resultLetter(g) === "L").length;
    const ties = completed.filter((g) => resultLetter(g) === "T").length;
    const recordVsOpponent = formatRecord(recordAgainstOpponent(allGames ?? [], game));

    const totalAb = lineupWithStats.reduce((sum, l) => sum + l.ab, 0);
    const opponentsFaced = new Set(completed.map((g) => g.opponent_name)).size;
    const { score: reliabilityPct } = calculateReliability({ totalAB: totalAb, gamesPlayed: completed.length, opponentsCount: opponentsFaced });

    const opponentPitchers = (opponentPlayers ?? []).filter((p) => p.position === "P").map((p) => p.name);

    const system = `You are KAIROS, an elite baseball analytics AI for EpicPlay AI.
Analyze this complete batting lineup for ${team?.name ?? "the team"} preparing for ${game.opponent_name} on ${game.game_date}.

Complete lineup with full stats:
${JSON.stringify(lineupWithStats, null, 2)}

Season context:
- Games played: ${completed.length}
- Team record: ${wins}-${losses}-${ties}
- vs ${game.opponent_name}: ${recordVsOpponent}
- Known opponent pitchers: ${opponentPitchers.length ? opponentPitchers.join(", ") : "None recorded"}

Data reliability: ${reliabilityPct}% based on ${totalAb} at-bats across ${completed.length} games

${SLOT_RULES}

Generate a complete analysis with:
1. OVERALL ASSESSMENT (2-3 sentences)
2. SLOT BY SLOT EVALUATION -- for each slot: rating (optimal / suboptimal / problematic) + one sentence why
3. LINEUP HOLES -- consecutive weak slots and the strategic impact
4. STRENGTHS TO PROTECT -- what's working and why to preserve it
5. OPTIMAL LINEUP SUGGESTION -- a complete reordered lineup using the exact player names given above, one-line reason per slot
6. 3 THINGS TO WATCH IN THIS GAME -- specific tactical advice for this matchup
7. RELIABILITY STATEMENT -- be honest about data limitations; if only a couple games, say so clearly

Use real player names and real numbers always. Never be generic. Sound like an MLB analytics department, not a chatbot.

Respond with EXACTLY this JSON shape (playerName must exactly match a name from the lineup data above):
{
  "overallAssessment": "...",
  "slotEvaluations": [{"slot": 1, "rating": "optimal|suboptimal|problematic", "note": "..."}],
  "lineupHoles": "...",
  "strengthsToProtect": "...",
  "optimalLineup": [{"slot": 1, "playerName": "...", "reason": "..."}],
  "thingsToWatch": ["...", "...", "..."],
  "reliabilityStatement": "..."
}`;

    const response = await client.messages.create({
      model: AI_MODELS.fullLineupAnalysis,
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: "Generate the full lineup analysis now." }],
    });
    const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { ok: false, error: "KAIROS didn't return a readable analysis" };
    const parsed = JSON.parse(jsonMatch[0]) as Omit<FullLineupAnalysis, "optimalLineup" | "reliabilityPct"> & {
      optimalLineup: { slot: number; playerName: string; reason: string }[];
    };

    const nameToId = new Map((players ?? []).map((p) => [p.name.trim().toLowerCase(), p.id]));
    const optimalLineup: OptimalLineupSlot[] = parsed.optimalLineup.map((s) => ({
      slot: s.slot,
      playerName: s.playerName,
      playerId: nameToId.get(s.playerName.trim().toLowerCase()) ?? null,
      reason: s.reason,
    }));

    return { ok: true, analysis: { ...parsed, optimalLineup, reliabilityPct } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to analyze lineup" };
  }
}
