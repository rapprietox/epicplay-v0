"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  computeLineupMatrix,
  detectLineupHoles,
  rateAvg,
  rateObp,
  rateSlg,
  rateKPct,
  rateBbPct,
  rateRisp,
  RATING_BG,
  type Rating,
} from "@/lib/lineup-analysis";
import { formatAvg } from "@/lib/stats";
import {
  DAY_TYPE_LABELS,
  TIME_OF_DAY_LABELS,
  matchingGameIds,
  type DayType,
  type GameFacetFilter,
  type TimeOfDay,
} from "@/lib/game-time-filters";
import { getLineupInsights } from "./lineup-insights-actions";
import type { Database } from "@/lib/supabase/types";

type Lineup = Database["public"]["Tables"]["lineup"]["Row"];
type Player = Database["public"]["Tables"]["players"]["Row"];
type AtBat = Database["public"]["Tables"]["at_bats"]["Row"];
type Game = Database["public"]["Tables"]["games"]["Row"];

// Feature 1/2 batch: "Lineup Analysis" -- a grid of each current batting
// slot's performance plus an AI-generated coaching panel underneath.
// Coach-only by construction: /coach is already unreachable for any role
// other than coach (middleware redirects operator -> /operator, player
// -> /player before this component ever renders), so there's nothing
// extra to gate here. The request's access-control note also named
// "operator" -- that's moot under this app's actual routing (an operator
// never reaches /coach at all), flagged rather than silently building a
// redundant role check or changing middleware to let operators in.
export function LineupAnalysisSection({
  lineupRows,
  players,
  atBats,
  games,
  teamName,
}: {
  lineupRows: Lineup[];
  players: Player[];
  atBats: AtBat[];
  games: Game[];
  teamName: string;
}) {
  const [gameType, setGameType] = useState<GameFacetFilter["gameType"]>("all");
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay | "all">("all");
  const [dayType, setDayType] = useState<DayType | "all">("all");

  const filteredAtBats = useMemo(() => {
    if (gameType === "all" && timeOfDay === "all" && dayType === "all") return atBats;
    const ids = matchingGameIds(games, { gameType, timeOfDay, dayType });
    return atBats.filter((ab) => ids.has(ab.game_id));
  }, [atBats, games, gameType, timeOfDay, dayType]);

  const matrix = useMemo(() => computeLineupMatrix(lineupRows, players, filteredAtBats), [lineupRows, players, filteredAtBats]);
  const holes = useMemo(() => detectLineupHoles(matrix), [matrix]);

  if (lineupRows.length === 0) {
    return (
      <section className="glossy rounded-lg border border-border bg-surface p-5">
        <h2 className="font-heading text-xl font-bold uppercase tracking-wide text-white">Lineup Analysis</h2>
        <p className="mt-3 text-sm text-foreground/50">No lineup on record yet -- set one up for a game to see this fill in.</p>
      </section>
    );
  }

  return (
    <section className="glossy rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-xl font-bold uppercase tracking-wide text-white">Lineup Analysis</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-md border border-border p-1 text-xs">
            {(["all", "season", "playoff"] as GameFacetFilter["gameType"][]).map((f) => (
              <button
                key={f}
                onClick={() => setGameType(f)}
                className={`rounded px-3 py-1 capitalize transition ${
                  gameType === f ? "bg-accent-primary text-white" : "text-foreground/50 hover:text-white"
                }`}
              >
                {f === "all" ? "All games" : `${f} only`}
              </button>
            ))}
          </div>
          <select
            value={timeOfDay}
            onChange={(e) => setTimeOfDay(e.target.value as TimeOfDay | "all")}
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
            value={dayType}
            onChange={(e) => setDayType(e.target.value as DayType | "all")}
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

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[700px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-foreground/40">
              <th className="pb-2 pr-3">Slot</th>
              <th className="pb-2 pr-3">Player</th>
              <th className="pb-2 pr-3 text-center">AVG</th>
              <th className="pb-2 pr-3 text-center">OBP</th>
              <th className="pb-2 pr-3 text-center">SLG</th>
              <th className="pb-2 pr-3 text-center">K%</th>
              <th className="pb-2 pr-3 text-center">BB%</th>
              <th className="pb-2 text-center">RISP AVG</th>
            </tr>
          </thead>
          <tbody>
            {matrix.map((row) => {
              const isHole = holes.has(row.slot);
              return (
                <tr
                  key={row.slot}
                  className="border-t border-border"
                  style={isHole ? { borderLeft: "3px solid #E24B4A" } : undefined}
                >
                  <td className="py-2 pr-3 text-foreground/60">{row.slot}</td>
                  <td className="py-2 pr-3">
                    <Link href={`/coach/players/${row.playerId}`} className="text-white hover:text-accent-primary">
                      <span className="text-accent-gold">#{row.playerJersey ?? "—"}</span> {row.playerName}
                    </Link>
                    {isHole && <span className="ml-2 text-xs text-accent-red">⚠️ Lineup hole</span>}
                  </td>
                  <Cell value={formatAvg(row.avg)} rating={rateAvg(row.avg, row.pa)} />
                  <Cell value={formatAvg(row.obp)} rating={rateObp(row.obp, row.pa)} />
                  <Cell value={formatAvg(row.slg)} rating={rateSlg(row.slg, row.pa)} />
                  <Cell value={`${Math.round(row.kPct * 100)}%`} rating={rateKPct(row.kPct, row.pa)} />
                  <Cell value={`${Math.round(row.bbPct * 100)}%`} rating={rateBbPct(row.bbPct, row.pa)} />
                  <Cell value={row.rispAvg !== null ? formatAvg(row.rispAvg) : "—"} rating={rateRisp(row.rispAvg, row.rispAb)} />
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-foreground/40">
          Colored cells need at least 3 plate appearances (2 for RISP AVG) -- otherwise shown as &ldquo;&mdash;&rdquo;.
        </p>
      </div>

      <LineupInsightsPanel teamName={teamName} gameType={gameType} timeOfDay={timeOfDay} dayType={dayType} />
    </section>
  );
}

function Cell({ value, rating }: { value: string; rating: Rating }) {
  return (
    <td className="py-2 pr-3 text-center" style={{ backgroundColor: RATING_BG[rating] }}>
      <span className={rating === "none" ? "text-foreground/30" : "text-white"}>{rating === "none" ? "—" : value}</span>
    </td>
  );
}

// Feature 2: the AI panel re-fetches whenever the filter changes --
// getLineupInsights re-derives the matrix server-side from the same
// filter rather than trusting whatever this component already computed
// client-side, and caches per (team, filter, data-fingerprint).
function LineupInsightsPanel({
  teamName,
  gameType,
  timeOfDay,
  dayType,
}: {
  teamName: string;
  gameType: GameFacetFilter["gameType"];
  timeOfDay: TimeOfDay | "all";
  dayType: DayType | "all";
}) {
  const [insights, setInsights] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getLineupInsights({ gameType, timeOfDay, dayType }).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (result.ok) setInsights(result.insights);
      else setError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [gameType, timeOfDay, dayType]);

  return (
    <div className="mt-6 border-t border-border pt-5">
      <h3
        className="font-heading text-lg font-bold uppercase tracking-wide text-accent-gold"
        style={{ textShadow: "0 0 10px #F0C060, 0 0 20px rgba(240,192,96,0.4)" }}
      >
        Lineup Intelligence
      </h3>
      <p className="mt-1 text-xs text-foreground/40">AI coaching analysis for {teamName}&apos;s current lineup.</p>

      {loading && <p className="mt-3 text-sm text-foreground/50">Analyzing the lineup…</p>}
      {error && <p className="mt-3 text-sm text-accent-red">{error}</p>}
      {!loading && !error && insights && insights.length === 0 && (
        <p className="mt-3 text-sm text-foreground/50">Not enough logged at-bats yet for a real analysis.</p>
      )}
      {!loading && !error && insights && insights.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {insights.map((line, i) => (
            <li key={i} className="rounded-md border border-border bg-background/40 px-3 py-2 text-sm text-white">
              {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
