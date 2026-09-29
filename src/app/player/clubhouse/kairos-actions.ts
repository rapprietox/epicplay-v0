"use server";

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { checkAndConsumeKairosCredit } from "@/lib/kairos-credits";
import { ensureInitialAssessment, regenerateAssessment, type AssessmentZoneInputs } from "@/lib/kairos-assessment";
import { computeBattingLines, formatAvg } from "@/lib/stats";
import { computeZoneBattingLines, computeZoneWhiffLines, zoneIndexFromCoords, extendedZoneLabel, zoneLabel9, resultCategory } from "@/lib/heat-map";
import type { AtBatResult, PitchOutcome } from "@/lib/supabase/types";

// Clubhouse Pro enhancement, Part 3. Mirrors src/app/coach/kairos-actions.ts's
// shape (own Anthropic() client, its own file-local auth guard) but is
// deliberately much smaller: no tool-calling loop at all. The coach
// assistant needs tools because it performs actions (import roster,
// create games, query arbitrary players); this assistant is read-only
// about one already-fully-known dataset (this player's own stats), with
// a hard-scoped refusal for everything else -- no tool a strictly-scoped,
// single-player, read-only assistant would need exists among
// KAIROS_TOOLS anyway (see the plan's own research).
const client = new Anthropic();
const MODEL = "claude-sonnet-5";

async function requirePlayer() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { data: profile } = await supabase.from("profiles").select("role, team_id, player_id").eq("id", user.id).single();
  if (!profile || profile.role !== "player" || !profile.team_id || !profile.player_id) {
    throw new Error("Not authorized");
  }
  return { supabase, teamId: profile.team_id, playerId: profile.player_id };
}

export interface KairosMessage {
  role: "user" | "assistant";
  content: string;
}

export type AskPlayerKairosResult =
  | { ok: true; text: string; remaining: number }
  | { ok: false; reason: "credits_exhausted"; resetDate: string }
  | { ok: false; reason: "error"; error: string };

function extractText(message: Anthropic.Message): string {
  const block = message.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  return block?.text.trim() ?? "";
}

async function fetchPlayerContext(supabase: ReturnType<typeof createClient>, teamId: string, playerId: string) {
  const [{ data: player }, { data: team }, { data: games }] = await Promise.all([
    supabase.from("players").select("name, position").eq("id", playerId).single(),
    supabase.from("teams").select("name").eq("id", teamId).single(),
    supabase.from("games").select("*").eq("team_id", teamId),
  ]);

  const allGames = games ?? [];
  const gameById = new Map(allGames.map((g) => [g.id, g]));
  const gameIds = allGames.map((g) => g.id);

  const { data: atBats } = gameIds.length
    ? await supabase.from("at_bats").select("*").eq("player_id", playerId).in("game_id", gameIds).not("confirmed_at", "is", null)
    : { data: [] };
  const confirmedAtBats = atBats ?? [];
  const atBatIds = confirmedAtBats.map((ab) => ab.id);

  const { data: pitchRows } = atBatIds.length
    ? await supabase.from("pitches").select("at_bat_id, pitch_number, pitch_type, zone_x, zone_y, outcome, swing").in("at_bat_id", atBatIds)
    : { data: [] };
  const pitches = pitchRows ?? [];

  return { player, team, allGames, gameById, confirmedAtBats, pitches };
}

async function buildPlayerSystemPrompt(supabase: ReturnType<typeof createClient>, teamId: string, playerId: string): Promise<string> {
  const { player, team, gameById, confirmedAtBats, pitches } = await fetchPlayerContext(supabase, teamId, playerId);
  const playerName = player?.name ?? "this player";
  const position = player?.position ?? "the field";
  const today = new Date().toISOString().slice(0, 10);

  const battingLine = computeBattingLines(confirmedAtBats, []).get(playerId);
  const statsSummary = battingLine
    ? `${battingLine.ab} AB, ${formatAvg(battingLine.avg)} AVG, ${battingLine.hr} HR, ${battingLine.rbi} RBI, ${formatAvg(battingLine.obp)} OBP, ${formatAvg(battingLine.slg)} SLG, ${battingLine.ops.toFixed(3)} OPS`
    : "No at-bats logged yet.";

  const lastZoneByAtBat = new Map<string, number | null>();
  for (const ab of confirmedAtBats) {
    const forThis = pitches.filter((p) => p.at_bat_id === ab.id).sort((a, b) => b.pitch_number - a.pitch_number);
    const last = forThis[0];
    lastZoneByAtBat.set(ab.id, last && last.zone_x !== null && last.zone_y !== null ? zoneIndexFromCoords(last.zone_x, last.zone_y) : null);
  }
  const decided = confirmedAtBats.filter((ab): ab is typeof ab & { result: AtBatResult } => ab.result !== null);
  const battingZones = computeZoneBattingLines(decided.map((ab) => ({ result: ab.result, zoneIndex: lastZoneByAtBat.get(ab.id) ?? null })))
    .map((line, i) => ({ zoneLabel: zoneLabel9(i), avg: line.avg, ab: line.ab }))
    .filter((z) => z.ab >= 3);
  const heatMapSummary = battingZones.length
    ? battingZones.map((z) => `${z.zoneLabel}: ${formatAvg(z.avg)} AVG (${z.ab} AB)`).join("; ")
    : "Not enough at-bats logged yet to break down by zone.";

  const whiffZones = computeZoneWhiffLines(pitches)
    .map((line, i) => ({ zoneLabel: extendedZoneLabel(i), rate: line.rate }))
    .filter((z): z is { zoneLabel: string; rate: number } => z.rate !== null);
  const sortedByAvg = [...battingZones].sort((a, b) => a.avg - b.avg);
  const weakZones = sortedByAvg.slice(0, 2).map((z) => {
    const whiff = whiffZones.find((w) => w.zoneLabel === z.zoneLabel);
    return `${z.zoneLabel} (${formatAvg(z.avg)} AVG${whiff ? `, ${(whiff.rate * 100).toFixed(0)}% whiff rate` : ""})`;
  });
  const strongZones = [...sortedByAvg]
    .reverse()
    .slice(0, 2)
    .map((z) => `${z.zoneLabel} (${formatAvg(z.avg)} AVG)`);

  const recentGames = Array.from(new Set(decided.map((ab) => ab.game_id)))
    .map((id) => gameById.get(id))
    .filter((g): g is NonNullable<typeof g> => Boolean(g) && g!.status === "completed")
    .sort((a, b) => b!.game_date.localeCompare(a!.game_date))
    .slice(0, 5) as NonNullable<ReturnType<typeof gameById.get>>[];
  const recentAtBats = decided.filter((ab) => recentGames.some((g) => g.id === ab.game_id));
  const recentLine = computeBattingLines(recentAtBats, []).get(playerId);
  const recentForm = recentLine ? `Last ${recentGames.length} games: ${formatAvg(recentLine.avg)} AVG (${recentLine.h}-${recentLine.ab})` : "Not enough recent games logged yet.";

  const sprayTally = new Map<string, number>();
  for (const ab of decided) {
    const cat = resultCategory(ab.result);
    sprayTally.set(cat, (sprayTally.get(cat) ?? 0) + 1);
  }
  const sprayTotal = decided.length;
  const sprayChartSummary = sprayTotal
    ? Array.from(sprayTally.entries())
        .map(([cat, count]) => `${cat}: ${((count / sprayTotal) * 100).toFixed(0)}%`)
        .join(", ")
    : "Not enough batted balls logged yet.";

  return `You are KAIROS -- the personal AI baseball coach for EpicPlay AI.
You are speaking directly to ${playerName}, a ${position} for the ${team?.name ?? "team"}.

Today is ${today}.

YOUR STRICT SCOPE -- you ONLY discuss:
1. This player's personal stats, heat maps, spray charts, and performance data
2. Drill recommendations based on their specific metrics
3. Progress tracking: comparing current vs past performance
4. Baseball technique and mechanics as it relates to their specific weaknesses
5. Context for recommendations: "this drill works because..." (brief)
6. General baseball benchmarks for comparison: "most amateur players at this level..."

YOU WILL NOT:
- Answer general knowledge questions (history, politics, science, etc.)
- Answer questions about specific MLB teams, players, or historical results
- Generate or describe images
- Discuss other players' private data
- Answer anything unrelated to this player's development

When asked something outside your scope, respond:
"I'm focused on your game, ${playerName}. Ask me about your stats, your drills, or how to improve -- that's where I can actually help you."

Never say "I am Claude" or mention Anthropic. You are KAIROS.

This player's current data:
Stats: ${statsSummary}
Heat map (batting average by zone, min 3 AB): ${heatMapSummary}
Weak zones: ${weakZones.length ? weakZones.join("; ") : "Not enough data yet."}
Strong zones: ${strongZones.length ? strongZones.join("; ") : "Not enough data yet."}
Recent form: ${recentForm}
Spray chart breakdown: ${sprayChartSummary}`;
}

export async function askPlayerKairos(history: KairosMessage[], message: string): Promise<AskPlayerKairosResult> {
  try {
    const { supabase, teamId, playerId } = await requirePlayer();
    const service = createServiceRoleClient();

    const credit = await checkAndConsumeKairosCredit(service, playerId);
    if (!credit.allowed) return { ok: false, reason: "credits_exhausted", resetDate: credit.resetDate };

    const system = await buildPlayerSystemPrompt(supabase, teamId, playerId);
    const messages: Anthropic.MessageParam[] = [
      ...history.map((h) => ({ role: h.role, content: h.content }) as Anthropic.MessageParam),
      { role: "user", content: message },
    ];

    const response = await client.messages.create({ model: MODEL, max_tokens: 1024, system, messages });
    const text = extractText(response) || "I couldn't come up with a response to that -- try rephrasing?";
    return { ok: true, text, remaining: credit.remaining };
  } catch (err) {
    console.error("[askPlayerKairos] unexpected error", err);
    return { ok: false, reason: "error", error: err instanceof Error ? err.message : "KAIROS couldn't respond -- try again?" };
  }
}

function zoneInputsFrom(
  confirmedAtBats: Awaited<ReturnType<typeof fetchPlayerContext>>["confirmedAtBats"],
  pitches: Awaited<ReturnType<typeof fetchPlayerContext>>["pitches"]
): { battingZones: { zoneLabel: string; avg: number; ab: number }[]; whiffPitches: AssessmentZoneInputs["whiffPitches"] } {
  const lastZoneByAtBat = new Map<string, number | null>();
  for (const ab of confirmedAtBats) {
    const forThis = pitches.filter((p) => p.at_bat_id === ab.id).sort((a, b) => b.pitch_number - a.pitch_number);
    const last = forThis[0];
    lastZoneByAtBat.set(ab.id, last && last.zone_x !== null && last.zone_y !== null ? zoneIndexFromCoords(last.zone_x, last.zone_y) : null);
  }
  const decided = confirmedAtBats.filter((ab): ab is typeof ab & { result: AtBatResult } => ab.result !== null);
  const battingZones = computeZoneBattingLines(decided.map((ab) => ({ result: ab.result, zoneIndex: lastZoneByAtBat.get(ab.id) ?? null })))
    .map((line, i) => ({ zoneLabel: zoneLabel9(i), avg: line.avg, ab: line.ab }))
    .filter((z) => z.ab >= 3);
  const whiffPitches = pitches.map((p) => ({ swing: p.swing, outcome: p.outcome as PitchOutcome, zone_x: p.zone_x, zone_y: p.zone_y }));
  return { battingZones, whiffPitches };
}

// Called from page.tsx once clubhouse_unlocked is true -- generates the
// welcome assessment only if kairos_initial_assessment is still null
// (see ensureInitialAssessment's own comment on the "generate once"
// scope decision).
export async function getOrCreateInitialAssessment(): Promise<string> {
  const { supabase, teamId, playerId } = await requirePlayer();
  const { player, team, confirmedAtBats, pitches } = await fetchPlayerContext(supabase, teamId, playerId);
  const battingLine = computeBattingLines(confirmedAtBats, []).get(playerId) ?? null;
  const zoneInputs = zoneInputsFrom(confirmedAtBats, pitches);
  return ensureInitialAssessment(playerId, player?.name ?? "this player", player?.position ?? null, team?.name ?? "your team", battingLine, zoneInputs);
}

export async function regenerateInitialAssessment(): Promise<string> {
  const { supabase, teamId, playerId } = await requirePlayer();
  const { player, team, confirmedAtBats, pitches } = await fetchPlayerContext(supabase, teamId, playerId);
  const battingLine = computeBattingLines(confirmedAtBats, []).get(playerId) ?? null;
  const zoneInputs = zoneInputsFrom(confirmedAtBats, pitches);
  return regenerateAssessment(playerId, player?.name ?? "this player", player?.position ?? null, team?.name ?? "your team", battingLine, zoneInputs);
}
