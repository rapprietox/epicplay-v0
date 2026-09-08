import type { AtBatResult, RunnerState, Runners } from "@/lib/supabase/types";

export interface AdvanceResult {
  runners: Runners;
  scored: RunnerState[];
}

// Suggested advancement only -- never applied without operator review (see
// the "Confirm Runners" flow in operator-console.tsx). Force logic on
// walk/hbp follows the standard cascade: the batter always takes 1st: a
// runner is forced to the next base only if every base behind them is
// occupied.
export function suggestRunnerAdvance(current: Runners, batter: RunnerState, result: AtBatResult): AdvanceResult {
  const scored: RunnerState[] = [];

  switch (result) {
    case "single":
    case "error":
    case "fc": {
      // Error/FC treated like a single for the suggestion -- the operator
      // adjusts individual runners for anything unusual.
      if (current.third) scored.push(current.third);
      return { runners: { first: batter, second: current.first ?? null, third: current.second ?? null }, scored };
    }
    case "double": {
      if (current.third) scored.push(current.third);
      if (current.second) scored.push(current.second);
      return { runners: { first: null, second: batter, third: current.first ?? null }, scored };
    }
    case "triple": {
      if (current.first) scored.push(current.first);
      if (current.second) scored.push(current.second);
      if (current.third) scored.push(current.third);
      return { runners: { first: null, second: null, third: batter }, scored };
    }
    case "hr": {
      if (current.first) scored.push(current.first);
      if (current.second) scored.push(current.second);
      if (current.third) scored.push(current.third);
      scored.push(batter);
      return { runners: {}, scored };
    }
    case "walk":
    case "hbp": {
      const first: RunnerState | null = batter;
      let second: RunnerState | null | undefined = current.second;
      let third: RunnerState | null | undefined = current.third;

      if (current.first) {
        // 1st is occupied -- that runner is forced to 2nd.
        if (current.second) {
          // 2nd is also occupied -- that runner is forced to 3rd.
          if (current.third) scored.push(current.third); // 3rd occupied too -- forced home
          third = current.second;
        }
        second = current.first;
      }
      return { runners: { first, second: second ?? null, third: third ?? null }, scored };
    }
    case "flyout":
    case "groundout":
    case "lineout":
    case "strikeout":
    default:
      return { runners: current, scored: [] };
  }
}

// Advances a single occupied base by one (Stolen Base / Error Advance /
// the "Advance" quick action). Scores the runner if advancing from third.
export function advanceOneRunner(runners: Runners, base: "first" | "second" | "third"): AdvanceResult {
  const runner = runners[base];
  if (!runner) return { runners, scored: [] };

  if (base === "third") {
    return { runners: { ...runners, third: null }, scored: [runner] };
  }
  if (base === "second") {
    if (runners.third) return { runners, scored: [] }; // 3rd occupied -- can't advance into it
    return { runners: { ...runners, second: null, third: runner }, scored: [] };
  }
  // first
  if (runners.second) return { runners, scored: [] }; // 2nd occupied -- can't advance into it
  return { runners: { ...runners, first: null, second: runner }, scored: [] };
}
