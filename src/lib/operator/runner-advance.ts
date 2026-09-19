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
    // Fix 9 (baseball-logic-fixes batch, minor tier): a ground rule double
    // awards exactly 2 bases to the batter and every runner, which is
    // already exactly what "double"'s own math below does (1st->3rd,
    // 2nd/3rd score, batter->2nd) -- the two share this case rather than
    // duplicating it. The real distinction is upstream, in pickResult:
    // ground_rule_double is deliberately left out of
    // HIT_RESULTS_NEED_RUNNER_CONFIRM, so it skips the ask-queue entirely
    // and this suggestion always applies automatically, no operator
    // judgment -- unlike a regular double, where a runner on 1st still
    // gets asked (see decideRunnerOnHit) since real hit-and-field
    // circumstances genuinely make "3rd or scores" ambiguous.
    case "double":
    case "ground_rule_double": {
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
    case "intentional_walk":
    case "hbp":
    // Fix 2 (baseball-logic-fixes batch): the batter reaching first safe
    // on a dropped third strike forces the same cascade a walk/HBP would
    // -- same "batter always takes 1st, force cascades from there" logic,
    // no separate derivation needed. (This case is only ever eligible
    // when 1st was open or there were 2 outs -- see the dropped-third-
    // strike eligibility check in operator-console.tsx -- so the "1st
    // occupied cascades everyone up" branch below only actually fires in
    // the 2-out sub-case.)
    case "dropped_third_strike_safe": {
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
    case "double_play":
    default:
      // Double play doesn't auto-suggest a scored runner even though one
      // occasionally can score on the play -- the DP wizard only resolves
      // the two outs; any additional run is a manual "Scored" tap on the
      // diamond afterward, same as any other out.
      return { runners: current, scored: [] };
  }
}

// Fix 1 (force-play validation, baseball-logic audit batch): whether the
// runner on `base` is forced to advance, given who occupied the earlier
// bases at the moment this play started. Force status is fixed for the
// whole play under standard rules -- it is NOT recalculated as outs
// happen within the same play ("reverse force" only removes a force for
// bases behind an already-out runner on the *next* play, once a new
// runnersAtAtBatStart snapshot is taken; see the CONFIRM_LOCAL/
// START_DRAFT_LOCAL reset in reducer.ts). A runner is forced only if
// every base behind them (back to home, via the batter) is also
// occupied, since that's what leaves them with no choice but to run.
export function isForced(base: "first" | "second" | "third", runnersAtStart: Runners | null): boolean {
  if (!runnersAtStart) return false;
  if (base === "first") return true;
  if (base === "second") return Boolean(runnersAtStart.first);
  return Boolean(runnersAtStart.first) && Boolean(runnersAtStart.second);
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
