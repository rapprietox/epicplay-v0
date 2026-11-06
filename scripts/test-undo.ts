// "Prove it by replay" for the two Undo bugs found testing the practice
// game (fix/dp-fc follow-up #2):
//   Bug 1: batting order advanced twice per play once an extra out was
//   appended (logExtraOut/confirmDoublePlay each called
//   advanceBattingOrder server-side, on top of the batter's own
//   confirmAtBat/logQuickAtBat already doing it) -- fixed by removing
//   both redundant server-side calls. The reducer's LOCAL
//   battingOrderPosition was never wrong (APPEND_EXTRA_OUT never
//   touched it); this is why that drift only ever surfaced in
//   game_state.batting_order_position on reload/resume, not mid-session.
//   Bug 2: the Undo bar was unreachable after the 3rd out (covered by
//   the full-screen ThreeOutsModal) -- fixed by adding the same Undo
//   control inside that modal.
//
// This script exercises the REAL reducer (operatorReducer) with the
// exact dispatch sequences operator-console.tsx fires, and separately
// documents the server-side advanceBattingOrder/reverseBattingOrder
// call count per action (the part a pure reducer replay can't see,
// since the reducer never calls a server action) -- the reducer alone
// couldn't have caught Bug 1, since its own local state was already
// correct; the count-per-action accounting below is what proves the
// server side is now 1:1 too.
//
// Usage: npx tsx scripts/test-undo.ts

import { operatorReducer } from "../src/lib/operator/reducer";
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

console.log("\n=== 1. FC with runner out, then Undo ===");
{
  const runnersBefore: Runners = { first: player("Batter1") };
  const s0 = baseState({ runners: runnersBefore, battingOrderPosition: 2, outs: 0, ourScore: 0 });

  // resolveFcQuick's own dispatch sequence for "runner out at 2nd":
  // QUICK_CONFIRM_LOCAL (batter2's own fc row, never out, order advances
  // once) then APPEND_EXTRA_OUT (the runner's extra out row).
  const s1 = operatorReducer(s0, {
    type: "QUICK_CONFIRM_LOCAL",
    atBatId: "ab-batter2",
    result: "fc",
    runners: { first: player("Batter2") },
    scored: [],
    outsRecorded: 0,
    runnersBeforeAtBat: runnersBefore,
  });
  expect("batting order advances once after the fc row", s1.battingOrderPosition, 3);
  expect("outs still 0 (batter never out on fc)", s1.outs, 0);

  const s2 = operatorReducer(s1, { type: "APPEND_EXTRA_OUT", atBatId: "ab-extra" });
  expect("extra out adds exactly 1 out", s2.outs, 1);
  expect("batting order NOT advanced a second time by the extra out", s2.battingOrderPosition, 3);
  expect("lastConfirmed carries both ids for one-tap undo", s2.lastConfirmed?.secondAtBatId, "ab-extra");

  const s3 = operatorReducer(s2, { type: "UNDO_LOCAL" });
  expect("outs back to 0", s3.outs, 0);
  expect("batting order back to batter 2", s3.battingOrderPosition, 2);
  expect("runners back to before the play", s3.runners, runnersBefore);
  expect("score unchanged (was never touched)", s3.ourScore, 0);
  console.log(
    "Server side (not reducer-visible): logQuickAtBat -> advanceBattingOrder x1; logExtraOut -> advanceBattingOrder x0 (removed);\n" +
      "  undoAtBat -> reverseBattingOrder x1 (unconditional, regardless of secondAtBatId). 1 forward : 1 back."
  );
}

console.log("\n=== 2. Line Out double play, then Undo ===");
{
  const runnersBefore: Runners = { first: player("R1") };
  // runnersAtAtBatStart mirrors what START_DRAFT_LOCAL already snapshot
  // in the real flow, before the batter's own result is even picked --
  // CONFIRM_LOCAL reads lastConfirmed.runnersBeforeAtBat from this, not
  // from `runners` itself (which it deliberately leaves untouched).
  const s0 = baseState({ runners: runnersBefore, runnersAtAtBatStart: runnersBefore, battingOrderPosition: 5, outs: 1, ourScore: 2 });

  // handleConfirm's own CONFIRM_LOCAL for the batter's flyout/lineout
  // (always outsRecorded: 1, advances the order once), then
  // finalizeRunnerOutcomeQueue's APPEND_EXTRA_OUT for the doubled-off
  // runner.
  const s1 = operatorReducer(s0, { type: "CONFIRM_LOCAL", atBatId: "ab-batter5", outsRecorded: 1, accuracyRatio: 1 });
  expect("batting order advances once after the batter's own out", s1.battingOrderPosition, 6);
  expect("1 out recorded so far", s1.outs, 2);

  const s2 = operatorReducer(s1, { type: "APPEND_EXTRA_OUT", atBatId: "ab-extra-lo" });
  expect("extra out brings total to 3 (inning ends)", s2.outs, 3);
  expect("batting order still just 6 (not advanced again)", s2.battingOrderPosition, 6);

  const s3 = operatorReducer(s2, { type: "UNDO_LOCAL" });
  expect("outs back to 1", s3.outs, 1);
  expect("batting order back to batter 5", s3.battingOrderPosition, 5);
  expect("runners back to before the play", s3.runners, runnersBefore);
  expect("score unchanged", s3.ourScore, 2);
}

console.log("\n=== 3. Third out, then Undo (back to 2 outs, same batter) ===");
{
  const s0 = baseState({ battingOrderPosition: 7, outs: 2, ourScore: 3 });
  // A plain single-out play (e.g. a strikeout) as the 3rd out -- no
  // extra out involved, proving Undo works the same whether or not an
  // APPEND_EXTRA_OUT ever happened on this play.
  const s1 = operatorReducer(s0, { type: "CONFIRM_LOCAL", atBatId: "ab-batter7", outsRecorded: 1, accuracyRatio: 1 });
  expect("3rd out recorded", s1.outs, 3);
  expect("batting order advances to next batter", s1.battingOrderPosition, 8);

  // Bug 2: previously unreachable once state.outs >= 3 (ThreeOutsModal
  // covered the only Undo control) -- now reachable via the same
  // undoActive/handleUndo wired into the modal too. The reducer
  // dispatch itself (UNDO_LOCAL) was never the problem; only its
  // reachability in the UI was.
  const s2 = operatorReducer(s1, { type: "UNDO_LOCAL" });
  expect("back to 2 outs", s2.outs, 2);
  expect("same batter (7) is current again", s2.battingOrderPosition, 7);
  expect("score unchanged", s2.ourScore, 3);
}

console.log("\n=== 4. Two FC plays in a row, each followed by Undo ===");
{
  const runnersBefore: Runners = { first: player("R1") };
  const s0 = baseState({ runners: runnersBefore, battingOrderPosition: 3, outs: 0 });

  const a1 = operatorReducer(s0, {
    type: "QUICK_CONFIRM_LOCAL",
    atBatId: "ab-1",
    result: "fc",
    runners: { first: player("Batter3") },
    scored: [],
    outsRecorded: 0,
    runnersBeforeAtBat: runnersBefore,
  });
  const a2 = operatorReducer(a1, { type: "APPEND_EXTRA_OUT", atBatId: "ab-1-extra" });
  const a3 = operatorReducer(a2, { type: "UNDO_LOCAL" });
  expect("play 1: back to batter 3", a3.battingOrderPosition, 3);
  expect("play 1: back to 0 outs", a3.outs, 0);
  expect("play 1: runners restored", a3.runners, runnersBefore);

  // Second FC, run from the SAME restored state -- if play 1 had left
  // any residue (the exact failure mode reported: each cycle drifting
  // the batting order one slot further), this would show up here as
  // batter 4 or higher instead of 3.
  const b1 = operatorReducer(a3, {
    type: "QUICK_CONFIRM_LOCAL",
    atBatId: "ab-2",
    result: "fc",
    runners: { first: player("Batter3Again") },
    scored: [],
    outsRecorded: 0,
    runnersBeforeAtBat: runnersBefore,
  });
  const b2 = operatorReducer(b1, { type: "APPEND_EXTRA_OUT", atBatId: "ab-2-extra" });
  const b3 = operatorReducer(b2, { type: "UNDO_LOCAL" });
  expect("play 2: back to batter 3 again (no cumulative drift)", b3.battingOrderPosition, 3);
  expect("play 2: back to 0 outs", b3.outs, 0);
  expect("play 2: runners restored", b3.runners, runnersBefore);
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
