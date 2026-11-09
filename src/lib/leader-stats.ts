import { formatAvg, type BattingLine, type PitchingLine } from "@/lib/stats";
import { isRateQualified, rateShortfall, type RateQualificationKind } from "@/lib/leader-qualification";
import type { Database } from "@/lib/supabase/types";

type Player = Database["public"]["Tables"]["players"]["Row"];

export interface Leader {
  playerId: string;
  playerName: string;
  playerJersey: number | null;
}

export interface RankedPlayer extends Leader {
  value: number;
  qualified: boolean;
  // PA or IP still needed to clear the bar -- null once qualified, or
  // for a stat with no rate-qualification bar at all (every counting
  // stat always has shortfall: null).
  shortfall: number | null;
}

export interface LeaderRow {
  label: string;
  value: number | null;
  leaders: Leader[];
  ranking: RankedPlayer[];
  format: (v: number) => string;
  lowerIsBetter: boolean;
  // Drives both the card's empty-state text ("Not enough games yet" vs
  // "No data yet") and whether the ranking modal splits qualified vs
  // "Not enough at-bats yet" at all -- a counting stat never splits,
  // since every entry in `ranking` is already qualified for one.
  rateQualification: RateQualificationKind | null;
}

interface Spec<T> {
  label: string;
  get: (l: T) => number;
  qualifies: (l: T) => boolean;
  format: (v: number) => string;
  lowerIsBetter?: boolean;
  // Present only for a rate stat. `metricFor` reads the PA or IP value
  // to test against the scaled bar -- distinct from `get`, since e.g.
  // ERA's own qualifying metric is innings pitched, not the ERA number.
  rateQualification?: RateQualificationKind;
  metricFor?: (l: T) => number;
}

// Leader-qualification batch + same-cards batch: the full stat list the
// coach's Team Leaders Board already showed, now also the player
// Clubhouse's -- shared here so the two views can't drift apart again.
// Matches src/app/coach/leaders-board.tsx's pre-existing qualifying
// conditions exactly (battingHasAb / battingHasPa), just with each spec
// additionally saying whether it's a rate stat and what its own
// qualifying metric is.
const BATTING_SPECS: Spec<BattingLine>[] = [
  { label: "Batting Average", get: (l) => l.avg, qualifies: (l) => l.ab > 0, format: formatAvg, rateQualification: "pa", metricFor: (l) => l.pa },
  { label: "Home Runs", get: (l) => l.hr, qualifies: (l) => l.ab > 0, format: (v) => String(v) },
  { label: "RBI", get: (l) => l.rbi, qualifies: () => true, format: (v) => String(v) },
  // Hitting-table batch: a counting stat (runs scored), so no rate
  // qualification -- same shape as RBI right above it.
  { label: "Runs", get: (l) => l.runsScored, qualifies: () => true, format: (v) => String(v) },
  // Sacrifice-rules batch: was `l.ab + l.bb + l.hbp > 0`, a re-derivation
  // that silently excluded sacrifices -- a player whose only PA was a
  // sacrifice fly/bunt would fail OPS/OBP qualification despite having a
  // real plate appearance. `l.pa` is now the correct, single source of
  // truth for this (see computeBattingLines in src/lib/stats.ts).
  { label: "OPS", get: (l) => l.ops, qualifies: (l) => l.pa > 0, format: (v) => v.toFixed(3), rateQualification: "pa", metricFor: (l) => l.pa },
  { label: "OBP", get: (l) => l.obp, qualifies: (l) => l.pa > 0, format: (v) => formatAvg(v), rateQualification: "pa", metricFor: (l) => l.pa },
  { label: "SLG", get: (l) => l.slg, qualifies: (l) => l.ab > 0, format: (v) => formatAvg(v), rateQualification: "pa", metricFor: (l) => l.pa },
  { label: "Hits", get: (l) => l.h, qualifies: (l) => l.ab > 0, format: (v) => String(v) },
  { label: "Doubles", get: (l) => l.doubles, qualifies: (l) => l.ab > 0, format: (v) => String(v) },
  { label: "Triples", get: (l) => l.triples, qualifies: (l) => l.ab > 0, format: (v) => String(v) },
  { label: "Stolen Bases", get: (l) => l.sb, qualifies: (l) => l.sb > 0, format: (v) => String(v) },
];

const PITCHING_SPECS: Spec<PitchingLine>[] = [
  { label: "ERA", get: (l) => l.era ?? Infinity, qualifies: (l) => l.ip > 0, format: (v) => v.toFixed(2), lowerIsBetter: true, rateQualification: "ip", metricFor: (l) => l.ip },
  { label: "WHIP", get: (l) => l.whip ?? Infinity, qualifies: (l) => l.ip > 0, format: (v) => v.toFixed(2), lowerIsBetter: true, rateQualification: "ip", metricFor: (l) => l.ip },
  { label: "Wins", get: (l) => l.wins, qualifies: (l) => l.wins > 0, format: (v) => String(v) },
  { label: "Strikeouts (P)", get: (l) => l.k, qualifies: (l) => l.ip > 0, format: (v) => String(v) },
  { label: "Innings Pitched", get: (l) => l.ip, qualifies: (l) => l.ip > 0, format: (v) => v.toFixed(1) },
];

function buildRanking<T>(players: Player[], lines: Map<string, T>, spec: Spec<T>, teamGames: number): RankedPlayer[] {
  const entries: RankedPlayer[] = [];
  for (const player of players) {
    const line = lines.get(player.id);
    if (!line || !spec.qualifies(line)) continue;
    const value = spec.get(line);
    if (!Number.isFinite(value)) continue;

    let qualified = true;
    let shortfall: number | null = null;
    if (spec.rateQualification && spec.metricFor) {
      const metric = spec.metricFor(line);
      qualified = isRateQualified(spec.rateQualification, metric, teamGames);
      if (!qualified) shortfall = rateShortfall(spec.rateQualification, metric, teamGames);
    }
    entries.push({ playerId: player.id, playerName: player.name, playerJersey: player.jersey_number, value, qualified, shortfall });
  }
  const lowerIsBetter = !!spec.lowerIsBetter;
  entries.sort((a, b) => (lowerIsBetter ? a.value - b.value : b.value - a.value));
  return entries;
}

// A leading value of 0 for a counting stat (nobody's hit a HR yet) is
// "no leader," not a real 0 to crown -- same pre-existing rule as
// before. For a rate stat, the card's leader is only ever picked from
// the QUALIFIED pool; an empty qualified pool is "Not enough games
// yet," not "no leader," and is reported as such by the caller
// checking `rateQualification` on the row, not by this function.
function pickCardValue(ranking: RankedPlayer[], lowerIsBetter: boolean, isRateStat: boolean): { value: number | null; leaders: Leader[] } {
  const pool = isRateStat ? ranking.filter((r) => r.qualified) : ranking;
  const topValue = pool[0]?.value ?? null;
  if (topValue === null || (topValue === 0 && !lowerIsBetter)) return { value: null, leaders: [] };
  return { value: topValue, leaders: pool.filter((r) => r.value === topValue) };
}

// Used by both src/app/coach/leaders-board.tsx and
// src/app/player/clubhouse/team-section.tsx -- same rows, same
// qualification, so the two boards can never show different leaders
// for the same underlying data. `teamGames` is the caller's own
// completed-game count under whatever filter it's currently showing
// (see src/lib/leader-qualification.ts's countTeamGames).
export function buildLeaderRows(
  players: Player[],
  battingLines: Map<string, BattingLine>,
  pitchingLines: Map<string, PitchingLine>,
  epsLines: Map<string, number | null>,
  teamGames: number
): LeaderRow[] {
  const rows: LeaderRow[] = [];

  for (const spec of BATTING_SPECS) {
    const ranking = buildRanking(players, battingLines, spec, teamGames);
    const { value, leaders } = pickCardValue(ranking, !!spec.lowerIsBetter, !!spec.rateQualification);
    rows.push({ label: spec.label, value, leaders, ranking, format: spec.format, lowerIsBetter: !!spec.lowerIsBetter, rateQualification: spec.rateQualification ?? null });
  }
  for (const spec of PITCHING_SPECS) {
    const ranking = buildRanking(players, pitchingLines, spec, teamGames);
    const { value, leaders } = pickCardValue(ranking, !!spec.lowerIsBetter, !!spec.rateQualification);
    rows.push({ label: spec.label, value, leaders, ranking, format: spec.format, lowerIsBetter: !!spec.lowerIsBetter, rateQualification: spec.rateQualification ?? null });
  }

  // Performance Score (EPS) isn't a BattingLine/PitchingLine field, so
  // it gets its own small ranking pass here -- qualification uses the
  // same PA metric as every other hitting rate stat.
  const epsRanking: RankedPlayer[] = [];
  for (const player of players) {
    const eps = epsLines.get(player.id);
    if (eps === null || eps === undefined) continue;
    const pa = battingLines.get(player.id)?.pa ?? 0;
    const qualified = isRateQualified("pa", pa, teamGames);
    epsRanking.push({
      playerId: player.id,
      playerName: player.name,
      playerJersey: player.jersey_number,
      value: eps,
      qualified,
      shortfall: qualified ? null : rateShortfall("pa", pa, teamGames),
    });
  }
  epsRanking.sort((a, b) => b.value - a.value);
  const { value: epsValue, leaders: epsLeaders } = pickCardValue(epsRanking, false, true);
  rows.push({ label: "Performance Score", value: epsValue, leaders: epsLeaders, ranking: epsRanking, format: (v) => v.toFixed(1), lowerIsBetter: false, rateQualification: "pa" });

  return rows;
}
