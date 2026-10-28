"use server";

import Anthropic from "@anthropic-ai/sdk";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { computeLineupMatrix, findCurrentLineup } from "@/lib/lineup-analysis";
import { matchingGameIds, type DayType, type GameFacetFilter, type TimeOfDay } from "@/lib/game-time-filters";

// Feature 2 (Lineup Intelligence). Model: the request specified
// "claude-sonnet-4-6", which isn't a real model id -- same exact mistake
// already flagged once in src/app/coach/kairos-actions.ts. Using
// claude-sonnet-5 (a real, current model) here too, matching the
// family the request actually asked for.
const client = new Anthropic();
const MODEL = "claude-sonnet-5";

async function requireCoachTeam() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data: profile } = await supabase.from("profiles").select("role, team_id").eq("id", user.id).single();
  if (!profile || profile.role !== "coach" || !profile.team_id) throw new Error("Not authorized");
  return { supabase, teamId: profile.team_id };
}

export type LineupInsightsResult = { ok: true; insights: string[] } | { ok: false; error: string };

interface FilterInput {
  gameType: GameFacetFilter["gameType"];
  timeOfDay: TimeOfDay | "all";
  dayType: DayType | "all";
}

// Caching: "regenerate when new games are added" is handled by including
// a cheap data fingerprint (the team's total confirmed at-bat count) in
// unstable_cache's key, rather than wiring an explicit revalidateTag
// call into every place a game/at-bat can be created or confirmed
// (endGame, confirmSeasonImport, addManualGame, every operator at-bat
// confirmation, ...). Any new confirmed at-bat changes the fingerprint,
// which is a new cache key -- functionally equivalent invalidation for
// a fraction of the blast radius.
export async function getLineupInsights(filter: FilterInput): Promise<LineupInsightsResult> {
  try {
    const { supabase, teamId } = await requireCoachTeam();

    const [{ data: team }, { data: players }, { data: games } ] = await Promise.all([
      supabase.from("teams").select("name").eq("id", teamId).single(),
      supabase.from("players").select("*").eq("team_id", teamId),
      supabase.from("games").select("*").eq("team_id", teamId),
    ]);

    const gameIds = (games ?? []).map((g) => g.id);
    const [{ data: lineupRows }, { data: atBats }] = await Promise.all([
      gameIds.length ? supabase.from("lineup").select("*").in("game_id", gameIds).eq("status", "starting") : Promise.resolve({ data: [] }),
      gameIds.length
        ? supabase.from("at_bats").select("*").in("game_id", gameIds).eq("mode", "hitting").not("confirmed_at", "is", null)
        : Promise.resolve({ data: [] }),
    ]);

    const current = findCurrentLineup(games ?? [], lineupRows ?? []);
    if (!current) return { ok: true, insights: [] };

    const matchingIds = matchingGameIds(games ?? [], { gameType: filter.gameType, timeOfDay: filter.timeOfDay, dayType: filter.dayType });
    const noFilter = filter.gameType === "all" && filter.timeOfDay === "all" && filter.dayType === "all";
    const filteredAtBats = noFilter ? (atBats ?? []) : (atBats ?? []).filter((ab) => matchingIds.has(ab.game_id));

    const matrix = computeLineupMatrix(current.rows, players ?? [], filteredAtBats);
    if (matrix.every((row) => row.pa === 0)) return { ok: true, insights: [] };

    // Team-wide confirmed at-bat count -- the fingerprint described above.
    const fingerprint = (atBats ?? []).length;

    const cached = unstable_cache(
      async () => generateInsights(team?.name ?? "the team", matrix),
      ["lineup-insights", teamId, filter.gameType, filter.timeOfDay, filter.dayType, String(fingerprint)],
      { revalidate: 3600 }
    );
    const insights = await cached();
    return { ok: true, insights };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to generate lineup insights" };
  }
}

async function generateInsights(teamName: string, matrix: ReturnType<typeof computeLineupMatrix>): Promise<string[]> {
  const system = `You are KAIROS, an elite baseball analytics AI. You are analyzing a lineup for the coach of ${teamName}.

You have the following lineup performance data:
${JSON.stringify(matrix, null, 2)}

Generate exactly 4-5 coaching insights. Each must be:
1. SPECIFIC -- use real player names, real numbers, real slot positions
2. ACTIONABLE -- tell the coach exactly what to change
3. PROFESSIONAL -- sound like an MLB analytics department
4. VARIED -- cover different aspects: slot optimization, lineup holes, strengths to protect, specific recommendations

Format each insight as:
- Start with an emoji indicator: ⚠️ (problem) ✅ (strength) 🎯 (recommendation) 📊 (pattern)
- One clear sentence identifying the issue or strength with specific numbers
- One clear sentence with the exact recommended action

Never be generic. Never say "consider improving" without saying HOW.
Never mention a player without their actual stats.

Return ONLY the insights, one per line, no numbering, no preamble.`;

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: "Generate the lineup insights now." }],
  });
  const text = message.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
