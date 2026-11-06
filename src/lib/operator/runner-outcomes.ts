import type { Base } from "@/lib/operator/types";

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

// Implicit-FC batch: replaces the old deterministic "which runner was
// put out, or No one out" wizard (resolveFieldersChoice, removed) --
// Fielder's Choice is no longer its own directly-pickable result. A
// plain Ground Out now always asks "Was the batter put out?" first
// (when a runner is on base and outs are below 2), then the SAME
// per-runner Scored/Advanced/Stayed/Out queue Fly Out/Line Out/a bunt
// out already use (see RunnerOutcomeDecision above) -- "scored"/"out"
// decisions here drive this function; "advanced"/"stayed" only ever
// move a runner locally (operator-console.tsx), so they don't need to
// appear in `decisions` at all. This is the one place that decides,
// from batterOut plus those decisions, whether the play is a plain
// ground out, a derived double/triple play, a derived fielder's choice,
// or (batter safe, nobody out) nothing worth recording at all -- kept
// pure and DB/React-free for the same reason resolveBattedBallPlay is:
// the real UI and the proof scripts can never disagree about the rule.
export interface GroundBallWithRunnersInput {
  // Whether the BATTER was put out on this play -- answered explicitly
  // by the operator before the per-runner queue starts (or already
  // known, for a bunt's own "Out at First"/"Safe" choice).
  batterOut: boolean;
  outsBeforePlay: number;
  decisions: Partial<Record<Base, RunnerOutcomeDecision>>;
}

export interface GroundBallWithRunnersResult {
  // Bases whose runner was marked "out" -- 0, 1, or 2 of them.
  extraOutBases: Base[];
  // Bases whose runner was marked "scored" -- before the third-out rule
  // (inningEndedOnForce) is applied.
  scoredBases: Base[];
  // (batterOut ? 1 : 0) plus one per extra out.
  outsAddedThisPlay: number;
  totalOutsAfter: number;
  // batterOut && exactly 1 extra out.
  isDoublePlay: boolean;
  // batterOut && 2 extra outs.
  isTriplePlay: boolean;
  // !batterOut && at least 1 extra out -- the batter reached because a
  // runner was put out instead. Always an at-bat, never a hit.
  isFieldersChoice: boolean;
  // !batterOut && no extra out -- nothing legitimately happened here;
  // this was a hit or an error, not a fielder's choice, and the caller
  // must record nothing and ask the operator to pick Single/Error instead.
  recordNothing: boolean;
  resultLabel: "Ground Out" | "Double Play" | "Triple Play" | "Fielder's Choice";
  // Same rule as resolveBattedBallPlay's own field: a run cannot score on
  // the play that records the 3rd out of the half-inning if that out was
  // a force (rule 5.09(b)/4.09(b)). The batter's own out on a ground ball
  // is always a force at first; so is any extra out recorded on the same
  // ground ball, whether or not the batter personally was the one retired
  // (a fielder's choice is still a ground ball, just one where the
  // defense chose a different forced runner over the sure out at first).
  inningEndedOnForce: boolean;
}

export function resolveGroundBallWithRunners(input: GroundBallWithRunnersInput): GroundBallWithRunnersResult {
  const { batterOut, outsBeforePlay, decisions } = input;
  const bases: Base[] = ["third", "second", "first"];
  const extraOutBases = bases.filter((b) => decisions[b] === "out");
  const scoredBases = bases.filter((b) => decisions[b] === "scored");

  const outsAddedThisPlay = (batterOut ? 1 : 0) + extraOutBases.length;
  const totalOutsAfter = Math.min(3, outsBeforePlay + outsAddedThisPlay);

  const isDoublePlay = batterOut && extraOutBases.length === 1;
  const isTriplePlay = batterOut && extraOutBases.length >= 2;
  const isFieldersChoice = !batterOut && extraOutBases.length > 0;
  const recordNothing = !batterOut && extraOutBases.length === 0;

  const resultLabel = isTriplePlay ? "Triple Play" : isDoublePlay ? "Double Play" : isFieldersChoice ? "Fielder's Choice" : "Ground Out";

  const inningEndedOnForce = totalOutsAfter >= 3 && (batterOut || extraOutBases.length > 0);

  return {
    extraOutBases,
    scoredBases,
    outsAddedThisPlay,
    totalOutsAfter,
    isDoublePlay,
    isTriplePlay,
    isFieldersChoice,
    recordNothing,
    resultLabel,
    inningEndedOnForce,
  };
}
