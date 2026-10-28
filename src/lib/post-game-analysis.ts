import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateReliability } from "@/lib/reliability";
import { recordAgainstOpponent, formatRecord, resultLetter } from "@/lib/opponent-history";
import { AI_MODELS } from "@/lib/ai-models";
import type { Database } from "@/lib/supabase/types";

const client = new Anthropic();

export type PostGameAnalysisType = "post_game_loss" | "post_game_win";

export interface PostGameAnalysisOutput {
  content: string;
  reliabilityPct: number;
}

// Part 4. The request only ever gives a system prompt for the LOSS
// case -- "Coach can also request analysis for wins" has no prompt of
// its own. Adapted the loss prompt's exact structure (same 6 sections,
// same rigor) into a parallel win-framed version rather than reusing
// the loss prompt verbatim ("just lost" wording would be wrong) or
// skipping win analysis outright.
function buildSystemPrompt(
  analysisType: PostGameAnalysisType,
  input: {
    teamName: string;
    ourScore: number;
    opponentScore: number;
    opponentName: string;
    atBatsByInning: string;
    lineupUsed: string;
    substitutionsMade: string;
    scoringPlays: string;
    seasonRecord: string;
  }
): string {
  const resultLine =
    analysisType === "post_game_loss"
      ? `${input.teamName} just lost ${input.ourScore}-${input.opponentScore} to ${input.opponentName}.`
      : `${input.teamName} just beat ${input.opponentName} ${input.ourScore}-${input.opponentScore}.`;

  const decisionLabels =
    analysisType === "post_game_loss"
      ? `💀 BLUNDER — cost us runs/outs\n⚠️ MISTAKE — suboptimal but understandable\n✅ GOOD CALL — right decision`
      : `⚠️ RISKY CALL — worked out but could have backfired\n✅ GOOD CALL — right decision\n🌟 KEY DECISION — directly set up a run or inning`;

  return `You are KAIROS, an elite baseball analytics AI for EpicPlay AI.
${resultLine}

Game data:
${input.atBatsByInning}
${input.lineupUsed}
${input.substitutionsMade}
${input.scoringPlays}

Season context:
${input.seasonRecord}

Analyze this ${analysisType === "post_game_loss" ? "loss" : "win"} like an MLB analytics department. Generate:

1. GAME SUMMARY (2 sentences -- what happened)

2. LINEUP DECISIONS
Rate each lineup decision as:
${decisionLabels}

3. TURNING POINTS
Top 3 moments where the game changed and what could have been done differently

4. WHAT WORKED
${analysisType === "post_game_loss" ? "Even in a loss -- what performed well that should be preserved" : "What performed well and should be repeated"}

5. WHAT TO FIX FOR NEXT GAME
Top 3 specific, actionable fixes with exact recommendations

6. RELIABILITY
How confident is this analysis and why

Never sugarcoat. Be honest. Be specific. Use real numbers.`;
}

export async function generatePostGameAnalysis(
  supabase: SupabaseClient<Database>,
  gameId: string,
  teamId: string,
  analysisType: PostGameAnalysisType
): Promise<PostGameAnalysisOutput> {
  const { data: game } = await supabase.from("games").select("*").eq("id", gameId).single();
  if (!game) throw new Error("Game not found");

  const [{ data: allGames }, { data: atBats }, { data: lineup }, { data: substitutions }] = await Promise.all([
    supabase.from("games").select("*").eq("team_id", teamId),
    supabase.from("at_bats").select("*").eq("game_id", gameId).not("confirmed_at", "is", null),
    supabase.from("lineup").select("*").eq("game_id", gameId).eq("status", "starting").order("batting_order"),
    supabase.from("substitutions").select("*").eq("game_id", gameId),
  ]);

  const playerIds = Array.from(
    new Set([...(lineup ?? []).map((l) => l.player_id), ...(substitutions ?? []).flatMap((s) => [s.player_in_id, s.player_out_id])])
  );
  const { data: players } = playerIds.length ? await supabase.from("players").select("id, name").in("id", playerIds) : { data: [] };
  const nameById = new Map((players ?? []).map((p) => [p.id, p.name]));

  const hittingAtBats = (atBats ?? []).filter((ab) => ab.mode === "hitting");
  const byInning = new Map<number, string[]>();
  for (const ab of hittingAtBats) {
    const name = ab.player_id ? nameById.get(ab.player_id) ?? "Unknown" : "Opponent";
    const list = byInning.get(ab.inning) ?? [];
    list.push(`${name}: ${ab.result ?? "?"}${ab.rbi ? ` (${ab.rbi} RBI)` : ""}${ab.runs_scored ? ` (scored)` : ""}`);
    byInning.set(ab.inning, list);
  }
  const atBatsByInning = Array.from(byInning.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([inning, plays]) => `Inning ${inning}: ${plays.join("; ")}`)
    .join("\n");

  const lineupUsed = `Starting lineup: ${(lineup ?? [])
    .map((l) => `${l.batting_order}. ${nameById.get(l.player_id) ?? "Unknown"} (${l.position ?? "?"})`)
    .join(", ")}`;

  const substitutionsMade = (substitutions ?? []).length
    ? `Substitutions: ${(substitutions ?? [])
        .map((s) => `${nameById.get(s.player_in_id) ?? "Unknown"} in for ${nameById.get(s.player_out_id) ?? "Unknown"} (inning ${s.inning})`)
        .join("; ")}`
    : "Substitutions: none";

  const scoringPlays = `Scoring plays: ${
    hittingAtBats
      .filter((ab) => ab.runs_scored > 0)
      .map((ab) => `inning ${ab.inning} -- ${ab.player_id ? nameById.get(ab.player_id) ?? "Unknown" : "Opponent"} ${ab.result} (${ab.runs_scored} run${ab.runs_scored > 1 ? "s" : ""})`)
      .join("; ") || "none recorded"
  }`;

  const completed = (allGames ?? []).filter((g) => g.status === "completed");
  const wins = completed.filter((g) => resultLetter(g) === "W").length;
  const losses = completed.filter((g) => resultLetter(g) === "L").length;
  const ties = completed.filter((g) => resultLetter(g) === "T").length;
  const recordVsOpponent = formatRecord(recordAgainstOpponent(allGames ?? [], game));
  const seasonRecord = `${wins}-${losses}-${ties} overall, ${recordVsOpponent} vs ${game.opponent_name}`;

  const totalAb = hittingAtBats.filter((ab) => ab.player_id).length;
  const { score: reliabilityPct } = calculateReliability({
    totalAB: totalAb,
    gamesPlayed: completed.length,
    opponentsCount: new Set(completed.map((g) => g.opponent_name)).size,
  });

  const { data: team } = await supabase.from("teams").select("name").eq("id", teamId).single();
  const system = buildSystemPrompt(analysisType, {
    teamName: team?.name ?? "the team",
    ourScore: game.our_score,
    opponentScore: game.opponent_score,
    opponentName: game.opponent_name,
    atBatsByInning: atBatsByInning || "No at-bats recorded",
    lineupUsed,
    substitutionsMade,
    scoringPlays,
    seasonRecord,
  });

  const model = analysisType === "post_game_loss" ? AI_MODELS.postGameLoss : AI_MODELS.postGameWin;
  const response = await client.messages.create({
    model,
    max_tokens: 2048,
    system,
    messages: [{ role: "user", content: "Generate the analysis now." }],
  });
  const content = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";

  await supabase.from("game_analyses").upsert(
    { game_id: gameId, team_id: teamId, analysis_type: analysisType, content, reliability_pct: reliabilityPct },
    { onConflict: "game_id" }
  );

  return { content, reliabilityPct };
}
