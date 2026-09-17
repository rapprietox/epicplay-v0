import type { AtBatResult } from "@/lib/supabase/types";

// There's no ground truth for how many pitches an at-bat "really" took --
// only what the operator logged. This estimates a defensible minimum from
// the final result (a walk needs at least 4 balls, a strikeout at least 3
// strikes, everything else at least the 1 pitch put in play or that hit
// the batter) and compares it to pitches actually logged. A documented
// heuristic, not a precise measurement -- fouls with 2 strikes can extend
// a real at-bat well past this minimum without that being an accuracy
// problem.
//
// Sprint 4 restated this as "balls + strikes + fouls + 1", but that's
// circular if taken literally: those counts are themselves derived from
// what the operator logged, so "expected" would always equal "actual" and
// the check could never fail. Kept this result-based heuristic instead,
// which is the only version of the formula that can actually detect
// under-logging.
const MIN_EXPECTED_PITCHES: Partial<Record<AtBatResult, number>> = {
  walk: 4,
  strikeout: 3,
  // Intentional walks deliberately bypass pitch-by-pitch logging entirely
  // (no popup, no zone taps) -- 0 pitches is correct by design here, not
  // under-logging, so this must never be scored against the operator's
  // accuracy percentage the way a real walk logged with 0 pitches would be.
  intentional_walk: 0,
};

export function expectedMinPitches(result: AtBatResult): number {
  return MIN_EXPECTED_PITCHES[result] ?? 1;
}

export function atBatAccuracyRatio(result: AtBatResult, loggedPitchCount: number): number {
  const expected = expectedMinPitches(result);
  if (expected === 0) return 1;
  return Math.min(1, loggedPitchCount / expected);
}

// Running average across every confirmed at-bat so far this game (not a
// consecutive-streak counter) -- matches the "Logging: 94% accurate"
// running-percentage display and the single game-wide
// games.logging_accuracy_score, stored as a 0-1 float.
export function runningAccuracy(sumOfRatios: number, count: number): number {
  return count > 0 ? sumOfRatios / count : 1;
}

export const RUNNING_ACCURACY_WARNING_THRESHOLD = 0.7;
