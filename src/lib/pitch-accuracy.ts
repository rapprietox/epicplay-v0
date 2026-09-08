import type { AtBatResult } from "@/lib/supabase/types";

// There's no ground truth for how many pitches an at-bat "really" took --
// only what the operator logged. This estimates a defensible minimum from
// the final result (a walk needs at least 4 balls, a strikeout at least 3
// strikes, everything else at least the 1 pitch put in play or that hit
// the batter) and compares it to pitches actually logged. A documented
// heuristic, not a precise measurement -- fouls with 2 strikes can extend
// a real at-bat well past this minimum without that being an accuracy
// problem, which is why this only flags being under 50%, not any gap.
const MIN_EXPECTED_PITCHES: Partial<Record<AtBatResult, number>> = {
  walk: 4,
  strikeout: 3,
};

export function expectedMinPitches(result: AtBatResult): number {
  return MIN_EXPECTED_PITCHES[result] ?? 1;
}

export function atBatAccuracyRatio(result: AtBatResult, loggedPitchCount: number): number {
  const expected = expectedMinPitches(result);
  return Math.min(1, loggedPitchCount / expected);
}

export const LOW_ACCURACY_THRESHOLD = 0.5;
export const LOW_ACCURACY_STREAK_WARNING = 3;
