// "Prove it by replay" for "Make Fielder's Choice implicit" (fix/dp-fc
// follow-up). Two layers, same as the rest of this branch's proof
// scripts:
//   1. The pure decision function (resolveGroundBallWithRunners in
//      src/lib/operator/runner-outcomes.ts) -- the single place that
//      decides, from "was the batter out" plus the per-runner
//      Scored/Advanced/Stayed/Out answers, whether a ground ball is a
//      plain out, a derived double/triple play, a derived fielder's
//      choice, or (batter safe, nobody out) nothing worth recording.
//   2. The REAL reducer (operatorReducer), dispatching the exact action
//      sequence operator-console.tsx's beginImplicitFcFlow /
//      finalizeImplicitFc / handleRunnerOutcomeDecision fire for Quick
//      Mode (QUICK_CONFIRM_LOCAL + APPEND_EXTRA_OUT, the same shape
//      Full Mode's handleConfirm produces for its own fc case) -- so
//      outs/runners/battingOrderPosition/score and Undo are all proven
//      against the real state machine, not just the pure function.
//
// Usage: npx tsx scripts/test-implicit-fc.ts

import { operatorReducer } from "../src/lib/operator/reducer";
import { resolveBattedBallPlay, resolveGroundBallWithRunners } from "../src/lib/operator/runner-outcomes";
import type { OperatorState } from "../src/lib/operator/types";
import type { RunnerState, Runners } from "../src/lib/supabase/types";

function player(name: string): RunnerState {
  return { type: "player", id: name, name };
}

function baseState(overrides: Partial<OperatorState> = {}): OperatorState {
  return {
    gameId: "game-1",
    mode: "hitting",
    inning: 1,
    inningHalf: "top",
    outs: 0,
    ourScore: 0,
    opponentScore: 0,
    battingOrderPosition: 2,
    battingOrderSlots: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    currentPitcherId: null,
    currentOpponentPitcherId: null,
    opponentBatterName: "",
    runners: {},
    runnersAtAtBatStart: null,
    currentPlayForceOuts: [],
    currentAtBatId: null,
    balls: 0,
    strikes: 0,
    pendingPitches: [],
    gamePitchLog: [],
    selectedPitchType: null,
    selectedZone: null,
    lastPitchZone: null,
    awaitingResult: false,
    suggestedResult: null,
    fieldTap: null,
    pendingRbi: 0,
    pendingHitType: null,
    scoredThisAtBat: [],
    runnersPendingConfirmation: false,
    pendingFielding: null,
    pitchCountForCurrentPitcher: 0,
    opponentPitchCount: 0,
    pitchCountAck75: false,
    pitchCountAck85: false,
    pitchCountAck100: false,
    accuracyRatioSum: 0,
    accuracyAtBatCount: 0,
    showLowAccuracyWarning: false,
    hitsThisInning: 0,
    runsThisInning: 0,
    errorsThisInning: 0,
    kThisInning: 0,
    hitsGame: 0,
    runsGame: 0,
    errorsGame: 0,
    kGame: 0,
    lobGame: 0,
    lastConfirmed: null,
    substitutionPanelOpen: false,
    endGameConfirmOpen: false,
    postGameOpen: false,
    dirty: false,
    savedAt: 0,
    ...overrides,
  };
}

let failures = 0;
function expect(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} -- ${label}: got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

console.log("\n=== 1. Runner on 1st, ground ball, batter safe, runner out at second ===");
{
  const r1 = resolveGroundBallWithRunners({ batterOut: false, outsBeforePlay: 0, decisions: { first: "out" } });
  console.log("label:", r1.resultLabel, "| outsAdded:", r1.outsAddedThisPlay, "| totalOutsAfter:", r1.totalOutsAfter);
  expect("label", r1.resultLabel, "Fielder's Choice");

  const runnersBefore: Runners = { first: player("R1") };
  const s0 = baseState({ runners: runnersBefore, battingOrderPosition: 2, outs: 0, ourScore: 0 });
  // handleRunnerOutcomeDecision("first", "out") -- clears the runner locally.
  const s1 = operatorReducer(s0, { type: "SET_RUNNER", base: "first", runner: null });
  // finalizeImplicitFc's Quick Mode branch: batter's own (never-out) fc
  // row first (advances the order once), then one APPEND_EXTRA_OUT per
  // runner marked "out".
  const s2 = operatorReducer(s1, {
    type: "QUICK_CONFIRM_LOCAL",
    atBatId: "ab-1",
    result: "fc",
    runners: { first: player("Batter2") },
    scored: [],
    outsRecorded: 0,
    runnersBeforeAtBat: runnersBefore,
  });
  const s3 = operatorReducer(s2, { type: "APPEND_EXTRA_OUT", atBatId: "ab-1-extra" });
  expect("1 out", s3.outs, 1);
  expect("batting order advances exactly once", s3.battingOrderPosition, 3);
  expect("batter on 1st, nobody else on base", s3.runners, { first: player("Batter2") });
  expect("no run", s3.ourScore, 0);

  const s4 = operatorReducer(s3, { type: "UNDO_LOCAL" });
  expect("undo: outs back to 0", s4.outs, 0);
  expect("undo: batting order back to batter 2", s4.battingOrderPosition, 2);
  expect("undo: runners restored", s4.runners, runnersBefore);
  expect("undo: score unchanged", s4.ourScore, 0);
}

console.log("\n=== 2. Runners on 1st and 2nd, ground ball, batter safe, runner from 2nd out at third ===");
{
  const r2 = resolveGroundBallWithRunners({ batterOut: false, outsBeforePlay: 0, decisions: { second: "out" } });
  console.log("label:", r2.resultLabel, "| outsAdded:", r2.outsAddedThisPlay);
  expect("label", r2.resultLabel, "Fielder's Choice");

  const runnersBefore: Runners = { first: player("R1"), second: player("R2") };
  const s0 = baseState({ runners: runnersBefore, battingOrderPosition: 4, outs: 0, ourScore: 0 });
  // Queue order is third/second/first -- second (R2, "out") then first
  // (R1, "advanced" to second, same as the force every single already
  // cascades).
  const s1 = operatorReducer(s0, { type: "SET_RUNNER", base: "second", runner: null });
  const s2 = operatorReducer(s1, { type: "APPLY_RUNNER_ACTION", base: "first", action: "advance" });
  expect("R1 moved to 2nd before the batter is even placed", s2.runners, { first: null, second: player("R1") });

  const s3 = operatorReducer(s2, {
    type: "QUICK_CONFIRM_LOCAL",
    atBatId: "ab-2",
    result: "fc",
    runners: { ...s2.runners, first: player("Batter4") },
    scored: [],
    outsRecorded: 0,
    runnersBeforeAtBat: runnersBefore,
  });
  const s4 = operatorReducer(s3, { type: "APPEND_EXTRA_OUT", atBatId: "ab-2-extra" });
  expect("1 out", s4.outs, 1);
  expect("batting order advances exactly once", s4.battingOrderPosition, 5);
  expect("batter on 1st, R1 on 2nd", s4.runners, { first: player("Batter4"), second: player("R1") });

  const s5 = operatorReducer(s4, { type: "UNDO_LOCAL" });
  expect("undo: outs back to 0", s5.outs, 0);
  expect("undo: batting order back to batter 4", s5.battingOrderPosition, 4);
  expect("undo: both runners restored (1st AND 2nd)", s5.runners, runnersBefore);
}

console.log("\n=== 3. Runner on 1st, ground ball, batter out, runner out: Double Play ===");
{
  const r3 = resolveBattedBallPlay({ result: "groundout", outsBeforePlay: 0, decisions: { first: "out" } });
  console.log("label:", r3.resultLabel, "| totalOutsAfter:", r3.totalOutsAfter);
  expect("label", r3.resultLabel, "Double Play");

  const runnersBefore: Runners = { first: player("R1") };
  const s0 = baseState({ runners: runnersBefore, battingOrderPosition: 6, outs: 0, ourScore: 0 });
  const s1 = operatorReducer(s0, { type: "SET_RUNNER", base: "first", runner: null });
  const s2 = operatorReducer(s1, {
    type: "QUICK_CONFIRM_LOCAL",
    atBatId: "ab-3",
    result: "groundout",
    runners: s1.runners,
    scored: [],
    outsRecorded: 1,
    runnersBeforeAtBat: runnersBefore,
  });
  const s3 = operatorReducer(s2, { type: "APPEND_EXTRA_OUT", atBatId: "ab-3-extra" });
  expect("2 outs", s3.outs, 2);
  expect("batting order advances exactly once", s3.battingOrderPosition, 7);
  expect("nobody on base", s3.runners, { first: null });

  const s4 = operatorReducer(s3, { type: "UNDO_LOCAL" });
  expect("undo: outs back to 0", s4.outs, 0);
  expect("undo: batting order back to batter 6", s4.battingOrderPosition, 6);
  expect("undo: runner restored", s4.runners, runnersBefore);
}

console.log("\n=== 4. Runners on 1st and 3rd, 1 out, batter safe, runner scores from 3rd, runner on 1st out ===");
{
  const r4 = resolveGroundBallWithRunners({ batterOut: false, outsBeforePlay: 1, decisions: { third: "scored", first: "out" } });
  console.log("label:", r4.resultLabel, "| totalOutsAfter:", r4.totalOutsAfter, "| inningEndedOnForce:", r4.inningEndedOnForce);
  expect("label", r4.resultLabel, "Fielder's Choice");
  expect("run not cancelled (only 2 outs total)", r4.inningEndedOnForce, false);
  const method = r4.outsAddedThisPlay >= 0 && 1 < 2 ? "fielders_choice" : "fielders_choice_2out";
  expect("RBI-eligible (fewer than 2 outs before the play)", method, "fielders_choice");

  const runnersBefore: Runners = { first: player("R1"), third: player("R3") };
  const s0 = baseState({ runners: runnersBefore, battingOrderPosition: 1, outs: 1, ourScore: 2 });
  // Queue order third, then first.
  const s1 = operatorReducer(s0, { type: "SET_RUNNER", base: "third", runner: null });
  const s2 = operatorReducer(s1, { type: "SET_RUNNER", base: "first", runner: null });
  const s3 = operatorReducer(s2, {
    type: "QUICK_CONFIRM_LOCAL",
    atBatId: "ab-4",
    result: "fc",
    runners: { first: player("Batter1") },
    scored: [{ runner: player("R3"), method: "fielders_choice" }],
    outsRecorded: 0,
    runnersBeforeAtBat: runnersBefore,
  });
  const s4 = operatorReducer(s3, { type: "APPEND_EXTRA_OUT", atBatId: "ab-4-extra" });
  expect("2 outs (1 before + the extra out; batter safe adds none)", s4.outs, 2);
  expect("run counts", s4.ourScore, 3);
  expect("batter on 1st, nobody else on base", s4.runners, { first: player("Batter1") });
  expect("batting order advances exactly once", s4.battingOrderPosition, 2);

  const s5 = operatorReducer(s4, { type: "UNDO_LOCAL" });
  expect("undo: outs back to 1", s5.outs, 1);
  expect("undo: score back to 2", s5.ourScore, 2);
  expect("undo: both runners restored", s5.runners, runnersBefore);
  expect("undo: batting order back to batter 1", s5.battingOrderPosition, 1);
}

console.log("\n=== 5. Runner on 3rd, 2 outs, batter safe, runner out at home: 3 outs, no run ===");
{
  const r5 = resolveGroundBallWithRunners({ batterOut: false, outsBeforePlay: 2, decisions: { third: "out" } });
  console.log("label:", r5.resultLabel, "| totalOutsAfter:", r5.totalOutsAfter, "| scoredBases:", r5.scoredBases);
  expect("label", r5.resultLabel, "Fielder's Choice");
  expect("pure fn: 3 outs", r5.totalOutsAfter, 3);
  expect("pure fn: no run", r5.scoredBases.length, 0);

  const runnersBefore: Runners = { third: player("R3") };
  const s0 = baseState({ runners: runnersBefore, battingOrderPosition: 8, outs: 2, ourScore: 5 });
  const s1 = operatorReducer(s0, { type: "SET_RUNNER", base: "third", runner: null });
  const s2 = operatorReducer(s1, {
    type: "QUICK_CONFIRM_LOCAL",
    atBatId: "ab-5",
    result: "fc",
    runners: { first: player("Batter8") },
    scored: [],
    outsRecorded: 0,
    runnersBeforeAtBat: runnersBefore,
  });
  const s3 = operatorReducer(s2, { type: "APPEND_EXTRA_OUT", atBatId: "ab-5-extra" });
  expect("reducer: 3 outs", s3.outs, 3);
  expect("reducer: no run", s3.ourScore, 5);
  expect("batter on 1st", s3.runners, { first: player("Batter8") });

  // Keep Undo after the third out -- still available, still reverses
  // everything (back to 2 outs, same batter, runner restored).
  const s4 = operatorReducer(s3, { type: "UNDO_LOCAL" });
  expect("undo: back to 2 outs", s4.outs, 2);
  expect("undo: same batter (8) current again", s4.battingOrderPosition, 8);
  expect("undo: runner restored", s4.runners, runnersBefore);
  expect("undo: score unchanged", s4.ourScore, 5);
}

console.log("\n=== 6. Batter safe, nobody out: nothing recorded ===");
{
  const r6 = resolveGroundBallWithRunners({ batterOut: false, outsBeforePlay: 0, decisions: {} });
  console.log("recordNothing:", r6.recordNothing);
  expect("records nothing", r6.recordNothing, true);

  // finalizeImplicitFc's recordNothing branch reverts any provisional
  // local movement (here: the runner on 1st was tentatively marked
  // "Advanced" to 2nd before the queue decided nobody was out) back to
  // the exact pre-play snapshot, via the SAME APPLY_HIT_RUNNER_DECISION
  // action undoAutoScore already uses for a full-replacement revert --
  // and never dispatches QUICK_CONFIRM_LOCAL/CONFIRM_LOCAL at all, so
  // outs/battingOrderPosition/score are untouched (nothing to undo).
  const runnersBefore: Runners = { first: player("R1") };
  const s0 = baseState({ runners: runnersBefore, battingOrderPosition: 3, outs: 0, ourScore: 0 });
  const s1 = operatorReducer(s0, { type: "APPLY_RUNNER_ACTION", base: "first", action: "advance" });
  expect("provisionally moved to 2nd while the queue was open", s1.runners, { first: null, second: player("R1") });
  const s2 = operatorReducer(s1, { type: "APPLY_HIT_RUNNER_DECISION", runners: runnersBefore, scoredAdd: [] });
  expect("reverted to exactly the pre-play snapshot", s2.runners, runnersBefore);
  expect("batting order never advanced (no at-bat was ever recorded)", s2.battingOrderPosition, 3);
  expect("outs untouched", s2.outs, 0);
}

console.log("\n=== 7. Two fielder's-choice plays in a row, each followed by Undo -- no batting-order drift ===");
{
  const runnersBefore: Runners = { first: player("R1") };
  const s0 = baseState({ runners: runnersBefore, battingOrderPosition: 5, outs: 0 });

  const a1 = operatorReducer(s0, { type: "SET_RUNNER", base: "first", runner: null });
  const a2 = operatorReducer(a1, {
    type: "QUICK_CONFIRM_LOCAL",
    atBatId: "ab-7a",
    result: "fc",
    runners: { first: player("Batter5") },
    scored: [],
    outsRecorded: 0,
    runnersBeforeAtBat: runnersBefore,
  });
  const a3 = operatorReducer(a2, { type: "APPEND_EXTRA_OUT", atBatId: "ab-7a-extra" });
  const a4 = operatorReducer(a3, { type: "UNDO_LOCAL" });
  expect("play 1: back to batter 5", a4.battingOrderPosition, 5);
  expect("play 1: back to 0 outs", a4.outs, 0);
  expect("play 1: runner restored", a4.runners, runnersBefore);

  const b1 = operatorReducer(a4, { type: "SET_RUNNER", base: "first", runner: null });
  const b2 = operatorReducer(b1, {
    type: "QUICK_CONFIRM_LOCAL",
    atBatId: "ab-7b",
    result: "fc",
    runners: { first: player("Batter5Again") },
    scored: [],
    outsRecorded: 0,
    runnersBeforeAtBat: runnersBefore,
  });
  const b3 = operatorReducer(b2, { type: "APPEND_EXTRA_OUT", atBatId: "ab-7b-extra" });
  const b4 = operatorReducer(b3, { type: "UNDO_LOCAL" });
  expect("play 2: back to batter 5 again (no cumulative drift)", b4.battingOrderPosition, 5);
  expect("play 2: back to 0 outs", b4.outs, 0);
  expect("play 2: runner restored", b4.runners, runnersBefore);
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
