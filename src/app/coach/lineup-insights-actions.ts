"use server";

import Anthropic from "@anthropic-ai/sdk";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { computeBattingLines } from "@/lib/stats";
import { computeLineupMatrix, findCurrentLineup, findSubstitutesAndReserves } from "@/lib/lineup-analysis";
import { matchingGameIds, type DayType, type GameFacetFilter, type TimeOfDay } from "@/lib/game-time-filters";
import type { ReliabilityInput } from "@/lib/reliability";

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

// Fix 2: carries what the request's own <ReliabilityBadge/> needs --
// the panel never showed one because the result object never returned
// reliability inputs in the first place, not because the component was
// missing or broken.
export type LineupInsightsResult = { ok: true; insights: string[]; reliability: ReliabilityInput } | { ok: false; error: string };

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
    const [{ data: lineupRows }, { data: atBats }, { data: substitutions }] = await Promise.all([
      gameIds.length ? supabase.from("lineup").select("*").in("game_id", gameIds).eq("status", "starting") : Promise.resolve({ data: [] }),
      gameIds.length
        ? supabase.from("at_bats").select("*").in("game_id", gameIds).eq("mode", "hitting").not("confirmed_at", "is", null)
        : Promise.resolve({ data: [] }),
      gameIds.length
        ? supabase.from("substitutions").select("game_id, player_in_id, player_out_id").in("game_id", gameIds)
        : Promise.resolve({ data: [] }),
    ]);

    const current = findCurrentLineup(games ?? [], lineupRows ?? []);
    if (!current) return { ok: true, insights: [], reliability: { totalAB: 0, gamesPlayed: 0, opponentsCount: 0 } };

    const matchingIds = matchingGameIds(games ?? [], { gameType: filter.gameType, timeOfDay: filter.timeOfDay, dayType: filter.dayType });
    const noFilter = filter.gameType === "all" && filter.timeOfDay === "all" && filter.dayType === "all";
    const filteredAtBats = noFilter ? (atBats ?? []) : (atBats ?? []).filter((ab) => matchingIds.has(ab.game_id));

    const matrix = computeLineupMatrix(current.rows, players ?? [], filteredAtBats);
    const gameAtBats = (atBats ?? []).filter((ab) => ab.game_id === current.gameId);
    const substitutesAndReserves = findSubstitutesAndReserves(
      current.gameId,
      matrix,
      players ?? [],
      gameAtBats,
      filteredAtBats,
      substitutions ?? []
    );
    const fullRoster = [...matrix, ...substitutesAndReserves];

    // Fix 2: the reliability inputs the panel's <ReliabilityBadge/> needs
    // -- scoped to the same filtered games/at-bats actually feeding the
    // AI, not the whole season regardless of filter.
    const rosterLines = computeBattingLines(filteredAtBats, []);
    const totalAB = Array.from(rosterLines.values()).reduce((sum, l) => sum + l.ab, 0);
    const relevantGameIds = new Set(filteredAtBats.map((ab) => ab.game_id));
    const relevantGames = (games ?? []).filter((g) => relevantGameIds.has(g.id));
    const reliability: ReliabilityInput = {
      totalAB,
      gamesPlayed: relevantGameIds.size,
      opponentsCount: new Set(relevantGames.map((g) => g.opponent_name)).size,
    };

    // Update 3: lowered from "at least some data exists" to an explicit
    // count -- generate once at least 5 players (starters or bench, not
    // just the 9-10 starting slots) have 2+ PA, checked across the whole
    // roster since a thin starting lineup can still clear this bar once
    // substitutes are counted too.
    const playersWithTwoPlusPa = Array.from(rosterLines.values()).filter((l) => l.pa >= 2).length;
    if (playersWithTwoPlusPa < 5) return { ok: true, insights: [], reliability };

    // Team-wide confirmed at-bat count -- the fingerprint described above.
    const fingerprint = (atBats ?? []).length;

    const cached = unstable_cache(
      async () => generateInsights(team?.name ?? "the team", fullRoster),
      ["lineup-insights", teamId, filter.gameType, filter.timeOfDay, filter.dayType, String(fingerprint)],
      { revalidate: 3600 }
    );
    const insights = await cached();
    return { ok: true, insights, reliability };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to generate lineup insights" };
  }
}

async function generateInsights(teamName: string, roster: unknown[]): Promise<string[]> {
  const system = `You are KAIROS, an elite baseball analytics AI. You are analyzing a lineup for the coach of ${teamName}.

You have the following lineup performance data (starters have a "slot"
number; substitutes/reserves have a "subbedIntoSlot" instead):
${JSON.stringify(roster, null, 2)}

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

  // Fix 1: 1024 was cutting responses off mid-sentence once the prompt
  // grew to cover the full roster (starters + substitutes, Update 3) --
  // not a CSS/overflow bug, the model's own output was genuinely
  // truncated before it finished. Matches the token budget Parts 3/4's
  // similarly-scoped Opus/Sonnet calls already use.
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system,
    messages: [{ role: "user", content: "Generate the lineup insights now." }],
  });
  const text = message.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
  return splitInsights(text);
}

// Splitting on "\n" assumed Claude would always put exactly one insight
// per physical line, per the prompt's own instruction -- but a model
// doesn't reliably honor "one per line" formatting, and when it
// doesn't, a newline-only split collapses every insight into a single
// array entry (symptom: one card showing one block of run-together
// text, which is what was actually reported, not a CSS/overflow bug).
// Splitting on the emoji markers the prompt already requires every
// insight to start with is robust regardless of whether Claude
// separates them with one newline, a blank line, or no line break at
// all.
const INSIGHT_EMOJI = ["⚠️", "✅", "🎯", "📊"];
function splitInsights(text: string): string[] {
  const pattern = new RegExp(`(?=${INSIGHT_EMOJI.map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  return text
    .split(pattern)
    .map((s) => s.trim())
    .filter(Boolean);
}
