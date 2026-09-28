import type { AtBatResult, Database } from "@/lib/supabase/types";
import { computeBattingLines } from "./stats";

type AtBat = Database["public"]["Tables"]["at_bats"]["Row"];

// Opponent pitcher intelligence batch. All of this reads at_bats/pitches
// scoped to a single opponent_pitcher_id -- see the migration's comment
// in 20260928120001_opponent_pitcher_tracking.sql for why that column
// had to be added first (nothing here works without it).

export interface PitchArsenalEntry {
  pitchType: string;
  count: number;
  pct: number;
}

export function computePitchArsenal(pitches: { pitch_type: string | null }[]): PitchArsenalEntry[] {
  const counts = new Map<string, number>();
  let total = 0;
  for (const p of pitches) {
    if (!p.pitch_type) continue;
    counts.set(p.pitch_type, (counts.get(p.pitch_type) ?? 0) + 1);
    total += 1;
  }
  return Array.from(counts.entries())
    .map(([pitchType, count]) => ({ pitchType, count, pct: total > 0 ? (count / total) * 100 : 0 }))
    .sort((a, b) => b.count - a.count);
}

export interface BatterVsPitcherLine {
  playerId: string;
  playerName: string;
  ab: number;
  h: number;
  avg: number;
}

// Reuses computeBattingLines as-is (it already aggregates per player_id
// across whatever at-bats it's given) -- the only thing this adds is
// resolving each line's playerId to a display name and dropping anyone
// with 0 AB (never actually faced this pitcher).
export function computeBatterLinesVsPitcher(atBats: AtBat[], playerNameById: Map<string, string>): BatterVsPitcherLine[] {
  const lines = computeBattingLines(atBats, []);
  return Array.from(lines.values())
    .filter((l) => l.ab > 0)
    .map((l) => ({ playerId: l.playerId, playerName: playerNameById.get(l.playerId) ?? "Unknown", ab: l.ab, h: l.h, avg: l.avg }))
    .sort((a, b) => b.avg - a.avg);
}

const HIT_RESULTS = new Set<AtBatResult>(["single", "double", "triple", "hr", "ground_rule_double"]);
const NOT_AT_BAT_RESULTS = new Set<AtBatResult>(["walk", "intentional_walk", "hbp"]);

export interface PitchTypeLine {
  pitchType: string;
  ab: number;
  h: number;
  avg: number;
}

// Same "last pitch of the at-bat decided it" convention already
// established in lib/count-stats.ts/the player breakdown page's own
// pitch-type panels -- one pitch type per at-bat, not one per pitch.
export function computeBatterLinesByPitchType(atBats: { result: AtBatResult; pitchType: string | null }[]): PitchTypeLine[] {
  const byType = new Map<string, { ab: number; h: number }>();
  for (const ab of atBats) {
    if (!ab.pitchType || NOT_AT_BAT_RESULTS.has(ab.result)) continue;
    const entry = byType.get(ab.pitchType) ?? { ab: 0, h: 0 };
    entry.ab += 1;
    if (HIT_RESULTS.has(ab.result)) entry.h += 1;
    byType.set(ab.pitchType, entry);
  }
  return Array.from(byType.entries())
    .map(([pitchType, { ab, h }]) => ({ pitchType, ab, h, avg: ab > 0 ? h / ab : 0 }))
    .sort((a, b) => a.avg - b.avg);
}

// Sums the same per-player lines computeBatterLinesVsPitcher already
// derives from computeBattingLines, rather than re-deriving "what counts
// as an AB" a third time -- guarantees this always agrees with the
// per-batter numbers shown alongside it.
export function teamAvgAgainst(atBats: AtBat[]): { ab: number; h: number; avg: number } {
  const lines = computeBattingLines(atBats, []);
  let ab = 0;
  let h = 0;
  for (const line of Array.from(lines.values())) {
    ab += line.ab;
    h += line.h;
  }
  return { ab, h, avg: ab > 0 ? h / ab : 0 };
}
