"use server";

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { computeBattingLines, computePitchingLines, formatAvg } from "@/lib/stats";
import { computeBatterLinesVsPitcher, teamAvgAgainst } from "@/lib/opponent-scouting";
import { recordAgainstOpponent, formatRecord } from "@/lib/opponent-history";
import { computeZoneKairosProfile, type ZoneKairosLine, type ZoneKairosPitch } from "@/lib/heat-map";
import { KAIROS_TOOLS } from "@/lib/kairos/tools";
import { fetchInChunks, fetchAllRows } from "@/lib/supabase/safe-fetch";
import type { Database, GameType, LoggingMode } from "@/lib/supabase/types";

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
  // KAIROS zone-query batch: surfaced so a token-cost test harness can
  // report real numbers (see askKairos's own comment) -- the production
  // chat UI (kairos-chat.tsx) never reads this field, it just stays unused
  // there, same as any other optional response field it doesn't render.
  // cacheCreationInputTokens/cacheReadInputTokens added for the prompt-
  // caching batch, summed the same way across both calls when a tool is
  // used -- 0 for both on a cold cache (nothing to read yet), a real
  // cacheCreationInputTokens on the call that first writes the cache
  // entry, and a real cacheReadInputTokens on any call that hits it.
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number; cacheCreationInputTokens: number; cacheReadInputTokens: number };
}

// KAIROS zone-query batch: lets askKairos be called from outside a real
// Next.js request (a test script has no cookies for requireCoachTeam's
// createClient() to read) by handing it an already-built client + team id
// directly -- the exact "injectable client" the server action needs for a
// real, non-mocked test. Never used by the production chat UI (it only
// ever calls askKairos(history, message)), which keeps going through
// requireCoachTeam()/cookie auth exactly as before.
export interface KairosTestOverride {
  supabase: SupabaseClient;
  teamId: string;
}

function extractText(message: Anthropic.Message): string {
  const block = message.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  return block?.text.trim() ?? "";
}

// Data-reliability batch: pulled out of buildSystemPrompt specifically so
// a regression test can call the SAME code KAIROS's roster line is built
// from, rather than a hand-rewritten copy that could silently drift from
// it. Self-contained (does its own `games` fetch rather than taking one
// in) so a test can call it with nothing but a team id. Team-wide, every
// game ever -- matching coach/page.tsx's own default (unscoped-by-season)
// view, which is the whole point: this is what "the numbers always
// agree" means in practice. See scripts/test-kairos-roster-scope.ts.
export async function computeKairosRosterBattingLines(supabase: SupabaseClient, teamId: string): Promise<Map<string, ReturnType<typeof computeBattingLines> extends Map<string, infer V> ? V : never>> {
  const { data: games } = await supabase.from("games").select("id").eq("team_id", teamId);
  const gameIds = (games ?? []).map((g) => g.id);
  if (gameIds.length === 0) return new Map();

  const atBats = await fetchAllRows<Database["public"]["Tables"]["at_bats"]["Row"]>(supabase, "at_bats", "*", (q) =>
    q.in("game_id", gameIds).eq("mode", "hitting").not("confirmed_at", "is", null)
  );
  const { data: stolenBases } = await supabase.from("stolen_bases").select("player_id").in("game_id", gameIds);
  return computeBattingLines(atBats, stolenBases ?? []);
}

// System prompt variables built from real data, per the request's own
// template -- {team_name}/{season_name}/{player_list}/{wins}-{losses}/
// {leaders_summary}, expanded by the KAIROS fixes batch to cover every
// player's full line (not just the top 3), every opponent faced, the
// current active game, and today's date/time. "Current season" has no
// explicit flag anywhere in this schema (seasons has no is_current
// column), so this picks whichever season's date range contains today,
// falling back to the most recently started one.
async function buildSystemPrompt(supabase: SupabaseClient, teamId: string): Promise<string> {
  const [{ data: team }, { data: seasons }, { data: players }, { data: games }, { data: opponents }] = await Promise.all([
    supabase.from("teams").select("name").eq("id", teamId).single(),
    supabase.from("seasons").select("*").eq("team_id", teamId).order("start_date", { ascending: false }),
    supabase.from("players").select("id, name, jersey_number, position").eq("team_id", teamId).order("jersey_number"),
    supabase.from("games").select("*").eq("team_id", teamId),
    supabase.from("opponents").select("id, name").eq("team_id", teamId),
  ]);

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const currentSeason = (seasons ?? []).find((s) => s.start_date <= today && s.end_date >= today) ?? (seasons ?? [])[0] ?? null;

  // "Current season" record (wins/losses) stays season-scoped -- that's a
  // narrative fact ("what season is this"), not the per-player stat line
  // below, and nothing reported it as wrong.
  const seasonGames = currentSeason ? (games ?? []).filter((g) => g.season_id === currentSeason.id) : (games ?? []);
  const completed = seasonGames.filter((g) => g.status === "completed");
  const wins = completed.filter((g) => g.our_score > g.opponent_score).length;
  const losses = completed.filter((g) => g.our_score < g.opponent_score).length;

  // Data-reliability batch: the roster stat line below used to scope to
  // `seasonGames` too, which is what "Jordan Blake: 47 AB" (real total 67)
  // looked like a season-boundary bug -- it wasn't. This team has exactly
  // one season covering all of its games, so seasonGames was already every
  // game; the real cause was the next line down never paginating a query
  // that can return more than PostgREST's 1000-row default (confirmed
  // live: this team's own at_bats table is past that now). Fixed with
  // fetchAllRows. Separately, and for the same reason the dashboard and
  // KAIROS need to "always agree": coach/page.tsx's own Team Leaders/Team
  // Hitting/Lineup Analysis default view is NOT season-scoped at all --
  // `.eq("team_id", teamId)` with no season filter, i.e. every game ever.
  // Scoping the roster line to `allGameIds` here instead of `seasonGames`
  // is what actually makes the two match, including for a team with more
  // than one season on record (where the old `seasonGames` scope would
  // have silently disagreed with the dashboard even without the row cap).
  //
  // KAIROS fixes batch, Fix 4: every player's full line, not just a top-3
  // summary -- "KAIROS should NEVER say 'I don't have data on that
  // player' if that player is on the roster." A 0-AB player still gets a
  // line (ab: 0), explicitly, rather than being silently omitted, so
  // Fix 5's "no at-bats logged yet" case is something the model can see
  // directly instead of inferring from an absence.
  const allGameIds = (games ?? []).map((g) => g.id);
  // Fix: stolen bases were never fetched here, so computeBattingLines was
  // always called with [] for stolenBases -- every player's own `sb`
  // silently computed to 0 regardless of what src/lib/stats.ts's own
  // counter does with real rows (same function the Team Leaders card
  // uses). Caught stealing only lives in game_events (no stolen_bases
  // equivalent), tallied the same way coach/page.tsx's EPS fetch already
  // does, so the two SB figures stay in sync with that card too. Now
  // folded into computeKairosRosterBattingLines above, the same function
  // the new regression test calls directly.
  const battingLines = await computeKairosRosterBattingLines(supabase, teamId);
  const pitchingAtBats = allGameIds.length
    ? await fetchAllRows<Database["public"]["Tables"]["at_bats"]["Row"]>(supabase, "at_bats", "*", (q) =>
        q.in("game_id", allGameIds).eq("mode", "pitching").not("confirmed_at", "is", null)
      )
    : [];
  const { data: caughtStealingEvents } = allGameIds.length
    ? await supabase.from("game_events").select("player_id").in("game_id", allGameIds).eq("event_type", "caught_stealing")
    : { data: [] };
  const caughtStealingByPlayer = new Map<string, number>();
  for (const ev of caughtStealingEvents ?? []) {
    if (!ev.player_id) continue;
    caughtStealingByPlayer.set(ev.player_id, (caughtStealingByPlayer.get(ev.player_id) ?? 0) + 1);
  }
  // `pitchingAtBats` is now scoped to every game (see allGameIds above),
  // not just seasonGames -- winning_pitcher_id lookups need the matching
  // full `games` list, or a pitcher's win from an earlier season could
  // silently fail to credit (the game it happened in wouldn't be in this
  // list at all).
  const pitchingLines = computePitchingLines(pitchingAtBats, games ?? []);

  const rosterStats = (players ?? [])
    .map((p) => {
      const b = battingLines.get(p.id);
      const pitch = pitchingLines.get(p.id);
      const cs = caughtStealingByPlayer.get(p.id) ?? 0;
      const sb = b?.sb ?? 0;
      const sbText = sb > 0 || cs > 0 ? `, ${sb} SB${cs > 0 ? `, ${cs} CS` : ""}` : "";
      const battingText = b && b.ab > 0
        ? `${b.ab} AB, ${formatAvg(b.avg)} AVG, ${b.hr} HR, ${b.rbi} RBI, ${formatAvg(b.obp)} OBP, ${formatAvg(b.slg)} SLG, ${b.ops.toFixed(3)} OPS${sbText}`
        : `no at-bats logged yet${sbText}`;
      const pitchingText = pitch && pitch.ip > 0 ? ` | Pitching: ${pitch.ipDisplay} IP, ${pitch.era?.toFixed(2) ?? "—"} ERA, ${pitch.whip?.toFixed(2) ?? "—"} WHIP, ${pitch.k} K` : "";
      return `#${p.jersey_number ?? "—"} ${p.name} (${p.position ?? "—"}): ${battingText}${pitchingText}`;
    })
    .join("\n");

  // Fix 4: every opponent faced this season, with our record against
  // each -- reuses the same recordAgainstOpponent helper the pre-game
  // brief panel already relies on.
  const opponentsFaced = (opponents ?? [])
    .map((o) => {
      const record = recordAgainstOpponent(seasonGames, { opponent_id: o.id, opponent_name: o.name });
      const gamesPlayed = seasonGames.filter((g) => g.opponent_id === o.id).length;
      return gamesPlayed > 0 ? `${o.name} (${formatRecord(record)})` : null;
    })
    .filter((s): s is string => s !== null)
    .join(", ");

  const activeGame = (games ?? []).find((g) => g.status === "active") ?? null;
  // Fix 2 (KAIROS second fixes batch): previously only opponent name and
  // score were injected, which is why KAIROS could see a game was
  // happening but not answer anything about it (date, time, home/away,
  // type, status, season, or its logging mode). All of it was already
  // being fetched above (`games`/`seasons`) -- this was a context-
  // building gap, not a missing query.
  const activeGameSeasonName = activeGame?.season_id ? (seasons ?? []).find((s) => s.id === activeGame.season_id)?.name ?? null : null;

  // Fix 2: KAIROS was told "I don't have access to today's actual
  // calendar date" -- true until now, since nothing ever injected it.
  // Server-side wall-clock time (not the coach's own local time, which
  // this server has no way to know) -- fine for the day-level precision
  // Fix 3's game-creation flow actually needs; flagged so it's not
  // silently assumed to be the coach's exact local clock.
  return `You are KAIROS -- the AI baseball intelligence assistant for EpicPlay AI.
You are named after the Greek god of the perfect moment -- because in baseball,
timing is everything.

Today's date is ${today}. Current server time is ${now.toLocaleTimeString()} (server
clock, not necessarily the coach's own local time -- close enough for day-level
scheduling, but don't state it as their exact local time). Never ask the user
for today's date -- you already know it.

You have access to real data about this team:
- Team name: ${team?.name ?? "Unknown"}
- Current season: ${currentSeason?.name ?? "No season set up yet"}
- Season record: ${wins}-${losses}
- Full roster and season stats (every player, not a top few -- if a player is
  listed here, you have their real data; never say you don't):
${rosterStats || "No players on the roster yet"}
- Opponents faced this season: ${opponentsFaced || "None yet"}
- Current active game: ${
    activeGame
      ? `id ${activeGame.id} -- vs ${activeGame.opponent_name} -- date ${activeGame.game_date}, time ${activeGame.game_time ?? "TBD"}, ` +
        `${activeGame.home_away ?? "unknown"} game, type ${activeGame.game_type}, status ${activeGame.status}, ` +
        `logging mode ${activeGame.logging_mode}, season ${activeGameSeasonName ?? "none assigned"}, ` +
        `score: ${team?.name ?? "Us"} ${activeGame.our_score} -- ${activeGame.opponent_name} ${activeGame.opponent_score}`
      : "No game currently in progress"
  }

You speak in short, confident sentences. You are a baseball expert who also
understands data. You never say "I am Claude" or mention Anthropic. You are
KAIROS.

For general "who's leading/struggling" questions, answer directly from the
full roster stats above -- ranking or sorting that list yourself is fine and
doesn't need a tool call. Exclude any player with 0 AB from a best/worst
ranking (mention them separately, by name, only if specifically asked about
them). The roster line above includes each player's season SB (and CS, if
any) total, so "who leads in steals" is also a direct read of that list, the
same way an OPS-based "who's leading" question is. Call query_team_stats only
for something not already given above: a specific opponent's history, a
lefty/righty split, a player's stolen-base breakdown by game, or anything
else that needs a fresh query. Never guess or invent numbers not present in
your data or a tool result. If a tool result shows no qualifying data for a
specific split (for example, a lefty/righty breakdown with no games tagged
that way yet), say so honestly instead of making something up.

When asked to import a pasted roster or schedule, always confirm with the
user before executing -- show them what you found and ask "Should I add
these?" The propose_* tools handle this; you never write those directly.
create_single_game is different: once you've naturally gathered opponent,
date, time, and home/away through conversation, call it directly -- the
back-and-forth of asking for each detail already is the confirmation, so
there's no separate "should I add this?" step for a single game the way
there is for a bulk import. Map the game type from what the user says
("friendly"/"scrimmage"/"exhibition" -> friendly, "season"/"regular" ->
season, "playoff" -> playoff, "tournament" -> tournament, "championship" ->
championship); if it's genuinely unclear, ask which type rather than
guessing. A single game never needs a season -- create it without one.

If the user asks to switch a game's logging mode (full <-> quick), call
switch_game_mode directly -- it's a small, reversible field change, not a
bulk import, so it doesn't need a propose/confirm step either. Use the
active game's id from your own context above unless the user names a
different game. After it succeeds, tell the user the operator screen
needs a refresh to pick up the change (it doesn't update live).

For ANY question about where a player (or the team) is strong or weak by
pitch location -- "where does X struggle", "what zone should X expect",
"is X better up or down in the zone", "how does X do against fastballs
inside" -- call get_zone_breakdown. Never say you lack pitch-location data
without having called it first: if this team has any Full Mode (pitch-by-
pitch) games logged, real zone data exists and this tool is how you reach
it. Only say pitch-location data isn't available if the tool itself comes
back with zero pitches for that scope (every game logged was Quick Mode,
or the player hasn't played yet) -- that's a real, correct answer, not a
missing capability. Every zone and every weakest/strongest entry the tool
returns carries a sampleConfidence of "low", "medium", or "high" --
state plainly when you're citing a "low" confidence zone (say so in the
same sentence, e.g. "only 2 pitches there, too few to really trust") rather
than presenting a small sample as a settled fact. When you suggest a drill
based on a weak zone, frame it explicitly as a suggestion worth trying --
never claim a drill is proven to fix what the data shows, since the data
shows the symptom, not that any specific drill is the cure. For a
question about a PITCHER (role: "pitcher"), report exactly what the tool
returns for him -- zones where he's gotten hit, pitch types that whiff
batters for him -- and nothing you didn't get from the tool; don't infer
a "weakness" or "strength" for a pitcher from his batting zone data or
vice versa, they're separate roles even for a two-way player.

For ANY pull / opposite-field / spray question -- "who pulls the ball",
"does X go the other way", "spray tendencies" -- call get_spray_tendencies.
It reads batted-ball landing spots (field_x/field_y), a completely
different thing from get_zone_breakdown's pitch-location data (zone_x/
zone_y); never answer a spray question from zone data, and never answer a
zone question from spray data. A switch hitter or a player with no
recorded batting hand comes back with no pull/opposite label (raw field
thirds only) -- report that honestly instead of guessing which side they
pulled toward.

For a "who's best/worst at X" or any multi-player comparison question,
call get_team_zone_summary ONCE -- it already covers every hitter's
fastball rate and zone line in one pass. Do not call get_zone_breakdown
or get_spray_tendencies separately for each player you want to compare;
that answers the same question at far higher cost for no better an
answer. Only reach for the per-player tools afterward, if the coach asks
to drill into one specific player's full breakdown.

Every one of these tools' confidence labels ("low"/"medium"/"high") exists
so you don't have to guess how much to trust a number -- state plainly,
in the same sentence, whenever you're citing a "low" confidence sample
(e.g. "only 3 balls in play there, too early to call a tendency") rather
than presenting it as a settled fact.

Keep responses concise. Use real numbers from the data. Be specific, not
generic. A coach doesn't want "Carlos is a good hitter" -- they want "Carlos
is batting .412 with 3 HR in the last 5 games."`;
}

interface QueryStatsInput {
  player_name?: string;
  opponent_name?: string;
  pitcher_hand_filter?: "left" | "right";
  rank_direction?: "best" | "worst";
}

// KAIROS fixes batch, Fix 5: "at least 5 at-bats" -- applied uniformly to
// best AND worst leaderboard queries (the request only stated 5 for
// "worst" specifically, but using a different bar for the two directions
// would have been an arbitrary inconsistency).
const LEADER_MIN_AB = 5;

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

    // Fix: this player's own stolen bases, same two sources the system
    // prompt's roster line now also reads -- plus a per-game breakdown
    // (game date, opponent, count), which the roster line has no room
    // for but a direct "SB per game for [player]" question needs.
    const { data: playerStolenBases } = gameIds.length
      ? await supabase.from("stolen_bases").select("player_id, game_id, inning").eq("player_id", player.id).in("game_id", gameIds)
      : { data: [] };
    const { data: playerCaughtStealing } = gameIds.length
      ? await supabase.from("game_events").select("game_id").eq("player_id", player.id).in("game_id", gameIds).eq("event_type", "caught_stealing")
      : { data: [] };
    const gameByIdForPlayer = new Map((games ?? []).map((g) => [g.id, g]));
    const sbCountByGame = new Map<string, number>();
    for (const sb of playerStolenBases ?? []) {
      sbCountByGame.set(sb.game_id, (sbCountByGame.get(sb.game_id) ?? 0) + 1);
    }
    const stolenBasesPerGame = Array.from(sbCountByGame.entries())
      .map(([gameId, count]) => {
        const g = gameByIdForPlayer.get(gameId);
        return { gameDate: g?.game_date ?? null, opponent: g?.opponent_name ?? null, count };
      })
      .sort((a, b) => (a.gameDate ?? "").localeCompare(b.gameDate ?? ""));

    const battingLine = computeBattingLines(hittingAtBats, playerStolenBases ?? []).get(player.id);
    const pitchingLine = computePitchingLines(pitchingAtBats, games ?? []).get(player.id);

    return {
      player: player.name,
      jerseyNumber: player.jersey_number,
      splitNote,
      batting: battingLine
        ? { ab: battingLine.ab, h: battingLine.h, avg: formatAvg(battingLine.avg), hr: battingLine.hr, rbi: battingLine.rbi, obp: formatAvg(battingLine.obp), slg: formatAvg(battingLine.slg), ops: battingLine.ops.toFixed(3) }
        : null,
      pitching: pitchingLine && pitchingLine.ip > 0 ? { ip: pitchingLine.ipDisplay, era: pitchingLine.era?.toFixed(2), whip: pitchingLine.whip?.toFixed(2), k: pitchingLine.k } : null,
      stolenBases: {
        total: playerStolenBases?.length ?? 0,
        caughtStealing: playerCaughtStealing?.length ?? 0,
        perGame: stolenBasesPerGame,
      },
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
  const direction = input.rank_direction ?? "best";
  const ranked = Array.from(lines.values())
    .filter((l) => l.ab >= LEADER_MIN_AB)
    .sort((a, b) => (direction === "worst" ? a.ops - b.ops : b.ops - a.ops))
    .slice(0, 5)
    .map((l) => ({ player: playerNameById.get(l.playerId) ?? "Unknown", avg: formatAvg(l.avg), ops: l.ops.toFixed(3), hr: l.hr, rbi: l.rbi, ab: l.ab }));

  // Fix 5: named explicitly rather than silently dropped, so a "who's
  // struggling" question can call out a 0-AB player by name instead of
  // just omitting them with no explanation.
  const rankedIds = new Set((players ?? []).filter((p) => (lines.get(p.id)?.ab ?? 0) >= LEADER_MIN_AB).map((p) => p.id));
  const zeroAbPlayers = (players ?? []).filter((p) => (lines.get(p.id)?.ab ?? 0) === 0 && !rankedIds.has(p.id)).map((p) => p.name);

  return { splitNote, direction, minAbToQualify: LEADER_MIN_AB, leaders: ranked, playersWithNoAtBats: zeroAbPlayers };
}

// Spray-tool batch: a real bug found while testing get_team_zone_summary
// against the demo team's ~800 team-wide hitting at-bats -- a single
// `.in("at_bat_id", atBatIds)` call with that many ids pushes the request
// URL past what PostgREST/the proxy in front of it accepts, and it comes
// back a flat "Bad Request", not an error either call site here used to
// check for. The result read as "zero pitches for everyone," a
// plausible-looking but wrong answer, not a crash -- exactly the kind of
// mistake this app's own "never guess" rule exists to prevent, so this
// had to be fixed at the source rather than caught by a confidence label.
//
// Data-reliability batch: the local chunking helper this comment used to
// describe is now `fetchInChunks` in src/lib/supabase/safe-fetch.ts --
// pulled out to a shared location once the audit found the exact same
// unchunked/unchecked `.in("at_bat_id", ...)` shape at four more call
// sites across the app (heat maps, the player Clubhouse, opponent
// scouting, the next-game pitcher report).
const PITCH_SELECT = "at_bat_id, pitch_number, pitch_type, zone_x, zone_y, outcome, swing";

async function fetchPitchesForAtBats(supabase: SupabaseClient, atBatIds: string[]): Promise<ZoneKairosPitch[]> {
  return fetchInChunks<ZoneKairosPitch>(supabase, "pitches", "at_bat_id", atBatIds, PITCH_SELECT);
}

interface ZoneBreakdownInput {
  player_name?: string;
  role?: "batter" | "pitcher";
}

// Pitch count, not at-bat count: a zone a batter has only ever fouled off
// or taken for a ball still has real swing/miss signal worth citing, even
// with zero decided at-bats there yet (avg stays null in that case -- see
// computeZoneKairosProfile). Deliberately a new, zone-local scale, not a
// reuse of calculateReliability (src/lib/reliability.ts) -- that one
// blends games/total-AB/opponents-faced for a whole team-season; this is
// "how many pitches actually landed in THIS one zone," a different signal
// entirely, so blending them into one formula would have been
// apples-to-oranges, not a simplification.
const ZONE_HIGH_CONFIDENCE_PITCHES = 15;
const ZONE_MEDIUM_CONFIDENCE_PITCHES = 5;

function zoneSampleConfidence(pitches: number): "low" | "medium" | "high" {
  if (pitches >= ZONE_HIGH_CONFIDENCE_PITCHES) return "high";
  if (pitches >= ZONE_MEDIUM_CONFIDENCE_PITCHES) return "medium";
  return "low";
}

// Same badness weighting findWeaknessAndStrengthZones (heat-map.ts) already
// uses for the coach player page's own "weakest zone" callout -- a low
// average weighted more heavily than a high whiff rate, whiff rate folded
// in on top when the zone has enough swings to compute one. Not reused
// directly since that function expects its two inputs pre-matched by zone
// label string from two separately-fetched lists; here both numbers
// already live on the same ZoneKairosLine, so matching by label would be
// pure overhead.
function zoneBadness(z: ZoneKairosLine): number {
  const whiffRate = z.swings > 0 ? z.whiffs / z.swings : 0;
  return (1 - (z.avg ?? 0)) * 0.6 + whiffRate * 0.4;
}

function zoneSummary(z: ZoneKairosLine) {
  return {
    zone: z.zoneLabel,
    avg: formatAvg(z.avg ?? 0),
    ab: z.ab,
    pitches: z.pitches,
    whiffRatePct: z.swings > 0 ? Math.round((z.whiffs / z.swings) * 100) : null,
    sampleConfidence: zoneSampleConfidence(z.pitches),
  };
}

// KAIROS zone-query batch. Joins pitches to at_bats exactly like the
// coach's own Strike Zone Heat Map does (computeZoneKairosProfile reuses
// that same zoneIndexFromCoords/zoneLabel9/computeZoneBattingLines code),
// so this tool's zones and the heat map a coach is looking at can never
// disagree about what a zone means. Team-scoped throughout: every query
// below is already narrowed to this team's own game_ids before any
// player/role filter is applied, the same pattern executeQueryStats uses.
async function executeGetZoneBreakdown(supabase: SupabaseClient, teamId: string, input: ZoneBreakdownInput) {
  const role = input.role ?? "batter";
  const { data: games } = await supabase.from("games").select("id").eq("team_id", teamId);
  const gameIds = (games ?? []).map((g) => g.id);

  let playerId: string | null = null;
  let playerName: string | null = null;
  if (input.player_name) {
    const { data: player } = await supabase.from("players").select("id, name").eq("team_id", teamId).ilike("name", input.player_name).maybeSingle();
    if (!player) return { error: `No player named "${input.player_name}" found on this roster.` };
    playerId = player.id;
    playerName = player.name;
  }

  if (gameIds.length === 0) {
    return {
      scope: playerId ? "player" : "team",
      role,
      player: playerName,
      totalPitches: 0,
      totalAtBats: 0,
      zones: [],
      weakestZones: [],
      strongestZones: [],
      note: "No games logged for this team yet.",
    };
  }

  const mode = role === "pitcher" ? "pitching" : "hitting";
  let atBatsQuery = supabase.from("at_bats").select("id, result").eq("mode", mode).in("game_id", gameIds).not("confirmed_at", "is", null);
  atBatsQuery = playerId
    ? role === "pitcher"
      ? atBatsQuery.eq("pitcher_id", playerId)
      : atBatsQuery.eq("player_id", playerId)
    : atBatsQuery;
  const { data: atBats } = await atBatsQuery;
  const atBatRows = atBats ?? [];
  const atBatIds = atBatRows.map((ab) => ab.id);

  const pitches = await fetchPitchesForAtBats(supabase, atBatIds);

  const zoneLines = computeZoneKairosProfile(atBatRows, pitches);

  const zones = zoneLines.map((z) => ({
    zone: z.zoneLabel,
    pitches: z.pitches,
    swings: z.swings,
    whiffs: z.whiffs,
    whiffRatePct: z.swings > 0 ? Math.round((z.whiffs / z.swings) * 100) : null,
    ab: z.ab,
    hits: z.hits,
    avg: z.avg !== null ? formatAvg(z.avg) : null,
    sampleConfidence: zoneSampleConfidence(z.pitches),
    // Sparse on purpose (cap the output size) -- a pitch type never thrown
    // in this zone simply has no key here, rather than a zeroed-out entry
    // for all 6 known types in all 9 zones.
    byPitchType: Object.fromEntries(
      Object.entries(z.byPitchType).map(([type, split]) => [
        type,
        { pitches: split.pitches, whiffs: split.whiffs, whiffRatePct: split.swings > 0 ? Math.round((split.whiffs / split.swings) * 100) : null },
      ])
    ),
  }));

  // Only zones with a decided at-bat (avg !== null) are gradable for a
  // "weakest/strongest" call -- a zone that's only ever been fouled off or
  // taken has nothing to rank by average yet, same reasoning
  // findWeaknessAndStrengthZones already applies.
  const gradable = zoneLines.filter((z) => z.avg !== null);
  const sortedByBadness = [...gradable].sort((a, b) => zoneBadness(b) - zoneBadness(a));
  const weakestZones = sortedByBadness.slice(0, 3).map(zoneSummary);
  const strongestZones = [...sortedByBadness].reverse().slice(0, 3).map(zoneSummary);

  const totalPitches = pitches.length;
  const totalAtBats = atBatRows.filter((ab) => ab.result !== null).length;

  return {
    scope: playerId ? "player" : "team",
    role,
    player: playerName,
    totalPitches,
    totalAtBats,
    zones,
    weakestZones,
    strongestZones,
    note:
      totalPitches === 0
        ? "Zero pitches with location data for this scope -- only Full Mode (pitch-by-pitch) games capture pitch location. This is a real result, not a missing feature: either every game in scope was logged in Quick Mode, or this player/team hasn't played yet."
        : null,
  };
}

interface SprayTendenciesInput {
  player_name?: string;
}

// Spray-tool batch: same low/medium/high shape as zoneSampleConfidence
// above, but its own thresholds and its own constants -- "enough balls in
// play to trust a pull/oppo split" isn't the same question as "enough
// pitches in one strike-zone cell," so reusing one set of numbers for both
// would have been a coincidence dressed up as a shared rule, not a real
// invariant.
const SPRAY_HIGH_CONFIDENCE_DOTS = 15;
const SPRAY_MEDIUM_CONFIDENCE_DOTS = 5;

function spraySampleConfidence(ballsInPlay: number): "low" | "medium" | "high" {
  if (ballsInPlay >= SPRAY_HIGH_CONFIDENCE_DOTS) return "high";
  if (ballsInPlay >= SPRAY_MEDIUM_CONFIDENCE_DOTS) return "medium";
  return "low";
}

// Spray-tool batch: buckets field_x into left/middle/right thirds of the
// field image -- the exact same raw field_x/field_y values and the exact
// same 0-100-left-to-right axis the spray chart itself plots
// (player-spray-chart.tsx draws `cx={d.x}` directly onto field-2d.png, no
// calibration transform on the dot position itself), so this tool's
// numbers and what a coach sees on the spray chart can never disagree.
// 100/3 thirds chosen independently of heat-map.ts's own THIRDS constant
// (which buckets a completely different axis -- strike-zone pitch
// location, not outfield landing spot); the two just happen to both be
// natural 3-way splits.
const FIELD_THIRD = 100 / 3;

function fieldThird(x: number): "left" | "middle" | "right" {
  if (x < FIELD_THIRD) return "left";
  if (x < 2 * FIELD_THIRD) return "middle";
  return "right";
}

// Same geometry this app's demo-data generator and CLAUDE.md's own spray-
// chart note both document: field_x is 0-100 left-to-right across
// field-2d.png, home plate near (50, 92) -- so a right-handed batter (who
// stands on the left side of the plate as drawn, facing the pitcher) pulls
// the ball to the LEFT side of that image (low field_x), and a lefty pulls
// to the RIGHT (high field_x). Switch hitters and anyone with no recorded
// batting_hand get a raw thirds breakdown with no pull/oppo label at all,
// rather than guessing a side -- same spirit as hbpEligible's own
// unknown-hand fallback on the operator screen.
async function executeGetSprayTendencies(supabase: SupabaseClient, teamId: string, input: SprayTendenciesInput) {
  const { data: games } = await supabase.from("games").select("id").eq("team_id", teamId);
  const gameIds = (games ?? []).map((g) => g.id);

  let playerFilter: { id: string; name: string } | null = null;
  if (input.player_name) {
    const { data: player } = await supabase.from("players").select("id, name").eq("team_id", teamId).ilike("name", input.player_name).maybeSingle();
    if (!player) return { error: `No player named "${input.player_name}" found on this roster.` };
    playerFilter = player;
  }

  if (gameIds.length === 0) {
    return { scope: playerFilter ? "player" : "team", player: playerFilter?.name ?? null, hitters: [], note: "No games logged for this team yet." };
  }

  const { data: players } = await supabase.from("players").select("id, name, batting_hand").eq("team_id", teamId);
  const playerById = new Map((players ?? []).map((p) => [p.id, p]));

  // "Use only games that have dots" -- a saved field_x/field_y, which both
  // Quick and Full Mode capture on any ball in play (it's an at-bat-level
  // field, unrelated to pitch-by-pitch detail), so this deliberately
  // doesn't filter by logging_mode at all.
  let dotsQuery = supabase
    .from("at_bats")
    .select("player_id, field_x, field_y")
    .eq("mode", "hitting")
    .in("game_id", gameIds)
    .not("confirmed_at", "is", null)
    .not("field_x", "is", null)
    .not("field_y", "is", null);
  if (playerFilter) dotsQuery = dotsQuery.eq("player_id", playerFilter.id);
  const { data: dots } = await dotsQuery;

  const countsByPlayer = new Map<string, { left: number; middle: number; right: number }>();
  for (const d of dots ?? []) {
    if (!d.player_id || d.field_x === null) continue;
    const bucket = countsByPlayer.get(d.player_id) ?? { left: 0, middle: 0, right: 0 };
    bucket[fieldThird(d.field_x)] += 1;
    countsByPlayer.set(d.player_id, bucket);
  }

  const hitters = Array.from(countsByPlayer.entries())
    .map(([playerId, counts]) => {
      const player = playerById.get(playerId);
      const total = counts.left + counts.middle + counts.right;
      const pct = (n: number) => Math.round((n / total) * 100);
      const hand = player?.batting_hand ?? null;
      let pulledPct: number | null = null;
      let middlePct: number | null = null;
      let oppoPct: number | null = null;
      let note: string | undefined;
      if (hand === "R") {
        pulledPct = pct(counts.left);
        middlePct = pct(counts.middle);
        oppoPct = pct(counts.right);
      } else if (hand === "L") {
        pulledPct = pct(counts.right);
        middlePct = pct(counts.middle);
        oppoPct = pct(counts.left);
      } else {
        note =
          hand === "S"
            ? "Switch hitter -- which side they bat from varies by at-bat, so pull/opposite-field can't be labeled from one fixed handedness. Raw field thirds shown instead."
            : "Batting hand not recorded for this player -- pull/opposite-field can't be labeled. Raw field thirds shown instead.";
      }
      return {
        player: player?.name ?? "Unknown",
        battingHand: hand,
        ballsInPlay: total,
        leftThirdPct: pct(counts.left),
        middleThirdPct: pct(counts.middle),
        rightThirdPct: pct(counts.right),
        pulledPct,
        middlePct,
        oppoPct,
        sampleConfidence: spraySampleConfidence(total),
        note,
      };
    })
    .sort((a, b) => b.ballsInPlay - a.ballsInPlay)
    .slice(0, 20);

  return {
    scope: playerFilter ? "player" : "team",
    player: playerFilter?.name ?? null,
    hitters,
    note:
      hitters.length === 0
        ? playerFilter
          ? `${playerFilter.name} has no balls in play with a saved landing spot yet.`
          : "No balls in play with a saved landing spot yet for this scope."
        : null,
  };
}

// Team-comparison batch: ONE pass over the team's at-bats/pitches (not one
// query per hitter) builds every hitter's fastball-vs-zone line at once --
// this is the tool the system prompt now points "who's best/worst at X"
// questions at specifically so the model stops calling get_zone_breakdown
// once per player to answer a team-comparison question (confirmed live:
// that pattern alone cost ~22,000 tokens for a 3-hitter comparison before
// this tool existed). Reuses computeZoneKairosProfile and the same
// zoneBadness ranking get_zone_breakdown already uses, so a hitter's
// weakest/strongest zone here always matches what get_zone_breakdown would
// say about them individually.
const TEAM_ZONE_SUMMARY_MAX_ROWS = 20;

async function executeGetTeamZoneSummary(supabase: SupabaseClient, teamId: string) {
  const { data: games } = await supabase.from("games").select("id").eq("team_id", teamId);
  const gameIds = (games ?? []).map((g) => g.id);
  if (gameIds.length === 0) return { hitters: [], note: "No games logged for this team yet." };

  const { data: players } = await supabase.from("players").select("id, name").eq("team_id", teamId);
  const playerNameById = new Map((players ?? []).map((p) => [p.id, p.name]));

  const { data: atBats } = await supabase.from("at_bats").select("id, player_id, result").eq("mode", "hitting").in("game_id", gameIds).not("confirmed_at", "is", null);
  const atBatRows = atBats ?? [];
  const atBatIds = atBatRows.map((ab) => ab.id);
  const pitches = await fetchPitchesForAtBats(supabase, atBatIds);

  const atBatIdToPlayer = new Map(atBatRows.filter((ab) => ab.player_id).map((ab) => [ab.id, ab.player_id as string]));
  const atBatsByPlayer = new Map<string, typeof atBatRows>();
  for (const ab of atBatRows) {
    if (!ab.player_id) continue;
    const arr = atBatsByPlayer.get(ab.player_id) ?? [];
    arr.push(ab);
    atBatsByPlayer.set(ab.player_id, arr);
  }
  const pitchesByPlayer = new Map<string, typeof pitches>();
  for (const p of pitches) {
    const playerId = atBatIdToPlayer.get(p.at_bat_id);
    if (!playerId) continue;
    const arr = pitchesByPlayer.get(playerId) ?? [];
    arr.push(p);
    pitchesByPlayer.set(playerId, arr);
  }

  const hitters = Array.from(atBatsByPlayer.entries())
    .map(([playerId, abs]) => {
      const playerPitches = pitchesByPlayer.get(playerId) ?? [];
      const zoneLines = computeZoneKairosProfile(abs, playerPitches);

      const fastballPitches = playerPitches.filter((p) => p.pitch_type === "fastball");
      const fastballSwings = fastballPitches.filter((p) => p.swing === true);
      const fastballWhiffs = fastballSwings.filter((p) => p.outcome === "strike" || p.outcome === "foul_tip");

      const gradable = zoneLines.filter((z) => z.avg !== null);
      const sorted = [...gradable].sort((a, b) => zoneBadness(b) - zoneBadness(a));
      const weakest = sorted[0] ?? null;
      const strongest = sorted[sorted.length - 1] ?? null;

      return {
        player: playerNameById.get(playerId) ?? "Unknown",
        ab: abs.filter((ab) => ab.result !== null).length,
        fastballSeen: fastballPitches.length,
        fastballWhiffRatePct: fastballSwings.length > 0 ? Math.round((fastballWhiffs.length / fastballSwings.length) * 100) : null,
        weakestZone: weakest ? { zone: weakest.zoneLabel, avg: formatAvg(weakest.avg ?? 0), ab: weakest.ab } : null,
        strongestZone: strongest ? { zone: strongest.zoneLabel, avg: formatAvg(strongest.avg ?? 0), ab: strongest.ab } : null,
      };
    })
    .sort((a, b) => b.ab - a.ab)
    .slice(0, TEAM_ZONE_SUMMARY_MAX_ROWS);

  return { hitters, note: hitters.length === 0 ? "No confirmed hitting at-bats logged yet." : null };
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

interface CreateSingleGameInput {
  opponent_name: string;
  date: string;
  time: string;
  home_away: "home" | "away";
  game_type: "friendly" | "season" | "playoff" | "tournament" | "championship";
}

// KAIROS fixes batch, Fix 3. Writes directly (no propose/confirm step --
// see the system prompt's note on why a single ad-hoc game doesn't need
// one) and always with season_id: null -- this tool's whole purpose is a
// game outside the normal season-import flow, so it's never conditionally
// attached to whatever season happens to be active.
async function executeCreateSingleGame(supabase: SupabaseClient, teamId: string, input: CreateSingleGameInput) {
  const name = input.opponent_name.trim();
  const { data: existing } = await supabase.from("opponents").select("id").eq("team_id", teamId).eq("name", name).maybeSingle();
  let opponentId = existing?.id ?? null;
  if (!opponentId) {
    const { data: created, error } = await supabase.from("opponents").insert({ team_id: teamId, name }).select("id").single();
    if (error || !created) return { error: `Failed to create opponent "${name}": ${error?.message ?? "unknown error"}` };
    opponentId = created.id;
  }

  const { data: game, error: gameError } = await supabase
    .from("games")
    .insert({
      team_id: teamId,
      season_id: null,
      opponent_id: opponentId,
      opponent_name: name,
      game_date: input.date,
      game_time: input.time,
      game_type: input.game_type as GameType,
      home_away: input.home_away,
      status: "setup" as const,
    })
    .select("id")
    .single();
  if (gameError || !game) return { error: `Failed to create game: ${gameError?.message ?? "unknown error"}` };

  return {
    created: true,
    gameId: game.id,
    opponentName: name,
    date: input.date,
    time: input.time,
    homeAway: input.home_away,
    gameType: input.game_type,
  };
}

interface SwitchGameModeInput {
  game_id: string;
  new_mode: "full" | "quick";
}

// KAIROS fixes batch, Fix 2 (second batch). Team-scoped (.eq("team_id",
// teamId) on the update, not just trusting the game_id Claude was given)
// so a stale/hallucinated id from a different team can't silently write
// through -- same scoping every other write in this file already applies.
async function executeSwitchGameMode(supabase: SupabaseClient, teamId: string, input: SwitchGameModeInput) {
  const { data: game, error } = await supabase
    .from("games")
    .update({ logging_mode: input.new_mode as LoggingMode })
    .eq("id", input.game_id)
    .eq("team_id", teamId)
    .select("id, opponent_name")
    .maybeSingle();
  if (error) return { error: `Failed to switch logging mode: ${error.message}` };
  if (!game) return { error: "No game with that id found for this team." };
  return { switched: true, gameId: game.id, opponentName: game.opponent_name, newMode: input.new_mode };
}

export async function askKairos(history: KairosMessage[], message: string, testOverride?: KairosTestOverride): Promise<KairosResponse> {
  const { supabase, teamId } = testOverride ?? (await requireCoachTeam());
  const system = await buildSystemPrompt(supabase, teamId);
  // Data-reliability batch: cache_control on the system prompt -- a
  // second breakpoint, after the one on KAIROS_TOOLS (see that file's own
  // comment). This team's roster stats change over the season, so this
  // cache entry rotates with them, but it's byte-identical between the
  // `first` and `second` calls below (the exact same `system` variable,
  // reused) -- that alone makes the second call's own system+tools
  // content, which otherwise has to be resent and re-billed in full just
  // to continue this one exchange, nearly free, regardless of whether
  // anything was cached from a previous, separate question.
  const cachedSystem: Anthropic.TextBlockParam[] = [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];

  const messages: Anthropic.MessageParam[] = [...history.map((h) => ({ role: h.role, content: h.content }) as Anthropic.MessageParam), { role: "user", content: message }];

  // KAIROS zone-query batch: 1024 -> 4096. Found by testing, not guessed --
  // claude-sonnet-5 uses extended thinking by default even without it being
  // requested here, and for some questions (confirmed live: "who's our most
  // reliable bat against fastballs?") the thinking alone ran past 1024
  // output tokens, leaving no room to finish deciding on a tool call or
  // write any visible text -- stop_reason came back "max_tokens" with no
  // text block at all, which askKairos then has no choice but to report as
  // "I couldn't come up with a response." 4096 leaves real headroom for
  // thinking plus a full tool_use block or a real answer; a short answer
  // still only costs what it actually uses; this is a ceiling, not a
  // target.
  const first = await client.messages.create({ model: MODEL, max_tokens: 4096, system: cachedSystem, tools: KAIROS_TOOLS, messages });
  const firstUsage = {
    input: first.usage.input_tokens,
    output: first.usage.output_tokens,
    cacheCreation: first.usage.cache_creation_input_tokens ?? 0,
    cacheRead: first.usage.cache_read_input_tokens ?? 0,
  };

  const toolUses = first.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (first.stop_reason !== "tool_use" || toolUses.length === 0) {
    return {
      text: extractText(first) || "I couldn't come up with a response to that -- try rephrasing?",
      usage: { inputTokens: firstUsage.input, outputTokens: firstUsage.output, totalTokens: firstUsage.input + firstUsage.output, cacheCreationInputTokens: firstUsage.cacheCreation, cacheReadInputTokens: firstUsage.cacheRead },
    };
  }

  // KAIROS zone-query batch: the model can and does call more than one tool
  // in the same turn now that get_zone_breakdown exists -- e.g. "who's most
  // reliable against fastballs" naturally invites checking several players'
  // zone data side by side, instead of the one-lookup-per-question shape
  // every earlier tool fit. The Anthropic API requires a tool_result for
  // EVERY tool_use block issued in a turn (a request with only some of them
  // answered is rejected outright, confirmed live -- a real 400 from
  // exactly this gap before this loop existed), so every entry in toolUses
  // gets executed and answered, not just the first. propose_roster_import/
  // propose_schedule_import are the one exception: they hand the proposed
  // data straight back to the client for a human confirm step rather than
  // round-tripping through a second model call, so if either is present it
  // takes over the whole turn -- those two tools are also the only ones
  // this system prompt ever asks the model to call alone, never alongside
  // another tool, so this doesn't strand any other tool_use id unanswered
  // in practice.
  const firstToolUse = toolUses[0];

  if (firstToolUse.name === "propose_roster_import") {
    const parsed = firstToolUse.input as { players: { name: string; jersey_number?: string; position?: string }[] };
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
    return {
      text,
      pendingRosterImport: rosterPlayers,
      usage: { inputTokens: firstUsage.input, outputTokens: firstUsage.output, totalTokens: firstUsage.input + firstUsage.output, cacheCreationInputTokens: firstUsage.cacheCreation, cacheReadInputTokens: firstUsage.cacheRead },
    };
  }

  if (firstToolUse.name === "propose_schedule_import") {
    const parsed = firstToolUse.input as { season_name: string; season_year: number; games: PendingScheduleGame[] };
    const text = `I found ${parsed.games.length} game${parsed.games.length === 1 ? "" : "s"} in your schedule. Review them below -- should I add these to ${parsed.season_name}?`;
    return {
      text,
      pendingScheduleImport: { seasonName: parsed.season_name, seasonYear: parsed.season_year, games: parsed.games },
      usage: { inputTokens: firstUsage.input, outputTokens: firstUsage.output, totalTokens: firstUsage.input + firstUsage.output, cacheCreationInputTokens: firstUsage.cacheCreation, cacheReadInputTokens: firstUsage.cacheRead },
    };
  }

  async function executeOneTool(toolUse: Anthropic.ToolUseBlock): Promise<unknown> {
    if (toolUse.name === "query_team_stats") {
      return executeQueryStats(supabase, teamId, toolUse.input as QueryStatsInput);
    } else if (toolUse.name === "get_zone_breakdown") {
      return executeGetZoneBreakdown(supabase, teamId, toolUse.input as ZoneBreakdownInput);
    } else if (toolUse.name === "get_spray_tendencies") {
      return executeGetSprayTendencies(supabase, teamId, toolUse.input as SprayTendenciesInput);
    } else if (toolUse.name === "get_team_zone_summary") {
      return executeGetTeamZoneSummary(supabase, teamId);
    } else if (toolUse.name === "suggest_lineup") {
      return executeSuggestLineup(supabase, teamId, toolUse.input as { pitcher_hand_filter?: "left" | "right" });
    } else if (toolUse.name === "create_single_game") {
      return executeCreateSingleGame(supabase, teamId, toolUse.input as CreateSingleGameInput);
    } else if (toolUse.name === "switch_game_mode") {
      return executeSwitchGameMode(supabase, teamId, toolUse.input as SwitchGameModeInput);
    }
    return { error: "Unknown tool" };
  }

  const toolResultBlocks: Anthropic.ToolResultBlockParam[] = await Promise.all(
    toolUses.map(async (toolUse) => ({
      type: "tool_result" as const,
      tool_use_id: toolUse.id,
      content: JSON.stringify(await executeOneTool(toolUse)),
    }))
  );

  const second = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: cachedSystem,
    tools: KAIROS_TOOLS,
    messages: [
      ...messages,
      { role: "assistant", content: first.content },
      { role: "user", content: toolResultBlocks },
    ],
  });

  const totalInput = firstUsage.input + second.usage.input_tokens;
  const totalOutput = firstUsage.output + second.usage.output_tokens;
  const totalCacheCreation = firstUsage.cacheCreation + (second.usage.cache_creation_input_tokens ?? 0);
  const totalCacheRead = firstUsage.cacheRead + (second.usage.cache_read_input_tokens ?? 0);
  return {
    text: extractText(second) || "I looked that up but couldn't put together a response -- try asking again?",
    usage: {
      inputTokens: totalInput,
      outputTokens: totalOutput,
      totalTokens: totalInput + totalOutput,
      cacheCreationInputTokens: totalCacheCreation,
      cacheReadInputTokens: totalCacheRead,
    },
  };
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
