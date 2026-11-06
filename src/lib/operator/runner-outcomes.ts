import type { Base } from "@/lib/operator/types";
import type { RunnerState, Runners } from "@/lib/supabase/types";

// Shared by the per-runner outcome queue (operator-console.tsx) for
// Ground Out/Fly Out/Line Out/Foul Out (Foul Out is just "flyout" with a
// different scorebook label -- see quick-mode-grid.tsx) and by
// scripts/test-dp-fc.ts (the "replay these in code" proof). Kept pure
// and DB/React-free on purpose: this is the one place the double-play/
// triple-play out-counting and the third-out run-cancellation rule are
// decided, so the real UI and the proof script can never disagree about
// what the rule says.

export type RunnerOutcomeDecision = "scored" | "advanced" | "stayed" | "out";

export interface BattedBallPlayInput {
  // "groundout" is always a force at first (the batter-runner has no
  // choice but to run); "flyout"/"lineout" never are (the batter is
  // retired in the air, not forced) -- see batterIsForced below. Foul
  // Out reuses "flyout" (see quick-mode-grid.tsx's own comment).
  result: "groundout" | "flyout" | "lineout";
  outsBeforePlay: number;
  // Only the bases actually asked (occupied, with outsBeforePlay < 2 at
  // the moment the queue started) need an entry; anything else is
  // treated as "stayed" (no effect).
  decisions: Partial<Record<Base, RunnerOutcomeDecision>>;
}

export interface BattedBallPlayResult {
  // Bases whose runner was marked "out" -- 0, 1, or 2 of them.
  extraOutBases: Base[];
  // Bases whose runner was marked "scored" -- before the third-out rule
  // (below) is applied. Checking isRunCancelled per base tells you
  // whether it actually counts.
  scoredBases: Base[];
  // 1 for the batter, plus one more per extra out.
  outsAddedThisPlay: number;
  // Capped at 3 -- this play alone can't record more outs than are left
  // in the half-inning, even if outsBeforePlay + outsAddedThisPlay would
  // otherwise overshoot it.
  totalOutsAfter: number;
  isDoublePlay: boolean;
  isTriplePlay: boolean;
  // "Ground Out" / "Fly Out" / "Line Out" unchanged when this is just a
  // single out; "Double Play" / "Triple Play" when outsAddedThisPlay is
  // 2 or 3.
  resultLabel: string;
  // True when the out that brought the half-inning to 3 was a force --
  // either the batter's own groundout (always a force at first) or one
  // of the extraOutBases, which are only ever treated as forces for a
  // groundout (a fly/line out's "doubled off" runner is a tag-up
  // violation, never a force -- see isGroundoutForce below). Rule
  // 5.09(b)/4.09(b): a run cannot score on a play that ends in a force
  // out for the 3rd out, no matter when the runner crossed home.
  inningEndedOnForce: boolean;
}

const RESULT_LABEL: Record<BattedBallPlayInput["result"], string> = {
  groundout: "Ground Out",
  flyout: "Fly Out",
  lineout: "Line Out",
};

export function resolveBattedBallPlay(input: BattedBallPlayInput): BattedBallPlayResult {
  const { result, outsBeforePlay, decisions } = input;
  const bases: Base[] = ["third", "second", "first"];
  const extraOutBases = bases.filter((b) => decisions[b] === "out");
  const scoredBases = bases.filter((b) => decisions[b] === "scored");

  const outsAddedThisPlay = 1 + extraOutBases.length; // 1 for the batter
  const totalOutsAfter = Math.min(3, outsBeforePlay + outsAddedThisPlay);

  const isDoublePlay = outsAddedThisPlay === 2;
  const isTriplePlay = outsAddedThisPlay >= 3;
  const resultLabel = isTriplePlay ? "Triple Play" : isDoublePlay ? "Double Play" : RESULT_LABEL[result];

  // A groundout's own batter-out is always a force at first; an extra
  // out recorded on a groundout (the classic 6-4-3/4-6-3 relay) is the
  // same force play, just one base further along. A fly/line out's
  // batter is never forced, and a runner "doubled off" a caught fly
  // ball is a tag-up violation, not a force -- so extra outs on those
  // results never count toward this rule.
  const isGroundoutForce = result === "groundout";
  const inningEndedOnForce = totalOutsAfter >= 3 && isGroundoutForce;

  return {
    extraOutBases,
    scoredBases,
    outsAddedThisPlay,
    totalOutsAfter,
    isDoublePlay,
    isTriplePlay,
    resultLabel,
    inningEndedOnForce,
  };
}

export interface FieldersChoiceInput {
  runnersBeforePlay: Runners;
  // Which occupied base's runner was put out, or null for "No one out."
  outBase: Base | null;
  outsBeforePlay: number;
}

export interface FieldersChoiceResult {
  runnersAfter: Runners;
  // 0 or 1 -- an FC can put out at most one baserunner; the batter is
  // always safe at first by definition.
  outsAdded: number;
  // 0 or 1 -- only the runner who started on third can score on this
  // simplified force-cascade model (same cascade a single already uses).
  runsScored: number;
  // RBI only when there were fewer than 2 outs before the play and (by
  // construction -- this wizard has no error branch) no error was
  // involved. The run still counts toward runsScored either way; only
  // the RBI is conditional.
  rbi: number;
  scoredRunnerBase: "third" | null;
}

// Force cascade: batter always takes first; every other occupied base
// is pushed up by exactly one (same math a single/error uses -- see
// suggestRunnerAdvance's "fc" case). The chosen "out" runner is then
// removed from wherever that cascade would have placed them (not their
// original base), since the force existed regardless of whether the
// defense converted it into a putout or let the runner advance.
export function resolveFieldersChoice(input: FieldersChoiceInput, batter: RunnerState): FieldersChoiceResult {
  const { runnersBeforePlay: r, outBase, outsBeforePlay } = input;

  let runnersAfter: Runners = {
    first: batter,
    second: r.first ?? null,
    third: r.second ?? null,
  };
  let scoredRunner: RunnerState | null = r.third ?? null;

  if (outBase === "first") runnersAfter = { ...runnersAfter, second: null };
  else if (outBase === "second") runnersAfter = { ...runnersAfter, third: null };
  else if (outBase === "third") scoredRunner = null;

  const runsScored = scoredRunner ? 1 : 0;
  const rbi = runsScored > 0 && outsBeforePlay < 2 ? 1 : 0;

  return {
    runnersAfter,
    outsAdded: outBase ? 1 : 0,
    runsScored,
    rbi,
    scoredRunnerBase: scoredRunner ? "third" : null,
  };
}
