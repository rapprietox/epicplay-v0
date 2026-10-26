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
import { StatIcon } from "./stat-icons";

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

interface Leader {
  playerId: string;
  playerName: string;
  playerJersey: number | null;
}

// Fix 1 (tied leaders): collects EVERY player tied at the best value,
// not just the first one encountered -- the old version kept whichever
// player happened to come first in `players` order on a tie, silently
// hiding the others. A leading value of 0 (nobody's hit a HR yet, a
// pitcher with a 0.00 ERA included -- per the request's own example)
// is treated as "no leader" rather than crowning whoever happens to
// have the first 0 in roster order.
function pickLeaders<T>(
  players: Player[],
  lines: Map<string, T>,
  getValue: (line: T) => number,
  hasQualified: (line: T) => boolean,
  lowerIsBetter: boolean
): { value: number | null; leaders: Leader[] } {
  let bestValue: number | null = null;
  for (const player of players) {
    const line = lines.get(player.id);
    if (!line || !hasQualified(line)) continue;
    const value = getValue(line);
    if (!Number.isFinite(value)) continue;
    if (bestValue === null || (lowerIsBetter ? value < bestValue : value > bestValue)) {
      bestValue = value;
    }
  }
  if (bestValue === null || bestValue === 0) return { value: null, leaders: [] };

  const leaders: Leader[] = [];
  for (const player of players) {
    const line = lines.get(player.id);
    if (!line || !hasQualified(line)) continue;
    if (getValue(line) === bestValue) {
      leaders.push({ playerId: player.id, playerName: player.name, playerJersey: player.jersey_number });
    }
  }
  return { value: bestValue, leaders };
}

function buildRows(
  players: Player[],
  battingLines: Map<string, BattingLine>,
  pitchingLines: Map<string, PitchingLine>
): {
  label: string;
  value: number | null;
  leaders: Leader[];
  format: (v: number) => string;
}[] {
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
    const { value, leaders } = pickLeaders(players, battingLines, spec.get, spec.qualifies, false);
    return { label: spec.label, value, leaders, format: spec.format };
  });

  for (const spec of pitchingSpecs) {
    const { value, leaders } = pickLeaders(players, pitchingLines, spec.get, spec.qualifies, !!spec.lowerIsBetter);
    rows.push({ label: spec.label, value, leaders, format: spec.format });
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

      <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => {
          const hasData = row.value !== null && row.leaders.length > 0;
          // Fix 1: show every tied leader, not just the first -- 2-3
          // tied names separated by a dot, 4+ collapses to the first 2
          // plus "and X more" per the request.
          const shown = row.leaders.length > 3 ? row.leaders.slice(0, 2) : row.leaders;
          const extraCount = row.leaders.length > 3 ? row.leaders.length - 2 : 0;

          const inner = (
            <StatDivider label={row.label}>
              <p className="pl-4 text-[14px]" style={{ fontFamily: "var(--font-sans)", color: "#8AABCC" }}>
                {hasData ? (
                  <>
                    {shown.map((l, idx) => (
                      <span key={l.playerId}>
                        {idx > 0 && " · "}
                        <span style={{ color: "#F0C060" }}>#{l.playerJersey ?? "—"}</span> {l.playerName}
                      </span>
                    ))}
                    {extraCount > 0 && <span> and {extraCount} more</span>}
                  </>
                ) : (
                  "No data yet"
                )}
              </p>
              <p
                className="text-center leading-none"
                style={{
                  fontFamily: "var(--font-heading)",
                  fontWeight: 900,
                  fontSize: 52,
                  color: "#F0C060",
                  opacity: hasData ? 1 : 0.35,
                }}
              >
                {hasData ? row.format(row.value as number) : "—"}
              </p>
            </StatDivider>
          );

          // A single leader links to their player page; a tie has no one
          // destination to send the whole card to, so it stays plain.
          return row.leaders.length === 1 ? (
            <Link key={row.label} href={`/coach/players/${row.leaders[0].playerId}`} className="block transition hover:brightness-110">
              {inner}
            </Link>
          ) : (
            <div key={row.label}>{inner}</div>
          );
        })}
      </div>
    </section>
  );
}

// Team Leaders Board redesign: "section divider with text inside" -- a
// thin hairline (border color #1A3D28) with the stat name floated on top
// of it, the background-colored patch behind the text is what makes the
// line look like it's interrupted by the label rather than the label
// just sitting on top of an unbroken rule. Same rule, unlabeled, closes
// the card at the bottom.
//
// Adjustment batch: the glow moved here from the stat value below -- the
// label (icon + text) is now the card's neon element, DM Mono 11px
// uppercase, bright green with a two-layer glow; the number underneath
// stays clean, glow-free gold. The icon sits to the label text's left,
// same green (currentColor), 16x16.
function StatDivider({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-h-[100px]" style={{ backgroundColor: "#080E08", padding: "8px 12px" }}>
      <div className="relative h-px w-full" style={{ backgroundColor: "#1A3D28" }}>
        <span
          className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 whitespace-nowrap px-2 uppercase"
          style={{
            backgroundColor: "#080E08",
            color: "#2ECC71",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.15em",
            textShadow: "0 0 8px #2ECC71, 0 0 16px rgba(46,204,113,0.4)",
          }}
        >
          <StatIcon label={label} />
          {label}
        </span>
      </div>
      <div className="flex flex-col justify-center gap-1 py-2">{children}</div>
      <div className="h-px w-full" style={{ backgroundColor: "#1A3D28" }} />
    </div>
  );
}
