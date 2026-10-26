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

interface RankedPlayer extends Leader {
  value: number;
}

export interface LeaderRow {
  label: string;
  value: number | null;
  leaders: Leader[];
  ranking: RankedPlayer[];
  format: (v: number) => string;
  lowerIsBetter: boolean;
}

// Full ranking fix: every qualifying player, best to worst -- the card
// only ever needs the leader(s), but the "view full leaderboard" modal
// needs everyone else too, so this is computed once and both the card
// and the modal read from the same list rather than two separate passes.
function buildRanking<T>(
  players: Player[],
  lines: Map<string, T>,
  getValue: (line: T) => number,
  hasQualified: (line: T) => boolean,
  lowerIsBetter: boolean
): RankedPlayer[] {
  const entries: RankedPlayer[] = [];
  for (const player of players) {
    const line = lines.get(player.id);
    if (!line || !hasQualified(line)) continue;
    const value = getValue(line);
    if (!Number.isFinite(value)) continue;
    entries.push({ playerId: player.id, playerName: player.name, playerJersey: player.jersey_number, value });
  }
  entries.sort((a, b) => (lowerIsBetter ? a.value - b.value : b.value - a.value));
  return entries;
}

// A leading value of 0 (nobody's hit a HR yet, a pitcher with a 0.00
// ERA included -- per the request's own example) is treated as "no
// leader" on the card rather than crowning whoever happens to sort
// first at 0 -- the full ranking (for the modal) still lists everyone,
// zeroes included, since a complete leaderboard is a different thing
// than "who's the card's one leader."
function leadersFromRanking(ranking: RankedPlayer[]): { value: number | null; leaders: Leader[] } {
  const topValue = ranking[0]?.value ?? null;
  if (topValue === null || topValue === 0) return { value: null, leaders: [] };
  return { value: topValue, leaders: ranking.filter((r) => r.value === topValue) };
}

function buildRows(players: Player[], battingLines: Map<string, BattingLine>, pitchingLines: Map<string, PitchingLine>): LeaderRow[] {
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

  const rows: LeaderRow[] = battingSpecs.map((spec) => {
    const ranking = buildRanking(players, battingLines, spec.get, spec.qualifies, false);
    const { value, leaders } = leadersFromRanking(ranking);
    return { label: spec.label, value, leaders, ranking, format: spec.format, lowerIsBetter: false };
  });

  for (const spec of pitchingSpecs) {
    const lowerIsBetter = !!spec.lowerIsBetter;
    const ranking = buildRanking(players, pitchingLines, spec.get, spec.qualifies, lowerIsBetter);
    const { value, leaders } = leadersFromRanking(ranking);
    rows.push({ label: spec.label, value, leaders, ranking, format: spec.format, lowerIsBetter });
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
  // Leaderboard modal fix: a stat card used to link straight to the
  // single leader's player page, which made a tie meaningless (nowhere
  // to click) and hid everyone else's rank entirely. Every card now
  // opens this modal instead -- navigation only ever happens from an
  // individual player row inside it.
  const [selectedStat, setSelectedStat] = useState<LeaderRow | null>(null);

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

          // Every card opens the full leaderboard modal now -- no more
          // linking straight to a single player's page from here.
          return (
            <button
              key={row.label}
              type="button"
              onClick={() => setSelectedStat(row)}
              className="block w-full text-left transition hover:brightness-110"
            >
              {inner}
            </button>
          );
        })}
      </div>

      {selectedStat && <LeaderboardModal row={selectedStat} onClose={() => setSelectedStat(null)} />}
    </section>
  );
}

// Leaderboard modal fix: every qualifying player ranked for the clicked
// stat, with a bar scaled relative to the leader -- for a lowerIsBetter
// stat (ERA/WHIP) that's leaderValue/value (leader's own ratio is 1, a
// worse/higher value shrinks it), otherwise the plain value/leaderValue
// ratio. leaderValue === 0 is special-cased either way to avoid a 0/0 or
// a misleadingly-full bar for a value that isn't actually the best.
function barPct(value: number, leaderValue: number, lowerIsBetter: boolean): number {
  if (leaderValue === 0) return lowerIsBetter ? (value === 0 ? 100 : 0) : 0;
  const ratio = lowerIsBetter ? leaderValue / value : value / leaderValue;
  return Math.max(0, Math.min(100, ratio * 100));
}

function LeaderboardModal({ row, onClose }: { row: LeaderRow; onClose: () => void }) {
  const leaderValue = row.ranking[0]?.value ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="glossy max-h-[80vh] w-full max-w-md overflow-y-auto rounded-lg border-2 p-5"
        style={{ backgroundColor: "#080E08", borderColor: "#2ECC71" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-heading text-xl font-bold uppercase tracking-wide text-white">{row.label}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md px-2 py-1 text-foreground/50 transition hover:text-white"
          >
            ✕
          </button>
        </div>

        {row.ranking.length === 0 ? (
          <p className="mt-4 text-sm text-foreground/50">No qualifying players yet.</p>
        ) : (
          <div className="mt-4 flex flex-col gap-2">
            {row.ranking.map((r, i) => (
              <Link
                key={r.playerId}
                href={`/coach/players/${r.playerId}`}
                onClick={onClose}
                className="flex items-center gap-3 rounded-md px-2 py-2 transition hover:bg-white/5"
              >
                <span className="w-5 shrink-0 text-right text-xs text-foreground/40">{i + 1}</span>
                <span className="w-24 shrink-0 truncate text-sm text-white">
                  <span style={{ color: "#F0C060" }}>#{r.playerJersey ?? "—"}</span> {r.playerName}
                </span>
                <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                  <span
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{ width: `${barPct(r.value, leaderValue, row.lowerIsBetter)}%`, backgroundColor: "#2ECC71" }}
                  />
                </span>
                <span className="w-12 shrink-0 text-right font-mono text-sm text-accent-gold">{row.format(r.value)}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
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
