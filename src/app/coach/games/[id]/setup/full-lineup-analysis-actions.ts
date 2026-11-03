"use server";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { computeBattingLines } from "@/lib/stats";
import { calculateReliability } from "@/lib/reliability";
import { recordAgainstOpponent, formatRecord, resultLetter } from "@/lib/opponent-history";
import { AI_MODELS } from "@/lib/ai-models";

const client = new Anthropic();

// Bug fix (feature/lineup-drafts): "Analyze Full Lineup" was failing with
// a raw JSON.parse error ("Expected ',' or ']' after array element...")
// shown directly to the coach. Root cause, confirmed against the exact
// error text: the old code asked for free-text with an embedded JSON
// object (client.messages.create + a hand-written
// text.match(/\{[\s\S]*\}/) + JSON.parse), with no escaping guarantee on
// any of the 20+ short prose fields the model writes (slot notes,
// optimal-lineup reasons, the assessment/holes/strengths/reliability
// paragraphs). "Expected ',' or ']' after array element" is exactly
// what V8 produces when a string value contains an unescaped internal
// double quote (common in analyst-voice prose that quotes a phrase for
// emphasis) -- the string closes early, and the next raw character
// isn't the comma/bracket the parser now expects. A 2048 max_tokens cap
// on a response with ~20 free-text fields was a secondary truncation
// risk on top of that, but doesn't match this specific error message
// (truncation produces "Unexpected end of JSON input," not this).
//
// Fixed by switching to the Anthropic SDK's own structured-output
// helper (client.messages.parse + zodOutputFormat) -- the same
// mechanism src/lib/anthropic.ts already uses for every other one-shot
// extraction in this app (schedule/roster extraction, zone insights,
// voice command parsing). The API constrains sampling to the schema
// itself, which eliminates this entire class of bug (no hand-written
// JSON to go wrong) rather than just parsing more defensively around
// it. A schema violation or a truncated reply still throws (see
// parseOutputFormat in the SDK's own lib/parser.ts) -- callOnce() below
// is retried exactly once on any such failure before giving up with a
// plain, friendly message. See live-feedback-actions.ts for the
// identical fix applied to the live per-slot rating, which had the same
// hand-written-JSON weakness; post-game analysis
// (src/lib/post-game-analysis.ts) was checked too and never parses JSON
// at all -- it stores the model's prose directly, so it was never
// exposed to this bug.
const SlotEvaluationSchema = z.object({
  slot: z.number(),
  rating: z.enum(["optimal", "suboptimal", "problematic"]),
  note: z.string().describe("One short sentence, under 20 words."),
});
const RawOptimalLineupSlotSchema = z.object({
  slot: z.number(),
  playerName: z.string(),
  reason: z.string().describe("One short sentence, under 15 words."),
});
const FullLineupAnalysisSchema = z.object({
  overallAssessment: z.string().describe("2-3 sentences."),
  slotEvaluations: z.array(SlotEvaluationSchema),
  lineupHoles: z.string().describe("2-3 sentences."),
  strengthsToProtect: z.string().describe("2-3 sentences."),
  optimalLineup: z.array(RawOptimalLineupSlotSchema),
  thingsToWatch: z.array(z.string().describe("One short sentence, under 20 words.")).length(3),
  reliabilityStatement: z.string().describe("1-2 sentences."),
});
type RawFullLineupAnalysis = z.infer<typeof FullLineupAnalysisSchema>;

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
2. SLOT BY SLOT EVALUATION -- for each slot: rating (optimal / suboptimal / problematic) + one short sentence why (under 20 words)
3. LINEUP HOLES -- consecutive weak slots and the strategic impact (2-3 sentences)
4. STRENGTHS TO PROTECT -- what's working and why to preserve it (2-3 sentences)
5. OPTIMAL LINEUP SUGGESTION -- a complete reordered lineup using the exact player names given above, one short reason per slot (under 15 words)
6. EXACTLY 3 THINGS TO WATCH IN THIS GAME -- specific tactical advice for this matchup, one short sentence each (under 20 words)
7. RELIABILITY STATEMENT -- be honest about data limitations; if only a couple games, say so clearly (1-2 sentences)

Use real player names and real numbers always. Never be generic. Sound like an MLB analytics department, not a chatbot.
Keep every field within its stated length -- short, specific, no padding. Never wrap a word or phrase in double quotes for emphasis; use italics-free plain language instead.`;

    const callOnce = async (): Promise<RawFullLineupAnalysis> => {
      const response = await client.messages.parse({
        model: AI_MODELS.fullLineupAnalysis,
        max_tokens: 4096,
        system,
        messages: [{ role: "user", content: "Generate the full lineup analysis now." }],
        output_config: { format: zodOutputFormat(FullLineupAnalysisSchema) },
      });
      if (!response.parsed_output) throw new Error("KAIROS didn't return a structured analysis");
      return response.parsed_output;
    };

    let parsed: RawFullLineupAnalysis;
    try {
      parsed = await callOnce();
    } catch {
      try {
        parsed = await callOnce();
      } catch {
        return { ok: false, error: "Analysis unavailable, try again." };
      }
    }

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
