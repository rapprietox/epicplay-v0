"use client";

import { useMemo, useState } from "react";
import type { Database } from "@/lib/supabase/types";
import { computeBattingLines, computePitchingLines } from "@/lib/stats";
import {
  DAY_TYPE_LABELS,
  TIME_OF_DAY_LABELS,
  dayTypeBucket,
  resolveStartMinutes,
  timeOfDayBucket,
  type DayType,
  type TimeOfDay,
} from "@/lib/game-time-filters";
import { computeEpsForRoster } from "@/lib/eps";
import { buildLeaderRows } from "@/lib/leader-stats";
import { countTeamGames } from "@/lib/leader-qualification";
import { TeamLeadersBoard } from "@/components/team-leaders-board";

type AtBat = Database["public"]["Tables"]["at_bats"]["Row"];
type StolenBase = Database["public"]["Tables"]["stolen_bases"]["Row"];
type Game = Database["public"]["Tables"]["games"]["Row"];
type Player = Database["public"]["Tables"]["players"]["Row"];
type GameEvent = Pick<Database["public"]["Tables"]["game_events"]["Row"], "event_type" | "player_id" | "game_id">;

type Filter = "all" | "season" | "playoff";

interface Props {
  players: Player[];
  atBats: AtBat[];
  stolenBases: StolenBase[];
  games: Game[];
  // EPS batch: caught-stealing only lives in game_events, not stolen_bases.
  gameEvents: GameEvent[];
}

// Same-cards + leader-qualification batches: the stat list, ranking,
// and qualification logic all moved to src/lib/leader-stats.ts +
// src/lib/leader-qualification.ts, and the card grid/ranking modal to
// src/components/team-leaders-board.tsx -- shared with the player
// Clubhouse's own Team Leaders board so the two can't drift apart.
// This file keeps only what's genuinely coach-specific: the three
// filter dropdowns and the "no completed games yet" empty state.
export function LeadersBoard({ players, atBats, stolenBases, games, gameEvents }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  // Time-of-day/day-of-week filters batch: "all" (no restriction) for
  // both, same shape as the existing game-type filter above -- three
  // independent filters that all narrow the same underlying game set
  // together, not three separate views.
  const [timeOfDayFilter, setTimeOfDayFilter] = useState<TimeOfDay | "all">("all");
  const [dayTypeFilter, setDayTypeFilter] = useState<DayType | "all">("all");

  const matchingGameIds = useMemo(() => {
    const ids = new Set<string>();
    for (const g of games) {
      if (filter !== "all" && g.game_type !== filter) continue;
      if (timeOfDayFilter !== "all" && timeOfDayBucket(resolveStartMinutes(g)) !== timeOfDayFilter) continue;
      if (dayTypeFilter !== "all" && dayTypeBucket(g.game_date) !== dayTypeFilter) continue;
      ids.add(g.id);
    }
    return ids;
  }, [games, filter, timeOfDayFilter, dayTypeFilter]);

  const noFilterActive = filter === "all" && timeOfDayFilter === "all" && dayTypeFilter === "all";

  const filteredAtBats = useMemo(() => {
    if (noFilterActive) return atBats;
    return atBats.filter((ab) => matchingGameIds.has(ab.game_id));
  }, [atBats, matchingGameIds, noFilterActive]);

  const filteredStolenBases = useMemo(() => {
    if (noFilterActive) return stolenBases;
    return stolenBases.filter((sb) => matchingGameIds.has(sb.game_id));
  }, [stolenBases, matchingGameIds, noFilterActive]);

  const filteredGames = useMemo(() => {
    if (noFilterActive) return games;
    return games.filter((g) => matchingGameIds.has(g.id));
  }, [games, matchingGameIds, noFilterActive]);

  const filteredGameEvents = useMemo(() => {
    if (noFilterActive) return gameEvents;
    return gameEvents.filter((e) => matchingGameIds.has(e.game_id));
  }, [gameEvents, matchingGameIds, noFilterActive]);

  const rows = useMemo(() => {
    const battingLines = computeBattingLines(filteredAtBats, filteredStolenBases);
    const pitchingLines = computePitchingLines(filteredAtBats, filteredGames);
    const epsLines = computeEpsForRoster(players.map((p) => p.id), filteredAtBats, filteredGameEvents);
    const teamGames = countTeamGames(filteredGames);
    return buildLeaderRows(players, battingLines, pitchingLines, epsLines, teamGames);
  }, [players, filteredAtBats, filteredStolenBases, filteredGames, filteredGameEvents]);

  // Launch-audit Fix 8: a brand-new team's first look at this card was
  // 15 "No data yet" tiles at once -- not broken, just a noisier first
  // impression than one plain line. The filters above the grid are
  // meaningless with zero completed games too, so they're hidden along
  // with the grid, not just the tiles.
  const hasCompletedGame = games.some((g) => g.status === "completed");
  if (!hasCompletedGame) {
    return (
      <section className="glossy rounded-lg border border-accent-gold/30 bg-surface p-5 shadow-[0_0_0_1px_rgba(240,192,96,0.05)]">
        <h2 className="font-heading text-2xl font-bold uppercase tracking-wide text-accent-gold">Team Leaders</h2>
        <p className="mt-3 text-sm text-foreground/50">No stats yet — complete your first game to see team leaders appear here.</p>
      </section>
    );
  }

  return (
    <section className="glossy rounded-lg border border-accent-gold/30 bg-surface p-5 shadow-[0_0_0_1px_rgba(240,192,96,0.05)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-2xl font-bold uppercase tracking-wide text-accent-gold">
          Team Leaders
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-md border border-border p-1 text-xs">
            {(["all", "season", "playoff"] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded px-3 py-1 capitalize transition ${
                  filter === f ? "bg-accent-primary text-white" : "text-foreground/50 hover:text-white"
                }`}
              >
                {f === "all" ? "All games" : `${f} only`}
              </button>
            ))}
          </div>
          {/* Time-of-day/day-of-week filters batch: two more independent
              narrowing filters, same "all" default as the game-type one
              above. */}
          <select
            value={timeOfDayFilter}
            onChange={(e) => setTimeOfDayFilter(e.target.value as TimeOfDay | "all")}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-white outline-none focus:border-accent-primary"
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
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-white outline-none focus:border-accent-primary"
          >
            <option value="all">Any day</option>
            {(Object.keys(DAY_TYPE_LABELS) as DayType[]).map((d) => (
              <option key={d} value={d}>
                {DAY_TYPE_LABELS[d]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4">
        <TeamLeadersBoard rows={rows} getPlayerHref={(id) => `/coach/players/${id}`} />
      </div>
    </section>
  );
}
