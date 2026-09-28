"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Database } from "@/lib/supabase/types";
import { computeBattingLines, computePitchingLines, formatAvg, type BattingLine, type PitchingLine } from "@/lib/stats";
import {
  DAY_TYPE_LABELS,
  TIME_OF_DAY_LABELS,
  dayTypeBucket,
  resolveStartMinutes,
  timeOfDayBucket,
  type DayType,
  type TimeOfDay,
} from "@/lib/game-time-filters";

type AtBat = Database["public"]["Tables"]["at_bats"]["Row"];
type StolenBase = Database["public"]["Tables"]["stolen_bases"]["Row"];
type Game = Database["public"]["Tables"]["games"]["Row"];
type Player = Database["public"]["Tables"]["players"]["Row"];

type Filter = "all" | "season" | "playoff";

interface Props {
  players: Player[];
  atBats: AtBat[];
  stolenBases: StolenBase[];
  games: Game[];
}

function pickLeader<T>(
  players: Player[],
  lines: Map<string, T>,
  getValue: (line: T) => number,
  hasQualified: (line: T) => boolean
): { playerId: string | null; playerName: string | null; value: number | null } {
  let best: { playerId: string; playerName: string; value: number } | null = null;
  for (const player of players) {
    const line = lines.get(player.id);
    if (!line || !hasQualified(line)) continue;
    const value = getValue(line);
    if (!best || value > best.value) {
      best = { playerId: player.id, playerName: player.name, value };
    }
  }
  return best ?? { playerId: null, playerName: null, value: null };
}

function buildRows(
  players: Player[],
  battingLines: Map<string, BattingLine>,
  pitchingLines: Map<string, PitchingLine>
): { label: string; values: (number | null)[]; playerIds: (string | null)[]; playerNames: (string | null)[]; format: (v: number) => string }[] {
  const battingHasAb = (l: BattingLine) => l.ab > 0;
  const battingHasPa = (l: BattingLine) => l.ab + l.bb + l.hbp > 0;
  const pitchingHasIp = (l: PitchingLine) => l.ip > 0;

  const battingSpecs: {
    label: string;
    get: (l: BattingLine) => number;
    qualifies: (l: BattingLine) => boolean;
    format: (v: number) => string;
  }[] = [
    { label: "Batting Average", get: (l) => l.avg, qualifies: battingHasAb, format: formatAvg },
    { label: "Home Runs", get: (l) => l.hr, qualifies: battingHasAb, format: (v) => String(v) },
    { label: "RBI", get: (l) => l.rbi, qualifies: () => true, format: (v) => String(v) },
    { label: "OPS", get: (l) => l.ops, qualifies: battingHasPa, format: (v) => v.toFixed(3) },
    { label: "OBP", get: (l) => l.obp, qualifies: battingHasPa, format: (v) => formatAvg(v) },
    { label: "SLG", get: (l) => l.slg, qualifies: battingHasAb, format: (v) => formatAvg(v) },
    { label: "Hits", get: (l) => l.h, qualifies: battingHasAb, format: (v) => String(v) },
    { label: "Doubles", get: (l) => l.doubles, qualifies: battingHasAb, format: (v) => String(v) },
    { label: "Triples", get: (l) => l.triples, qualifies: battingHasAb, format: (v) => String(v) },
    { label: "Stolen Bases", get: (l) => l.sb, qualifies: (l) => l.sb > 0, format: (v) => String(v) },
  ];

  const pitchingSpecs: {
    label: string;
    get: (l: PitchingLine) => number;
    qualifies: (l: PitchingLine) => boolean;
    format: (v: number) => string;
    lowerIsBetter?: boolean;
  }[] = [
    { label: "ERA", get: (l) => l.era ?? Infinity, qualifies: pitchingHasIp, format: (v) => v.toFixed(2), lowerIsBetter: true },
    { label: "WHIP", get: (l) => l.whip ?? Infinity, qualifies: pitchingHasIp, format: (v) => v.toFixed(2), lowerIsBetter: true },
    { label: "Wins", get: (l) => l.wins, qualifies: (l) => l.wins > 0, format: (v) => String(v) },
    { label: "Strikeouts (P)", get: (l) => l.k, qualifies: pitchingHasIp, format: (v) => String(v) },
    { label: "Innings Pitched", get: (l) => l.ip, qualifies: pitchingHasIp, format: (v) => v.toFixed(1) },
  ];

  const rows = battingSpecs.map((spec) => {
    const leader = pickLeader(players, battingLines, spec.get, spec.qualifies);
    return {
      label: spec.label,
      values: [leader.value],
      playerIds: [leader.playerId],
      playerNames: [leader.playerName],
      format: spec.format,
    };
  });

  for (const spec of pitchingSpecs) {
    let best: { playerId: string; playerName: string; value: number } | null = null;
    for (const player of players) {
      const line = pitchingLines.get(player.id);
      if (!line || !spec.qualifies(line)) continue;
      const value = spec.get(line);
      const better = !best || (spec.lowerIsBetter ? value < best.value : value > best.value);
      if (better) best = { playerId: player.id, playerName: player.name, value };
    }
    rows.push({
      label: spec.label,
      values: [best?.value ?? null],
      playerIds: [best?.playerId ?? null],
      playerNames: [best?.playerName ?? null],
      format: spec.format,
    });
  }

  return rows;
}

export function LeadersBoard({ players, atBats, stolenBases, games }: Props) {
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

  const rows = useMemo(() => {
    const battingLines = computeBattingLines(filteredAtBats, filteredStolenBases);
    const pitchingLines = computePitchingLines(filteredAtBats, filteredGames);
    return buildRows(players, battingLines, pitchingLines);
  }, [players, filteredAtBats, filteredStolenBases, filteredGames]);

  const maxByLabel = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of rows) {
      const v = row.values[0];
      if (v !== null && Number.isFinite(v)) m.set(row.label, Math.max(m.get(row.label) ?? 0, v));
    }
    return m;
  }, [rows]);

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

      <div className="mt-4 grid grid-cols-1 gap-px overflow-hidden rounded-md border border-border bg-border md:grid-cols-2">
        {rows.map((row) => {
          const value = row.values[0];
          const playerId = row.playerIds[0];
          const playerName = row.playerNames[0];
          const max = maxByLabel.get(row.label) ?? 0;
          const ratio = value !== null && max > 0 && Number.isFinite(value) ? value / max : 0;

          const inner = (
            <>
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-foreground/50">
                  {row.label}
                </span>
                <span className="font-heading text-2xl font-bold text-accent-gold">
                  {value !== null ? row.format(value) : "—"}
                </span>
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className="truncate text-sm text-white">{playerName ?? "No data yet"}</span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-background">
                <div
                  className="h-full rounded-full bg-accent-gold/70"
                  style={{ width: `${Math.max(ratio, value !== null ? 0.06 : 0) * 100}%` }}
                />
              </div>
            </>
          );

          return playerId ? (
            <Link
              key={row.label}
              href={`/coach/players/${playerId}`}
              className="bg-surface p-4 transition hover:bg-background/60"
            >
              {inner}
            </Link>
          ) : (
            <div key={row.label} className="bg-surface p-4 opacity-60">
              {inner}
            </div>
          );
        })}
      </div>
    </section>
  );
}
