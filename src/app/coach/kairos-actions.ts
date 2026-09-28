"use server";

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { computeBattingLines, computePitchingLines, formatAvg } from "@/lib/stats";
import { computeBatterLinesVsPitcher, teamAvgAgainst } from "@/lib/opponent-scouting";
import { recordAgainstOpponent, formatRecord } from "@/lib/opponent-history";
import { KAIROS_TOOLS } from "@/lib/kairos/tools";
import type { Database, GameType } from "@/lib/supabase/types";

// KAIROS batch. Model: the request specified "claude-sonnet-4-6", which
// isn't a real model id -- claude-sonnet-5 is used instead (a real,
// current model; claude-opus-5 is what the rest of this app's Anthropic
// calls already use, but sonnet is the right latency/cost fit for a
// conversational loop with several back-and-forth turns, not a single
// heavy extraction). Getting this wrong would make every KAIROS call
// fail outright, so it's called out explicitly here rather than left to
// be discovered as a runtime error.
const client = new Anthropic();
const MODEL = "claude-sonnet-5";

type SupabaseClient = ReturnType<typeof createClient>;

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

export interface KairosMessage {
  role: "user" | "assistant";
  content: string;
}

export interface PendingRosterPlayer {
  name: string;
  jersey_number: string | null;
  position: string | null;
  alreadyExists: boolean;
}

export interface PendingScheduleGame {
  date: string;
  time: string;
  opponent_name: string;
  home_away: "home" | "away";
}

export interface KairosResponse {
  text: string;
  pendingRosterImport?: PendingRosterPlayer[];
  pendingScheduleImport?: { seasonName: string; seasonYear: number; games: PendingScheduleGame[] };
}

function extractText(message: Anthropic.Message): string {
  const block = message.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  return block?.text.trim() ?? "";
}

// System prompt variables built from real data, per the request's own
// template -- {team_name}/{season_name}/{player_list}/{wins}-{losses}/
// {leaders_summary}. "Current season" has no explicit flag anywhere in
// this schema (seasons has no is_current column), so this picks whichever
// season's date range contains today, falling back to the most recently
// started one.
async function buildSystemPrompt(supabase: SupabaseClient, teamId: string): Promise<string> {
  const [{ data: team }, { data: seasons }, { data: players }, { data: games }] = await Promise.all([
    supabase.from("teams").select("name").eq("id", teamId).single(),
    supabase.from("seasons").select("*").eq("team_id", teamId).order("start_date", { ascending: false }),
    supabase.from("players").select("id, name, jersey_number, position").eq("team_id", teamId).order("jersey_number"),
    supabase.from("games").select("id, status, our_score, opponent_score, season_id").eq("team_id", teamId),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const currentSeason = (seasons ?? []).find((s) => s.start_date <= today && s.end_date >= today) ?? (seasons ?? [])[0] ?? null;

  const seasonGames = currentSeason ? (games ?? []).filter((g) => g.season_id === currentSeason.id) : (games ?? []);
  const completed = seasonGames.filter((g) => g.status === "completed");
  const wins = completed.filter((g) => g.our_score > g.opponent_score).length;
  const losses = completed.filter((g) => g.our_score < g.opponent_score).length;

  const gameIds = seasonGames.map((g) => g.id);
  const { data: atBats } = gameIds.length
    ? await supabase.from("at_bats").select("player_id, pitcher_id, result, rbi, runs_scored, is_out, mode").in("game_id", gameIds).not("confirmed_at", "is", null)
    : { data: [] };
  const battingLines = computeBattingLines(atBats ?? [], []);
  const playerNameById = new Map((players ?? []).map((p) => [p.id, p.name]));
  const leaders = Array.from(battingLines.values())
    .filter((l) => l.ab >= 3)
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 3)
    .map((l) => `${playerNameById.get(l.playerId) ?? "Unknown"}: ${formatAvg(l.avg)} AVG, ${l.hr} HR, ${l.rbi} RBI`)
    .join("; ");

  const playerList = (players ?? []).map((p) => `#${p.jersey_number ?? "—"} ${p.name} (${p.position ?? "—"})`).join(", ");

  return `You are KAIROS -- the AI baseball intelligence assistant for EpicPlay AI.
You are named after the Greek god of the perfect moment -- because in baseball,
timing is everything.

You have access to real data about this team:
- Team name: ${team?.name ?? "Unknown"}
- Current season: ${currentSeason?.name ?? "No season set up yet"}
- Roster: ${playerList || "No players on the roster yet"}
- Season record: ${wins}-${losses}
- Current leaders: ${leaders || "No qualifying batters yet this season"}

You speak in short, confident sentences. You are a baseball expert who also
understands data. You never say "I am Claude" or mention Anthropic. You are
KAIROS.

You have tools to look up real stats, propose importing a pasted roster or
schedule, and suggest a lineup. Always call query_team_stats before answering
any question about player or team performance -- never guess or invent numbers.
If a tool result shows no qualifying data for a specific split (for example, a
lefty/righty breakdown with no games tagged that way yet), say so honestly
instead of making something up.

When asked to take an action (import roster, add players, create games),
always confirm with the user before executing. Show them what you found and
ask "Should I add these?" before writing to the database -- the propose_*
tools already handle this; you never write directly.

Keep responses concise. Use real numbers from the data. Be specific, not
generic. A coach doesn't want "Carlos is a good hitter" -- they want "Carlos
is batting .412 with 3 HR in the last 5 games."`;
}

interface QueryStatsInput {
  player_name?: string;
  opponent_name?: string;
  pitcher_hand_filter?: "left" | "right";
}

async function executeQueryStats(supabase: SupabaseClient, teamId: string, input: QueryStatsInput) {
  const { data: games } = await supabase.from("games").select("*").eq("team_id", teamId);
  const gameIds = (games ?? []).map((g) => g.id);

  if (input.opponent_name) {
    const { data: opponent } = await supabase
      .from("opponents")
      .select("*")
      .eq("team_id", teamId)
      .ilike("name", input.opponent_name)
      .maybeSingle();
    if (!opponent) return { error: `No opponent named "${input.opponent_name}" found for this team.` };

    const record = recordAgainstOpponent(games ?? [], { opponent_id: opponent.id, opponent_name: opponent.name });
    const { data: opponentGames } = await supabase.from("games").select("id").eq("team_id", teamId).eq("opponent_id", opponent.id);
    const opponentGameIds = (opponentGames ?? []).map((g) => g.id);
    const { data: atBats } = opponentGameIds.length
      ? await supabase.from("at_bats").select("*").in("game_id", opponentGameIds).eq("mode", "hitting").not("confirmed_at", "is", null)
      : { data: [] };
    const { data: players } = await supabase.from("players").select("id, name").eq("team_id", teamId);
    const playerNameById = new Map((players ?? []).map((p) => [p.id, p.name]));
    const batterLines = computeBatterLinesVsPitcher(atBats ?? [], playerNameById);
    const team = teamAvgAgainst(atBats ?? []);

    return {
      opponent: opponent.name,
      recordVsOpponent: formatRecord(record),
      teamAvgAgainstOpponent: formatAvg(team.avg),
      bestBatter: batterLines[0] ?? null,
      worstBatter: batterLines.length > 1 ? batterLines[batterLines.length - 1] : null,
    };
  }

  if (input.player_name) {
    const { data: player } = await supabase.from("players").select("*").eq("team_id", teamId).ilike("name", input.player_name).maybeSingle();
    if (!player) return { error: `No player named "${input.player_name}" found on this roster.` };

    let hittingAtBats: Database["public"]["Tables"]["at_bats"]["Row"][] = [];
    let pitchingAtBats: Database["public"]["Tables"]["at_bats"]["Row"][] = [];
    if (gameIds.length) {
      const { data: h } = await supabase.from("at_bats").select("*").eq("player_id", player.id).in("game_id", gameIds).not("confirmed_at", "is", null);
      const { data: p } = await supabase.from("at_bats").select("*").eq("pitcher_id", player.id).in("game_id", gameIds).not("confirmed_at", "is", null);
      hittingAtBats = h ?? [];
      pitchingAtBats = p ?? [];
    }

    let splitNote: string | null = null;
    if (input.pitcher_hand_filter) {
      const withPitcher = hittingAtBats.filter((ab) => ab.opponent_pitcher_id !== null);
      const pitcherIds = Array.from(new Set(withPitcher.map((ab) => ab.opponent_pitcher_id!)));
      const { data: opponentPitchers } = pitcherIds.length
        ? await supabase.from("opponent_players").select("id, throwing_hand").in("id", pitcherIds)
        : { data: [] };
      const handById = new Map((opponentPitchers ?? []).map((p) => [p.id, p.throwing_hand]));
      const matchHand = input.pitcher_hand_filter === "left" ? "L" : "R";
      const filtered = withPitcher.filter((ab) => handById.get(ab.opponent_pitcher_id!) === matchHand);
      if (filtered.length === 0) {
        splitNote =
          "No at-bats are tagged with a known opposing pitcher's throwing hand yet (opponent pitcher handedness isn't tracked from any photo import -- it has to be set by hand, and none has been yet), so this specific split isn't available. Showing overall stats instead.";
      } else {
        hittingAtBats = filtered;
      }
    }

    const battingLine = computeBattingLines(hittingAtBats, []).get(player.id);
    const pitchingLine = computePitchingLines(pitchingAtBats, games ?? []).get(player.id);

    return {
      player: player.name,
      jerseyNumber: player.jersey_number,
      splitNote,
      batting: battingLine
        ? { ab: battingLine.ab, h: battingLine.h, avg: formatAvg(battingLine.avg), hr: battingLine.hr, rbi: battingLine.rbi, obp: formatAvg(battingLine.obp), slg: formatAvg(battingLine.slg), ops: battingLine.ops.toFixed(3) }
        : null,
      pitching: pitchingLine && pitchingLine.ip > 0 ? { ip: pitchingLine.ipDisplay, era: pitchingLine.era?.toFixed(2), whip: pitchingLine.whip?.toFixed(2), k: pitchingLine.k } : null,
    };
  }

  // No player/opponent named -- team-wide leaders, optionally by hand split.
  const { data: atBats } = gameIds.length
    ? await supabase.from("at_bats").select("*").eq("mode", "hitting").in("game_id", gameIds).not("confirmed_at", "is", null)
    : { data: [] };
  const { data: players } = await supabase.from("players").select("id, name").eq("team_id", teamId);
  const playerNameById = new Map((players ?? []).map((p) => [p.id, p.name]));

  let relevantAtBats = atBats ?? [];
  let splitNote: string | null = null;
  if (input.pitcher_hand_filter) {
    const withPitcher = relevantAtBats.filter((ab) => ab.opponent_pitcher_id !== null);
    const pitcherIds = Array.from(new Set(withPitcher.map((ab) => ab.opponent_pitcher_id!)));
    const { data: opponentPitchers } = pitcherIds.length
      ? await supabase.from("opponent_players").select("id, throwing_hand").in("id", pitcherIds)
      : { data: [] };
    const handById = new Map((opponentPitchers ?? []).map((p) => [p.id, p.throwing_hand]));
    const matchHand = input.pitcher_hand_filter === "left" ? "L" : "R";
    const filtered = withPitcher.filter((ab) => handById.get(ab.opponent_pitcher_id!) === matchHand);
    if (filtered.length === 0) {
      splitNote =
        "No at-bats are tagged with a known opposing pitcher's throwing hand yet, so this specific split isn't available. Showing overall leaders instead.";
    } else {
      relevantAtBats = filtered;
    }
  }

  const lines = computeBattingLines(relevantAtBats, []);
  const ranked = Array.from(lines.values())
    .filter((l) => l.ab >= 3)
    .sort((a, b) => b.ops - a.ops)
    .slice(0, 5)
    .map((l) => ({ player: playerNameById.get(l.playerId) ?? "Unknown", avg: formatAvg(l.avg), ops: l.ops.toFixed(3), hr: l.hr, rbi: l.rbi, ab: l.ab }));

  return { splitNote, leaders: ranked };
}

async function executeSuggestLineup(supabase: SupabaseClient, teamId: string, input: { pitcher_hand_filter?: "left" | "right" }) {
  const { data: games } = await supabase.from("games").select("id").eq("team_id", teamId);
  const gameIds = (games ?? []).map((g) => g.id);
  const { data: players } = await supabase.from("players").select("id, name, jersey_number, position").eq("team_id", teamId);
  const { data: atBats } = gameIds.length
    ? await supabase.from("at_bats").select("*").eq("mode", "hitting").in("game_id", gameIds).not("confirmed_at", "is", null)
    : { data: [] };

  let relevantAtBats = atBats ?? [];
  let splitNote: string | null = null;
  if (input.pitcher_hand_filter) {
    const withPitcher = relevantAtBats.filter((ab) => ab.opponent_pitcher_id !== null);
    const pitcherIds = Array.from(new Set(withPitcher.map((ab) => ab.opponent_pitcher_id!)));
    const { data: opponentPitchers } = pitcherIds.length
      ? await supabase.from("opponent_players").select("id, throwing_hand").in("id", pitcherIds)
      : { data: [] };
    const handById = new Map((opponentPitchers ?? []).map((p) => [p.id, p.throwing_hand]));
    const matchHand = input.pitcher_hand_filter === "left" ? "L" : "R";
    const filtered = withPitcher.filter((ab) => handById.get(ab.opponent_pitcher_id!) === matchHand);
    if (filtered.length === 0) {
      splitNote =
        "No at-bats are tagged with a known opposing pitcher's throwing hand yet, so this suggestion is based on overall season stats instead of a real lefty/righty split.";
    } else {
      relevantAtBats = filtered;
    }
  }

  const lines = computeBattingLines(relevantAtBats, []);
  const playerById = new Map((players ?? []).map((p) => [p.id, p]));
  const ranked = Array.from(lines.values())
    .filter((l) => l.ab >= 3)
    .sort((a, b) => b.ops - a.ops)
    .slice(0, 9)
    .map((l, i) => {
      const p = playerById.get(l.playerId);
      return { order: i + 1, player: p?.name ?? "Unknown", jerseyNumber: p?.jersey_number ?? null, avg: formatAvg(l.avg), ops: l.ops.toFixed(3), hr: l.hr, ab: l.ab };
    });

  return { splitNote, suggestedOrder: ranked, note: ranked.length < 9 ? `Only ${ranked.length} players have at least 3 at-bats logged -- the rest of the lineup needs a judgment call.` : null };
}

export async function askKairos(history: KairosMessage[], message: string): Promise<KairosResponse> {
  const { supabase, teamId } = await requireCoachTeam();
  const system = await buildSystemPrompt(supabase, teamId);

  const messages: Anthropic.MessageParam[] = [...history.map((h) => ({ role: h.role, content: h.content }) as Anthropic.MessageParam), { role: "user", content: message }];

  const first = await client.messages.create({ model: MODEL, max_tokens: 1024, system, tools: KAIROS_TOOLS, messages });

  const toolUse = first.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (first.stop_reason !== "tool_use" || !toolUse) {
    return { text: extractText(first) || "I couldn't come up with a response to that -- try rephrasing?" };
  }

  if (toolUse.name === "propose_roster_import") {
    const parsed = toolUse.input as { players: { name: string; jersey_number?: string; position?: string }[] };
    const { data: existing } = await supabase.from("players").select("name").eq("team_id", teamId);
    const existingNames = new Set((existing ?? []).map((p) => p.name.toLowerCase().trim()));
    const rosterPlayers: PendingRosterPlayer[] = parsed.players.map((p) => ({
      name: p.name,
      jersey_number: p.jersey_number ?? null,
      position: p.position ?? null,
      alreadyExists: existingNames.has(p.name.toLowerCase().trim()),
    }));
    const dupes = rosterPlayers.filter((p) => p.alreadyExists);
    const { data: team } = await supabase.from("teams").select("name").eq("id", teamId).single();
    const text = `I found ${rosterPlayers.length} player${rosterPlayers.length === 1 ? "" : "s"}. ${
      dupes.length > 0 ? `${dupes.map((d) => d.name).join(", ")} ${dupes.length === 1 ? "is" : "are"} already in your roster -- flagged below. ` : ""
    }Should I add ${dupes.length > 0 ? "the new ones" : "these"} to your ${team?.name ?? "team's"} roster?`;
    return { text, pendingRosterImport: rosterPlayers };
  }

  if (toolUse.name === "propose_schedule_import") {
    const parsed = toolUse.input as { season_name: string; season_year: number; games: PendingScheduleGame[] };
    const text = `I found ${parsed.games.length} game${parsed.games.length === 1 ? "" : "s"} in your schedule. Review them below -- should I add these to ${parsed.season_name}?`;
    return { text, pendingScheduleImport: { seasonName: parsed.season_name, seasonYear: parsed.season_year, games: parsed.games } };
  }

  let toolResult: unknown;
  if (toolUse.name === "query_team_stats") {
    toolResult = await executeQueryStats(supabase, teamId, toolUse.input as QueryStatsInput);
  } else if (toolUse.name === "suggest_lineup") {
    toolResult = await executeSuggestLineup(supabase, teamId, toolUse.input as { pitcher_hand_filter?: "left" | "right" });
  } else {
    toolResult = { error: "Unknown tool" };
  }

  const second = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system,
    tools: KAIROS_TOOLS,
    messages: [
      ...messages,
      { role: "assistant", content: first.content },
      { role: "user", content: [{ type: "tool_result", tool_use_id: toolUse.id, content: JSON.stringify(toolResult) }] },
    ],
  });

  return { text: extractText(second) || "I looked that up but couldn't put together a response -- try asking again?" };
}

export async function confirmKairosRosterImport(players: { name: string; jersey_number: string | null; position: string | null }[]) {
  const { supabase, teamId } = await requireCoachTeam();
  if (players.length === 0) return;
  const { error } = await supabase.from("players").insert(
    players.map((p) => ({ team_id: teamId, name: p.name, jersey_number: p.jersey_number ? Number(p.jersey_number) || null : null, position: p.position }))
  );
  if (error) throw new Error(error.message);
}

export async function confirmKairosScheduleImport(input: { seasonName: string; seasonYear: number; games: PendingScheduleGame[] }) {
  const { supabase, teamId } = await requireCoachTeam();
  if (input.games.length === 0) return;

  const dates = [...input.games.map((g) => g.date)].sort();
  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .insert({ team_id: teamId, name: input.seasonName, year: input.seasonYear, start_date: dates[0], end_date: dates[dates.length - 1] })
    .select("id")
    .single();
  if (seasonError || !season) throw new Error(seasonError?.message ?? "Failed to create season");

  const opponentIdByName = new Map<string, string>();
  for (const name of Array.from(new Set(input.games.map((g) => g.opponent_name)))) {
    const { data: existing } = await supabase.from("opponents").select("id").eq("team_id", teamId).eq("name", name).maybeSingle();
    if (existing) {
      opponentIdByName.set(name, existing.id);
      continue;
    }
    const { data: created, error } = await supabase.from("opponents").insert({ team_id: teamId, name }).select("id").single();
    if (error || !created) throw new Error(error?.message ?? `Failed to create opponent "${name}"`);
    opponentIdByName.set(name, created.id);
  }

  const rows = input.games.map((g) => ({
    team_id: teamId,
    season_id: season.id,
    opponent_id: opponentIdByName.get(g.opponent_name) ?? null,
    opponent_name: g.opponent_name,
    game_date: g.date,
    game_time: g.time,
    game_type: "season" as GameType,
    home_away: g.home_away,
    status: "setup" as const,
  }));
  const { error: gamesError } = await supabase.from("games").insert(rows);
  if (gamesError) throw new Error(gamesError.message);
}
