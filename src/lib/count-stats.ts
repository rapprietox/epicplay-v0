import type { AtBatResult, PitchOutcome, PitchType } from "@/lib/supabase/types";
import { HIT_RESULTS } from "@/lib/heat-map";

export interface CountPitch {
  pitch_number: number;
  outcome: PitchOutcome;
}

export interface CountState {
  balls: number;
  strikes: number;
}

// Standard baseball count-reconstruction from a pitch sequence: balls
// increment on "ball", strikes increment on "strike"/"foul" (a foul can't
// be strike three, so it's capped at 2 strikes), "hbp"/"inplay" end the
// at-bat on that pitch without changing the count further. Returns the
// count in effect *before* each pitch was thrown -- the last entry is the
// count the decisive (at-bat-ending) pitch was thrown into, which is the
// convention used everywhere in this file for "the count for an at-bat",
// matching how a zone heat map already uses "the last pitch's zone" as
// the at-bat's location.
export function reconstructCounts(pitches: CountPitch[]): CountState[] {
  const sorted = [...pitches].sort((a, b) => a.pitch_number - b.pitch_number);
  const counts: CountState[] = [];
  let balls = 0;
  let strikes = 0;
  for (const p of sorted) {
    counts.push({ balls, strikes });
    if (p.outcome === "ball") balls += 1;
    // foul_tip counts as a real strike (can complete strike 3), unlike a
    // regular foul which is capped at 2 -- same distinction the live
    // reducer's LOG_PITCH_LOCAL makes (Fix 3, baseball-logic-fixes batch).
    else if (p.outcome === "strike" || p.outcome === "foul_tip") strikes += 1;
    else if (p.outcome === "foul") strikes = Math.min(2, strikes + 1);
  }
  return counts;
}

export function finalCountForAtBat(pitches: CountPitch[]): CountState | null {
  if (pitches.length === 0) return null;
  const counts = reconstructCounts(pitches);
  return counts[counts.length - 1];
}

export function countLabel(c: CountState): string {
  return `${c.balls}-${c.strikes}`;
}

// The ten counts called out in the spec (3-2 and "full" are the same
// count, so it appears once, labeled as both).
export const TRACKED_COUNTS: { state: CountState; label: string }[] = [
  { state: { balls: 0, strikes: 0 }, label: "0-0" },
  { state: { balls: 1, strikes: 0 }, label: "1-0" },
  { state: { balls: 0, strikes: 1 }, label: "0-1" },
  { state: { balls: 2, strikes: 0 }, label: "2-0" },
  { state: { balls: 0, strikes: 2 }, label: "0-2" },
  { state: { balls: 1, strikes: 1 }, label: "1-1" },
  { state: { balls: 2, strikes: 1 }, label: "2-1" },
  { state: { balls: 3, strikes: 1 }, label: "3-1" },
  { state: { balls: 3, strikes: 2 }, label: "3-2 (Full)" },
];

export const PITCH_TYPES: { value: PitchType; label: string }[] = [
  { value: "fastball", label: "Fastball" },
  { value: "curveball", label: "Curveball" },
  { value: "changeup", label: "Changeup" },
  { value: "slider", label: "Slider" },
];

// "Strike" here means the pitches table's generic strike/foul/inplay
// outcome, not a true swing-and-miss (see the Strike Rate disclaimer on
// the pitcher heat map) -- reused wherever this app computes a strike
// rate from raw pitch outcomes.
export const STRIKE_OUTCOMES = new Set<PitchOutcome>(["strike", "foul", "foul_tip", "inplay"]);

// Clubhouse Pro batch: "Pressure Performance" -- deliberately reframed
// from the originally-requested "Pressure Performance Index" (no formula
// given, and this schema has no bases-loaded/RISP/late-and-close data at
// all -- game_state.runners is live-only, never persisted historically).
// Confirmed with the user: build an honestly-labeled proxy from data
// that IS supported -- 2-strike performance and full-count outcomes,
// both already derivable from finalCountForAtBat above, the same
// function the existing Count Performance panel uses. No invented
// composite score.
const PRESSURE_NOT_AB_RESULTS = new Set<AtBatResult>(["walk", "intentional_walk", "hbp"]);

export interface PressureAtBat {
  result: AtBatResult;
  finalCount: CountState | null;
}

export interface PressureSplits {
  seasonAvg: number;
  seasonAb: number;
  twoStrikeAvg: number;
  twoStrikeAb: number;
  fullCountOutcomes: { k: number; bb: number; hit: number; other: number; total: number };
}

export function computePressureSplits(atBats: PressureAtBat[]): PressureSplits {
  let seasonAb = 0;
  let seasonH = 0;
  let twoStrikeAb = 0;
  let twoStrikeH = 0;
  let k = 0;
  let bb = 0;
  let hit = 0;
  let other = 0;
  let fullCountTotal = 0;

  for (const ab of atBats) {
    const isAb = !PRESSURE_NOT_AB_RESULTS.has(ab.result);
    if (isAb) {
      seasonAb += 1;
      if (HIT_RESULTS.has(ab.result)) seasonH += 1;
    }
    if (!ab.finalCount) continue;

    if (ab.finalCount.strikes === 2 && isAb) {
      twoStrikeAb += 1;
      if (HIT_RESULTS.has(ab.result)) twoStrikeH += 1;
    }

    if (ab.finalCount.balls === 3 && ab.finalCount.strikes === 2) {
      fullCountTotal += 1;
      // dropped_third_strike_safe still counts as a strikeout-by-count
      // outcome here, same precedent as the existing Count Performance
      // panel (it's a strikeout by scoring rule, just not an out).
      if (ab.result === "strikeout" || ab.result === "dropped_third_strike_safe") k += 1;
      else if (ab.result === "walk" || ab.result === "intentional_walk") bb += 1;
      else if (HIT_RESULTS.has(ab.result)) hit += 1;
      else other += 1;
    }
  }

  return {
    seasonAvg: seasonAb > 0 ? seasonH / seasonAb : 0,
    seasonAb,
    twoStrikeAvg: twoStrikeAb > 0 ? twoStrikeH / twoStrikeAb : 0,
    twoStrikeAb,
    fullCountOutcomes: { k, bb, hit, other, total: fullCountTotal },
  };
}
