import type {
  AtBatMode,
  AtBatResult,
  FieldingPosition,
  HitType,
  InningHalf,
  PitchOutcome,
  PitchType,
  RunnerState,
  Runners,
} from "@/lib/supabase/types";
import { RUNNING_ACCURACY_WARNING_THRESHOLD, runningAccuracy } from "@/lib/pitch-accuracy";
import { advanceOneRunner } from "./runner-advance";
import { SCORE_METHOD_AWARDS_RBI, type Base, type OperatorState, type RunnerQuickAction, type ScoreMethod, type ScoredRunner } from "./types";

export const UNDO_WINDOW_MS = 30_000;

const HIT_RESULTS = new Set<AtBatResult>(["single", "double", "triple", "hr"]);

function scoredRbiCount(scored: ScoredRunner[]): number {
  return scored.filter((s) => SCORE_METHOD_AWARDS_RBI[s.method]).length;
}

export function initialOperatorState(gameId: string): OperatorState {
  return {
    gameId,
    mode: "hitting",
    inning: 1,
    inningHalf: "top",
    outs: 0,
    ourScore: 0,
    opponentScore: 0,
    battingOrderPosition: 1,
    currentPitcherId: null,
    opponentBatterName: "",
    runners: {},
    runnersAtAtBatStart: null,
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
  };
}

export type OperatorAction =
  | { type: "HYDRATE"; state: OperatorState }
  | { type: "SET_MODE"; mode: AtBatMode }
  | { type: "SELECT_PITCH_TYPE"; pitchType: PitchType | null }
  | { type: "TAP_ZONE"; x: number; y: number }
  | { type: "CLEAR_ZONE_SELECTION" }
  | { type: "START_DRAFT_LOCAL"; atBatId: string }
  | { type: "LOG_PITCH_LOCAL"; outcome: PitchOutcome; swing: boolean }
  | { type: "SET_RESULT"; result: AtBatResult; suggestion: Runners; scored: ScoredRunner[]; hasMovement: boolean }
  | { type: "SET_HIT_TYPE"; hitType: HitType | null }
  | { type: "SET_FIELD_TAP"; x: number; y: number }
  | { type: "SET_FIELDING"; position: FieldingPosition; playerId: string | null; opponentPlayerId: string | null }
  | { type: "SET_RBI"; value: number }
  | { type: "CONFIRM_RUNNERS_SUGGESTION" }
  | { type: "APPLY_RUNNER_ACTION"; base: Base; action: RunnerQuickAction; scoreMethod?: ScoreMethod }
  | { type: "CONFIRM_LOCAL"; atBatId: string; outsRecorded: number; accuracyRatio: number }
  | { type: "CONFIRM_DOUBLE_PLAY"; atBatId: string; secondAtBatId: string; removedBase: Base; accuracyRatio: number }
  | { type: "CONFIRM_INTENTIONAL_WALK"; atBatId: string; runners: Runners; runsScored: number; runnersBeforeAtBat: Runners }
  | { type: "UNDO_LOCAL" }
  | { type: "CLEAR_LAST_CONFIRMED" }
  | { type: "SET_RUNNER"; base: Base; runner: RunnerState | null }
  | { type: "ADVANCE_ALL_RUNNERS_LOCAL"; result: { runners: Runners; scored: RunnerState[] } }
  | { type: "SET_PITCHER"; playerId: string | null }
  | { type: "SET_OPPONENT_BATTER_NAME"; name: string }
  | { type: "ACK_PITCH_COUNT"; level: 75 | 85 | 100 }
  | { type: "END_INNING_LOCAL" }
  | { type: "SET_SCORE"; ourScore: number; opponentScore: number }
  | { type: "SET_PANEL"; panel: "substitution" | "endGame" | "postGame"; open: boolean }
  | { type: "MARK_SAVED" };

export function advanceAllRunnersOneBase(runners: Runners): { runners: Runners; scored: RunnerState[] } {
  const scored: RunnerState[] = [];
  if (runners.third) scored.push(runners.third);
  return {
    runners: { third: runners.second ?? null, second: runners.first ?? null, first: null },
    scored,
  };
}

export function operatorReducer(state: OperatorState, action: OperatorAction): OperatorState {
  switch (action.type) {
    case "HYDRATE":
      return { ...action.state, dirty: false };

    case "SET_MODE":
      return { ...state, mode: action.mode, dirty: true };

    case "SELECT_PITCH_TYPE":
      return { ...state, selectedPitchType: action.pitchType, dirty: true };

    case "TAP_ZONE":
      return { ...state, selectedZone: { x: action.x, y: action.y }, dirty: true };

    case "CLEAR_ZONE_SELECTION":
      return { ...state, selectedZone: null };

    case "START_DRAFT_LOCAL":
      return { ...state, currentAtBatId: action.atBatId, runnersAtAtBatStart: state.runners, dirty: true };

    case "LOG_PITCH_LOCAL": {
      const pitch = {
        pitch_number: state.pendingPitches.length + 1,
        pitch_type: state.selectedPitchType,
        zone_x: state.selectedZone?.x ?? null,
        zone_y: state.selectedZone?.y ?? null,
        outcome: action.outcome,
        swing: action.swing,
      };
      let balls = state.balls;
      let strikes = state.strikes;
      let awaitingResult = false;
      let suggestedResult: AtBatResult | null = null;

      if (action.outcome === "ball") {
        balls = Math.min(4, balls + 1);
        if (balls >= 4) {
          awaitingResult = true;
          suggestedResult = "walk";
        }
      } else if (action.outcome === "strike") {
        strikes = Math.min(3, strikes + 1);
        if (strikes >= 3) {
          awaitingResult = true;
          suggestedResult = "strikeout";
        }
      } else if (action.outcome === "foul") {
        if (strikes < 2) strikes += 1;
      } else if (action.outcome === "hbp") {
        awaitingResult = true;
        suggestedResult = "hbp" as AtBatResult;
      } else if (action.outcome === "inplay") {
        awaitingResult = true;
      }

      return {
        ...state,
        balls,
        strikes,
        pendingPitches: [...state.pendingPitches, pitch],
        gamePitchLog: [...state.gamePitchLog, pitch],
        lastPitchZone: pitch.zone_x !== null && pitch.zone_y !== null ? { x: pitch.zone_x, y: pitch.zone_y, outcome: action.outcome } : state.lastPitchZone,
        selectedZone: null,
        awaitingResult,
        // Only set here for display purposes (e.g. highlighting the
        // suggested result button); the runner suggestion itself is
        // computed by the caller (needs roster/opponent-name context the
        // reducer doesn't have) and applied via a follow-up SET_RESULT.
        suggestedResult,
        pitchCountForCurrentPitcher:
          state.mode === "pitching" ? state.pitchCountForCurrentPitcher + 1 : state.pitchCountForCurrentPitcher,
        dirty: true,
      };
    }

    case "SET_RESULT": {
      return {
        ...state,
        suggestedResult: action.result,
        runners: action.suggestion,
        scoredThisAtBat: action.scored,
        pendingRbi: scoredRbiCount(action.scored),
        runnersPendingConfirmation: action.hasMovement,
        dirty: true,
      };
    }

    case "SET_HIT_TYPE":
      return { ...state, pendingHitType: action.hitType, dirty: true };

    case "SET_FIELD_TAP":
      return { ...state, fieldTap: { x: action.x, y: action.y }, dirty: true };

    case "SET_FIELDING":
      return {
        ...state,
        pendingFielding: { position: action.position, playerId: action.playerId, opponentPlayerId: action.opponentPlayerId },
        dirty: true,
      };

    case "SET_RBI":
      return { ...state, pendingRbi: Math.max(0, Math.min(4, action.value)), dirty: true };

    case "CONFIRM_RUNNERS_SUGGESTION":
      return { ...state, runnersPendingConfirmation: false, dirty: true };

    case "APPLY_RUNNER_ACTION": {
      const runner = state.runners[action.base];
      if (!runner) return state;

      if (action.action === "scored") {
        const method = action.scoreMethod ?? "hit";
        const entry: ScoredRunner = { runner, method };
        const nextScored = [...state.scoredThisAtBat, entry];
        return {
          ...state,
          runners: { ...state.runners, [action.base]: null },
          scoredThisAtBat: nextScored,
          pendingRbi: scoredRbiCount(nextScored),
          runnersPendingConfirmation: false,
          dirty: true,
        };
      }
      if (action.action === "out" || action.action === "picked_off") {
        return {
          ...state,
          runners: { ...state.runners, [action.base]: null },
          outs: Math.min(3, state.outs + 1),
          runnersPendingConfirmation: false,
          dirty: true,
        };
      }
      // advance / stolen_base / error_advance all move the runner one base
      const advanced = advanceOneRunner(state.runners, action.base);
      const newlyScored: ScoredRunner[] = advanced.scored.map((r) => ({ runner: r, method: "hit" as ScoreMethod }));
      const nextScored = newlyScored.length > 0 ? [...state.scoredThisAtBat, ...newlyScored] : state.scoredThisAtBat;
      return {
        ...state,
        runners: advanced.runners,
        scoredThisAtBat: nextScored,
        pendingRbi: scoredRbiCount(nextScored),
        runnersPendingConfirmation: false,
        dirty: true,
      };
    }

    case "CONFIRM_LOCAL": {
      const runsScored = state.scoredThisAtBat.length;
      const result = state.suggestedResult;
      const nextBattingOrder =
        state.mode === "hitting" ? (state.battingOrderPosition % 9) + 1 : state.battingOrderPosition;
      const nextAccuracySum = state.accuracyRatioSum + action.accuracyRatio;
      const nextAccuracyCount = state.accuracyAtBatCount + 1;

      const isHit = result !== null && HIT_RESULTS.has(result);
      const isError = result === "error";
      const isStrikeout = result === "strikeout";
      const hitsDelta = state.mode === "hitting" && isHit ? 1 : 0;
      const errorsDelta = state.mode === "pitching" && isError ? 1 : 0;
      const kDelta = state.mode === "pitching" && isStrikeout ? 1 : 0;
      const runsDelta = state.mode === "hitting" ? runsScored : 0;

      const prevBoxScore = {
        hitsThisInning: state.hitsThisInning,
        runsThisInning: state.runsThisInning,
        errorsThisInning: state.errorsThisInning,
        kThisInning: state.kThisInning,
        hitsGame: state.hitsGame,
        runsGame: state.runsGame,
        errorsGame: state.errorsGame,
        kGame: state.kGame,
      };

      return {
        ...state,
        outs: Math.min(3, state.outs + action.outsRecorded),
        ourScore: state.mode === "hitting" ? state.ourScore + runsScored : state.ourScore,
        opponentScore: state.mode === "pitching" ? state.opponentScore + runsScored : state.opponentScore,
        battingOrderPosition: nextBattingOrder,
        currentAtBatId: null,
        runnersAtAtBatStart: null,
        balls: 0,
        strikes: 0,
        pendingPitches: [],
        selectedPitchType: null,
        selectedZone: null,
        awaitingResult: false,
        suggestedResult: null,
        fieldTap: null,
        pendingFielding: null,
        pendingRbi: 0,
        pendingHitType: null,
        scoredThisAtBat: [],
        runnersPendingConfirmation: false,
        accuracyRatioSum: nextAccuracySum,
        accuracyAtBatCount: nextAccuracyCount,
        showLowAccuracyWarning: runningAccuracy(nextAccuracySum, nextAccuracyCount) < RUNNING_ACCURACY_WARNING_THRESHOLD,
        hitsThisInning: state.hitsThisInning + hitsDelta,
        runsThisInning: state.runsThisInning + runsDelta,
        errorsThisInning: state.errorsThisInning + errorsDelta,
        kThisInning: state.kThisInning + kDelta,
        hitsGame: state.hitsGame + hitsDelta,
        runsGame: state.runsGame + runsDelta,
        errorsGame: state.errorsGame + errorsDelta,
        kGame: state.kGame + kDelta,
        lastConfirmed: {
          atBatId: action.atBatId,
          secondAtBatId: null,
          mode: state.mode,
          runsScored,
          outsRecorded: action.outsRecorded,
          runnersBeforeAtBat: state.runnersAtAtBatStart ?? {},
          prevAccuracyRatioSum: state.accuracyRatioSum,
          prevAccuracyAtBatCount: state.accuracyAtBatCount,
          prevBoxScore,
          deadline: Date.now() + UNDO_WINDOW_MS,
        },
        dirty: true,
      };
    }

    case "CONFIRM_DOUBLE_PLAY": {
      const nextBattingOrder =
        state.mode === "hitting" ? (state.battingOrderPosition % 9) + 1 : state.battingOrderPosition;
      const nextAccuracySum = state.accuracyRatioSum + action.accuracyRatio;
      const nextAccuracyCount = state.accuracyAtBatCount + 1;
      const prevBoxScore = {
        hitsThisInning: state.hitsThisInning,
        runsThisInning: state.runsThisInning,
        errorsThisInning: state.errorsThisInning,
        kThisInning: state.kThisInning,
        hitsGame: state.hitsGame,
        runsGame: state.runsGame,
        errorsGame: state.errorsGame,
        kGame: state.kGame,
      };
      return {
        ...state,
        outs: Math.min(3, state.outs + 2),
        runners: { ...state.runners, [action.removedBase]: null },
        battingOrderPosition: nextBattingOrder,
        currentAtBatId: null,
        runnersAtAtBatStart: null,
        balls: 0,
        strikes: 0,
        pendingPitches: [],
        selectedPitchType: null,
        selectedZone: null,
        awaitingResult: false,
        suggestedResult: null,
        fieldTap: null,
        pendingFielding: null,
        pendingRbi: 0,
        pendingHitType: null,
        scoredThisAtBat: [],
        runnersPendingConfirmation: false,
        accuracyRatioSum: nextAccuracySum,
        accuracyAtBatCount: nextAccuracyCount,
        showLowAccuracyWarning: runningAccuracy(nextAccuracySum, nextAccuracyCount) < RUNNING_ACCURACY_WARNING_THRESHOLD,
        lastConfirmed: {
          atBatId: action.atBatId,
          secondAtBatId: action.secondAtBatId,
          mode: state.mode,
          runsScored: 0,
          outsRecorded: 2,
          runnersBeforeAtBat: state.runnersAtAtBatStart ?? {},
          prevAccuracyRatioSum: state.accuracyRatioSum,
          prevAccuracyAtBatCount: state.accuracyAtBatCount,
          prevBoxScore,
          deadline: Date.now() + UNDO_WINDOW_MS,
        },
        dirty: true,
      };
    }

    case "CONFIRM_INTENTIONAL_WALK": {
      // Bypasses pitch logging entirely (per spec), so unlike CONFIRM_LOCAL
      // this never touches accuracyRatioSum/accuracyAtBatCount -- 0 pitches
      // here is correct by design, not a logging lapse, and folding it into
      // the running accuracy average would unfairly ding the operator for
      // something they were never supposed to log pitch-by-pitch.
      const nextBattingOrder =
        state.mode === "hitting" ? (state.battingOrderPosition % 9) + 1 : state.battingOrderPosition;
      const runsDelta = state.mode === "hitting" ? action.runsScored : 0;
      const prevBoxScore = {
        hitsThisInning: state.hitsThisInning,
        runsThisInning: state.runsThisInning,
        errorsThisInning: state.errorsThisInning,
        kThisInning: state.kThisInning,
        hitsGame: state.hitsGame,
        runsGame: state.runsGame,
        errorsGame: state.errorsGame,
        kGame: state.kGame,
      };
      return {
        ...state,
        runners: action.runners,
        ourScore: state.mode === "hitting" ? state.ourScore + action.runsScored : state.ourScore,
        opponentScore: state.mode === "pitching" ? state.opponentScore + action.runsScored : state.opponentScore,
        battingOrderPosition: nextBattingOrder,
        pitchCountForCurrentPitcher:
          state.mode === "pitching" ? state.pitchCountForCurrentPitcher + 4 : state.pitchCountForCurrentPitcher,
        runsThisInning: state.runsThisInning + runsDelta,
        runsGame: state.runsGame + runsDelta,
        runnersPendingConfirmation: false,
        lastConfirmed: {
          atBatId: action.atBatId,
          secondAtBatId: null,
          mode: state.mode,
          runsScored: action.runsScored,
          outsRecorded: 0,
          runnersBeforeAtBat: action.runnersBeforeAtBat,
          prevAccuracyRatioSum: state.accuracyRatioSum,
          prevAccuracyAtBatCount: state.accuracyAtBatCount,
          prevBoxScore,
          deadline: Date.now() + UNDO_WINDOW_MS,
        },
        dirty: true,
      };
    }

    case "UNDO_LOCAL": {
      if (!state.lastConfirmed) return state;
      const prevBattingOrder =
        state.lastConfirmed.mode === "hitting"
          ? ((state.battingOrderPosition - 2 + 9) % 9) + 1
          : state.battingOrderPosition;
      return {
        ...state,
        battingOrderPosition: prevBattingOrder,
        outs: Math.max(0, state.outs - state.lastConfirmed.outsRecorded),
        runners: state.lastConfirmed.runnersBeforeAtBat,
        ourScore: state.lastConfirmed.mode === "hitting" ? Math.max(0, state.ourScore - state.lastConfirmed.runsScored) : state.ourScore,
        opponentScore:
          state.lastConfirmed.mode === "pitching" ? Math.max(0, state.opponentScore - state.lastConfirmed.runsScored) : state.opponentScore,
        accuracyRatioSum: state.lastConfirmed.prevAccuracyRatioSum,
        accuracyAtBatCount: state.lastConfirmed.prevAccuracyAtBatCount,
        showLowAccuracyWarning:
          runningAccuracy(state.lastConfirmed.prevAccuracyRatioSum, state.lastConfirmed.prevAccuracyAtBatCount) < RUNNING_ACCURACY_WARNING_THRESHOLD,
        ...state.lastConfirmed.prevBoxScore,
        lastConfirmed: null,
        dirty: true,
      };
    }

    case "CLEAR_LAST_CONFIRMED":
      return { ...state, lastConfirmed: null, dirty: true };

    case "SET_RUNNER":
      return { ...state, runners: { ...state.runners, [action.base]: action.runner }, dirty: true };

    case "ADVANCE_ALL_RUNNERS_LOCAL":
      return { ...state, runners: action.result.runners, dirty: true };

    case "SET_PITCHER":
      return { ...state, currentPitcherId: action.playerId, pitchCountForCurrentPitcher: 0, pitchCountAck75: false, pitchCountAck85: false, pitchCountAck100: false, dirty: true };

    case "SET_OPPONENT_BATTER_NAME":
      return { ...state, opponentBatterName: action.name, dirty: true };

    case "ACK_PITCH_COUNT":
      return {
        ...state,
        pitchCountAck75: action.level === 75 ? true : state.pitchCountAck75,
        pitchCountAck85: action.level === 85 ? true : state.pitchCountAck85,
        pitchCountAck100: action.level === 100 ? true : state.pitchCountAck100,
        dirty: true,
      };

    case "END_INNING_LOCAL": {
      const nextHalf: InningHalf = state.inningHalf === "top" ? "bottom" : "top";
      const nextInning = state.inningHalf === "bottom" ? state.inning + 1 : state.inning;
      const occupiedBases = [state.runners.first, state.runners.second, state.runners.third].filter(Boolean).length;
      return {
        ...state,
        inning: nextInning,
        inningHalf: nextHalf,
        outs: 0,
        runners: {},
        runnersAtAtBatStart: null,
        currentAtBatId: null,
        balls: 0,
        strikes: 0,
        pendingPitches: [],
        awaitingResult: false,
        suggestedResult: null,
        scoredThisAtBat: [],
        runnersPendingConfirmation: false,
        hitsThisInning: 0,
        runsThisInning: 0,
        errorsThisInning: 0,
        kThisInning: 0,
        lobGame: state.mode === "hitting" ? state.lobGame + occupiedBases : state.lobGame,
        dirty: true,
      };
    }

    case "SET_SCORE":
      return { ...state, ourScore: action.ourScore, opponentScore: action.opponentScore, dirty: true };

    case "SET_PANEL": {
      const key = action.panel === "substitution" ? "substitutionPanelOpen" : action.panel === "endGame" ? "endGameConfirmOpen" : "postGameOpen";
      return { ...state, [key]: action.open } as OperatorState;
    }

    case "MARK_SAVED":
      return { ...state, dirty: false, savedAt: Date.now() };

    default:
      return state;
  }
}

