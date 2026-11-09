"use client";

import { useMemo, useState } from "react";
import type { Database } from "@/lib/supabase/types";
import { computeBattingLines } from "@/lib/stats";
import {
  DAY_TYPE_LABELS,
  TIME_OF_DAY_LABELS,
  matchingGameIds,
  type DayType,
  type GameFacetFilter,
  type TimeOfDay,
} from "@/lib/game-time-filters";
import { isRateQualified, countTeamGames, MIN_PA_PER_TEAM_GAME } from "@/lib/leader-qualification";
import { TeamHittingTable, type HittingTableRow } from "@/components/team-hitting-table";
import { formatGameDate } from "@/lib/dates";

type AtBat = Database["public"]["Tables"]["at_bats"]["Row"];
type StolenBase = Database["public"]["Tables"]["stolen_bases"]["Row"];
type Game = Database["public"]["Tables"]["games"]["Row"];
type Player = Database["public"]["Tables"]["players"]["Row"];
type GameEvent = Pick<
  Database["public"]["Tables"]["game_events"]["Row"],
  "event_type" | "player_id" | "game_id" | "scorer_player_id" | "runs_scored"
>;

type GameTypeFilter = "all" | "season" | "playoff";

const TEAM_TOTAL_ID = "__team_total__";

interface Props {
  players: Player[];
  atBats: AtBat[];
  stolenBases: StolenBase[];
  games: Game[];
  gameEvents: GameEvent[];
}

// Full hitting table batch: the "Team Hitting" table between the Team
// Leaders cards and the Season Schedule. Same filters as the Leaders
// board (game-type/time/day), plus a 4th "All games" vs. single-game
// selector this board doesn't have. All the actual math is
// computeBattingLines -- this file only derives the two things it
// can't produce (G, games played per player; CS, caught-stealing per
// player, both from raw rows) and the qualification flag per row,
// exactly the same rule src/lib/leader-qualification.ts already uses
// for the rate-stat cards.
export function TeamHittingTableSection({ players, atBats, stolenBases, games, gameEvents }: Props) {
  const [filter, setFilter] = useState<GameTypeFilter>("all");
  const [timeOfDayFilter, setTimeOfDayFilter] = useState<TimeOfDay | "all">("all");
  const [dayTypeFilter, setDayTypeFilter] = useState<DayType | "all">("all");
  const [singleGameId, setSingleGameId] = useState<string>("all");

  const completedGames = useMemo(
    () => [...games].filter((g) => g.status === "completed").sort((a, b) => b.game_date.localeCompare(a.game_date)),
    [games]
  );

  const facetFiltersDisabled = singleGameId !== "all";

  const matchedIds = useMemo(() => {
    if (singleGameId !== "all") return new Set([singleGameId]);
    const facet: GameFacetFilter = { gameType: filter, timeOfDay: timeOfDayFilter, dayType: dayTypeFilter };
    return matchingGameIds(games, facet);
  }, [games, filter, timeOfDayFilter, dayTypeFilter, singleGameId]);

  const noFilterActive = singleGameId === "all" && filter === "all" && timeOfDayFilter === "all" && dayTypeFilter === "all";

  const filteredAtBats = useMemo(() => (noFilterActive ? atBats : atBats.filter((ab) => matchedIds.has(ab.game_id))), [atBats, matchedIds, noFilterActive]);
  const filteredStolenBases = useMemo(
    () => (noFilterActive ? stolenBases : stolenBases.filter((sb) => matchedIds.has(sb.game_id))),
    [stolenBases, matchedIds, noFilterActive]
  );
  const filteredGames = useMemo(() => (noFilterActive ? games : games.filter((g) => matchedIds.has(g.id))), [games, matchedIds, noFilterActive]);
  const filteredGameEvents = useMemo(
    () => (noFilterActive ? gameEvents : gameEvents.filter((e) => matchedIds.has(e.game_id))),
    [gameEvents, matchedIds, noFilterActive]
  );

  const { rows, totals, teamGames } = useMemo(() => {
    const hitting = filteredAtBats.filter((ab) => ab.mode === "hitting");
    const battingLines = computeBattingLines(hitting, filteredStolenBases, filteredGameEvents);
    const teamGames = countTeamGames(filteredGames);

    const gamesPlayedByPlayer = new Map<string, Set<string>>();
    for (const ab of hitting) {
      if (!ab.player_id) continue;
      let set = gamesPlayedByPlayer.get(ab.player_id);
      if (!set) {
        set = new Set();
        gamesPlayedByPlayer.set(ab.player_id, set);
      }
      set.add(ab.game_id);
    }

    const csByPlayer = new Map<string, number>();
    for (const e of filteredGameEvents) {
      if (e.event_type !== "caught_stealing" || !e.player_id) continue;
      csByPlayer.set(e.player_id, (csByPlayer.get(e.player_id) ?? 0) + 1);
    }

    const rows: HittingTableRow[] = players.map((p) => {
      const line = battingLines.get(p.id);
      const pa = line?.pa ?? 0;
      return {
        playerId: p.id,
        playerName: p.name,
        playerJersey: p.jersey_number,
        g: gamesPlayedByPlayer.get(p.id)?.size ?? 0,
        pa,
        ab: line?.ab ?? 0,
        r: line?.runsScored ?? 0,
        h: line?.h ?? 0,
        doubles: line?.doubles ?? 0,
        triples: line?.triples ?? 0,
        hr: line?.hr ?? 0,
        rbi: line?.rbi ?? 0,
        bb: line?.bb ?? 0,
        k: line?.k ?? 0,
        sb: line?.sb ?? 0,
        cs: csByPlayer.get(p.id) ?? 0,
        avg: line?.avg ?? 0,
        obp: line?.obp ?? 0,
        slg: line?.slg ?? 0,
        ops: line?.ops ?? 0,
        qualified: isRateQualified("pa", pa, teamGames),
      };
    });

    // Team totals row: reuses computeBattingLines itself (remapping
    // every row's player_id/scorer_player_id to one sentinel id) rather
    // than re-deriving AVG/OBP/SLG/OPS by hand a second time -- the
    // request's own "don't add a second calculation" applies just as
    // much to the totals row as to the per-player ones.
    const teamHitting = hitting.map((ab) => ({ ...ab, player_id: TEAM_TOTAL_ID }));
    const teamStolenBases = filteredStolenBases.map((sb) => ({ ...sb, player_id: TEAM_TOTAL_ID }));
    const teamScoringEvents = filteredGameEvents.map((e) => ({ ...e, scorer_player_id: e.scorer_player_id ? TEAM_TOTAL_ID : e.scorer_player_id }));
    const teamLine = computeBattingLines(teamHitting, teamStolenBases, teamScoringEvents).get(TEAM_TOTAL_ID);
    let totalCs = 0;
    for (const v of Array.from(csByPlayer.values())) totalCs += v;

    const totals: HittingTableRow = {
      playerId: TEAM_TOTAL_ID,
      playerName: "Team Total",
      playerJersey: null,
      g: teamGames,
      pa: teamLine?.pa ?? 0,
      ab: teamLine?.ab ?? 0,
      r: teamLine?.runsScored ?? 0,
      h: teamLine?.h ?? 0,
      doubles: teamLine?.doubles ?? 0,
      triples: teamLine?.triples ?? 0,
      hr: teamLine?.hr ?? 0,
      rbi: teamLine?.rbi ?? 0,
      bb: teamLine?.bb ?? 0,
      k: teamLine?.k ?? 0,
      sb: teamLine?.sb ?? 0,
      cs: totalCs,
      avg: teamLine?.avg ?? 0,
      obp: teamLine?.obp ?? 0,
      slg: teamLine?.slg ?? 0,
      ops: teamLine?.ops ?? 0,
      qualified: true,
    };

    return { rows, totals, teamGames };
  }, [players, filteredAtBats, filteredStolenBases, filteredGames, filteredGameEvents]);

  const hasCompletedGame = games.some((g) => g.status === "completed");
  if (!hasCompletedGame) return null;

  return (
    <section className="glossy rounded-lg border border-accent-gold/30 bg-surface p-5 shadow-[0_0_0_1px_rgba(240,192,96,0.05)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-2xl font-bold uppercase tracking-wide text-accent-gold">Team Hitting</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-md border border-border p-1 text-xs">
            {(["all", "season", "playoff"] as GameTypeFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                disabled={facetFiltersDisabled}
                className={`rounded px-3 py-1 capitalize transition motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-40 ${
                  filter === f ? "bg-accent-primary text-white" : "text-foreground/50 hover:text-white"
                }`}
              >
                {f === "all" ? "All games" : `${f} only`}
              </button>
            ))}
          </div>
          <select
            value={timeOfDayFilter}
            onChange={(e) => setTimeOfDayFilter(e.target.value as TimeOfDay | "all")}
            disabled={facetFiltersDisabled}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-white outline-none focus:border-accent-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            <option value="all">Any time of day</option>
            {(Object.keys(TIME_OF_DAY_LABELS) as TimeOfDay[]).map((t) => (
              <option key={t} value={t}>
                {TIME_OF_DAY_LABELS[t]}
              </option>
            ))}
          </select>
          <select
            value={dayTypeFilter}
            onChange={(e) => setDayTypeFilter(e.target.value as DayType | "all")}
            disabled={facetFiltersDisabled}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-white outline-none focus:border-accent-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            <option value="all">Any day</option>
            {(Object.keys(DAY_TYPE_LABELS) as DayType[]).map((d) => (
              <option key={d} value={d}>
                {DAY_TYPE_LABELS[d]}
              </option>
            ))}
          </select>
          <select
            value={singleGameId}
            onChange={(e) => setSingleGameId(e.target.value)}
            className="rounded-md border border-accent-gold/40 bg-background px-2 py-1.5 text-xs text-accent-gold outline-none focus:border-accent-gold"
          >
            <option value="all">All games</option>
            {completedGames.map((g) => (
              <option key={g.id} value={g.id}>
                {g.home_away === "home" ? "vs" : "@"} {g.opponent_name} — {formatGameDate(g.game_date)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4">
        <TeamHittingTable
          rows={rows}
          totals={totals}
          getPlayerHref={(id) => `/coach/players/${id}`}
          minPaPerTeamGame={MIN_PA_PER_TEAM_GAME}
          teamGames={teamGames}
        />
      </div>
    </section>
  );
}
