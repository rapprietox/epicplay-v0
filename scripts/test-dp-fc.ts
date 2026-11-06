// "Prove it" replay for the double-play/fielder's-choice rework
// (fix/dp-fc). Exercises the pure decision functions in
// src/lib/operator/runner-outcomes.ts directly -- the same functions
// operator-console.tsx calls into -- so this can't silently drift from
// what the real UI does. No DB, no React: pure function in, result out.
//
// Usage: npx tsx scripts/test-dp-fc.ts

import { resolveBattedBallPlay, resolveFieldersChoice } from "../src/lib/operator/runner-outcomes";
import type { RunnerState, Runners } from "../src/lib/supabase/types";

function player(name: string): RunnerState {
  return { type: "player", id: name, name };
}

let failures = 0;
function expect(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} -- ${label}: got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

console.log("\n=== 1. Runners on 1st and 2nd, ground out, both runners out ===");
{
  const r1 = resolveBattedBallPlay({
    result: "groundout",
    outsBeforePlay: 0,
    decisions: { second: "out", first: "out" },
  });
  console.log("outs:", r1.totalOutsAfter, "| extraOutBases:", r1.extraOutBases, "| label:", r1.resultLabel);
  expect("total outs this half-inning", r1.totalOutsAfter, 3);
  console.log(
    r1.resultLabel === "Double Play"
      ? "  (matches task wording)"
      : `  NOTE: task text says "double play" -- the stated counting rule (1 batter + 2 runners out = 3 total put out on one play) makes this a ${r1.resultLabel} instead. Implemented per the stated rule, flagged rather than silently forced to match the example's wording.`
  );
}

console.log("\n=== 2. Runner on 1st, ground out, runner out at second, batter out at first ===");
{
  const r2 = resolveBattedBallPlay({
    result: "groundout",
    outsBeforePlay: 0,
    decisions: { second: "out" },
  });
  console.log("outs:", r2.totalOutsAfter, "| label:", r2.resultLabel);
  expect("label", r2.resultLabel, "Double Play");
  expect("total outs", r2.totalOutsAfter, 2);
}

console.log("\n=== 3. Runner on 1st, fielder's choice, runner out at second ===");
{
  const runners: Runners = { first: player("R1"), second: null, third: null };
  const fc = resolveFieldersChoice({ runnersBeforePlay: runners, outBase: "first", outsBeforePlay: 0 }, player("Batter"));
  console.log("outsAdded:", fc.outsAdded, "| runners after:", fc.runnersAfter);
  expect("outs added", fc.outsAdded, 1);
  expect("batter ends on first", fc.runnersAfter.first?.name, "Batter");
  expect("second base empty", fc.runnersAfter.second, null);
  expect("third base empty", fc.runnersAfter.third, null);
}

console.log("\n=== 4. Runner on 2nd, fly out, runner doubled off ===");
{
  const r4 = resolveBattedBallPlay({
    result: "flyout",
    outsBeforePlay: 0,
    decisions: { second: "out" },
  });
  console.log("outs:", r4.totalOutsAfter, "| label:", r4.resultLabel);
  expect("label", r4.resultLabel, "Double Play");
  expect("total outs", r4.totalOutsAfter, 2);
}

console.log("\n=== 5. Runner on 3rd, 1 out, ground out, run scores ===");
{
  const r5 = resolveBattedBallPlay({
    result: "groundout",
    outsBeforePlay: 1,
    decisions: { third: "scored" },
  });
  console.log("outs:", r5.totalOutsAfter, "| scoredBases:", r5.scoredBases, "| inningEndedOnForce:", r5.inningEndedOnForce);
  expect("total outs", r5.totalOutsAfter, 2);
  expect("run counts (not cancelled)", r5.inningEndedOnForce, false);
  expect("scored bases", r5.scoredBases, ["third"]);
}

console.log("\n=== 6. Bases loaded, 2 outs, ground out, force at home ===");
{
  // outsBeforePlay >= 2 means the per-runner queue never starts in the
  // real UI (maybeStartRunnerOutcomeQueue's own gate) -- no runner is
  // ever asked, so decisions is empty and nobody can be marked "scored."
  const r6 = resolveBattedBallPlay({
    result: "groundout",
    outsBeforePlay: 2,
    decisions: {},
  });
  console.log("outs:", r6.totalOutsAfter, "| scoredBases:", r6.scoredBases, "| inningEndedOnForce:", r6.inningEndedOnForce);
  expect("total outs", r6.totalOutsAfter, 3);
  expect("no run", r6.scoredBases.length, 0);
  expect("ended on force", r6.inningEndedOnForce, true);
}

// --- Bug-fix follow-up replay (two wiring bugs found testing the
// practice game: Quick Mode's Fielder's Choice button never reached
// the wizard at all, and a runner marked "Out" on a Fly/Line/Foul Out
// never persisted as a real extra out). Both bugs were in
// operator-console.tsx's wiring, not in these pure functions -- every
// scenario below already passed before the fix too, which is exactly
// how the diagnosis found that the math was never the problem.

console.log("\n=== 7. Runner on 1st, 0 outs, FC, runner out at 2nd ===");
{
  const runners: Runners = { first: player("R1"), second: null, third: null };
  const fc = resolveFieldersChoice({ runnersBeforePlay: runners, outBase: "first", outsBeforePlay: 0 }, player("Batter"));
  console.log("outsAdded:", fc.outsAdded, "| runners after:", fc.runnersAfter);
  expect("outs added", fc.outsAdded, 1);
  expect("batter on first", fc.runnersAfter.first?.name, "Batter");
  expect("second empty", fc.runnersAfter.second, null);
  expect("third empty", fc.runnersAfter.third, null);
}

console.log("\n=== 8. Runners on 1st and 2nd, 0 outs, FC, runner on 2nd out ===");
{
  const runners: Runners = { first: player("R1"), second: player("R2"), third: null };
  const fc = resolveFieldersChoice({ runnersBeforePlay: runners, outBase: "second", outsBeforePlay: 0 }, player("Batter"));
  console.log("outsAdded:", fc.outsAdded, "| runners after:", fc.runnersAfter);
  expect("outs added", fc.outsAdded, 1);
  expect("batter on first", fc.runnersAfter.first?.name, "Batter");
  // R2 was on 2nd and chosen out -> removed from wherever the cascade
  // would have placed them (third); R1 still cascades 1st -> 2nd
  // regardless, since the force existed whether or not the defense
  // converted it into a putout.
  expect("R1 moves to second", fc.runnersAfter.second?.name, "R1");
  expect("third empty (R2 was out, not safe there)", fc.runnersAfter.third, null);
}

console.log("\n=== 9. Runner on 1st, 1 out, Line Out, runner out ===");
{
  const r9 = resolveBattedBallPlay({ result: "lineout", outsBeforePlay: 1, decisions: { first: "out" } });
  console.log("outs:", r9.totalOutsAfter, "| label:", r9.resultLabel);
  expect("label", r9.resultLabel, "Double Play");
  expect("total outs (inning ends)", r9.totalOutsAfter, 3);
}

console.log("\n=== 10. Runner on 1st, 1 out, Ground Out, runner out ===");
{
  const r10 = resolveBattedBallPlay({ result: "groundout", outsBeforePlay: 1, decisions: { first: "out" } });
  console.log("outs:", r10.totalOutsAfter, "| label:", r10.resultLabel);
  expect("label", r10.resultLabel, "Double Play");
  expect("total outs (inning ends)", r10.totalOutsAfter, 3);
}

console.log("\n=== 11. Runner on 2nd, 0 outs, Fly Out, runner doubled off ===");
{
  const r11 = resolveBattedBallPlay({ result: "flyout", outsBeforePlay: 0, decisions: { second: "out" } });
  console.log("outs:", r11.totalOutsAfter, "| label:", r11.resultLabel);
  expect("label", r11.resultLabel, "Double Play");
  expect("total outs", r11.totalOutsAfter, 2);
}

console.log(
  "\n=== 12. Undo-in-one-tap (architectural, not simulated here) ===\n" +
    "Every extra out above (FC's logExtraOut row, or the double/triple play's\n" +
    "confirmDoublePlay row(s)) is merged into the SAME state.lastConfirmed the\n" +
    "batter's own row already set, via APPEND_EXTRA_OUT (reducer.ts) setting\n" +
    "secondAtBatId/thirdAtBatId on it. handleUndo already deletes atBatId +\n" +
    "secondAtBatId + thirdAtBatId together in one undoAtBat call -- unchanged\n" +
    "by this fix, and not re-simulated here since it's the same single\n" +
    "lastConfirmed object either way, just with one or two more ids on it."
);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
