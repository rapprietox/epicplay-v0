import type { PitchOutcome, PitchType } from "@/lib/supabase/types";

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
    else if (p.outcome === "strike") strikes += 1;
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
export const STRIKE_OUTCOMES = new Set<PitchOutcome>(["strike", "foul", "inplay"]);
