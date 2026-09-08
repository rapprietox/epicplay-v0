import type { AtBatMode, AtBatResult, HitType, InningHalf, PitchOutcome, PitchType, RunnerState, Runners } from "@/lib/supabase/types";
import { LOW_ACCURACY_STREAK_WARNING } from "@/lib/pitch-accuracy";
import { advanceOneRunner } from "./runner-advance";
import type { Base, OperatorState, RunnerQuickAction } from "./types";

export const UNDO_WINDOW_MS = 30_000;

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
    pitchCountForCurrentPitcher: 0,
    pitchCountAck75: false,
    pitchCountAck85: false,
    pitchCountAck100: false,
    consecutiveLowAccuracyAtBats: 0,
    showLowAccuracyWarning: false,
    lastConfirmed: null,
    substitutionPanelOpen: false,
    endInningConfirmOpen: false,
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
  | { type: "START_DRAFT_LOCAL"; atBatId: string }
  | { type: "LOG_PITCH_LOCAL"; outcome: PitchOutcome }
  | { type: "SET_RESULT"; result: AtBatResult; suggestion: Runners; scored: RunnerState[]; hasMovement: boolean }
  | { type: "SET_HIT_TYPE"; hitType: HitType | null }
  | { type: "SET_FIELD_TAP"; x: number; y: number }
  | { type: "SET_RBI"; value: number }
  | { type: "CONFIRM_RUNNERS_SUGGESTION" }
  | { type: "APPLY_RUNNER_ACTION"; base: Base; action: RunnerQuickAction }
  | { type: "CONFIRM_LOCAL"; atBatId: string; isOut: boolean; wasLowAccuracy: boolean }
  | { type: "UNDO_LOCAL" }
  | { type: "CLEAR_LAST_CONFIRMED" }
  | { type: "SET_RUNNER"; base: Base; runner: RunnerState | null }
  | { type: "ADVANCE_ALL_RUNNERS_LOCAL"; result: { runners: Runners; scored: RunnerState[] } }
  | { type: "SET_PITCHER"; playerId: string | null }
  | { type: "SET_OPPONENT_BATTER_NAME"; name: string }
  | { type: "ACK_PITCH_COUNT"; level: 75 | 85 | 100 }
  | { type: "END_INNING_LOCAL" }
  | { type: "SET_SCORE"; ourScore: number; opponentScore: number }
  | { type: "SET_PANEL"; panel: "substitution" | "endInning" | "endGame" | "postGame"; open: boolean }
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

    case "START_DRAFT_LOCAL":
      return { ...state, currentAtBatId: action.atBatId, runnersAtAtBatStart: state.runners, dirty: true };

    case "LOG_PITCH_LOCAL": {
      const pitch = {
        pitch_number: state.pendingPitches.length + 1,
        pitch_type: state.selectedPitchType,
        zone_x: state.selectedZone?.x ?? null,
        zone_y: state.selectedZone?.y ?? null,
        outcome: action.outcome,
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
      const rbi = action.result === "error" ? 0 : Math.min(4, action.scored.length);
      return {
        ...state,
        suggestedResult: action.result,
        runners: action.suggestion,
        scoredThisAtBat: action.scored,
        pendingRbi: rbi,
        runnersPendingConfirmation: action.hasMovement,
        dirty: true,
      };
    }

    case "SET_HIT_TYPE":
      return { ...state, pendingHitType: action.hitType, dirty: true };

    case "SET_FIELD_TAP":
      return { ...state, fieldTap: { x: action.x, y: action.y }, dirty: true };

    case "SET_RBI":
      return { ...state, pendingRbi: Math.max(0, Math.min(4, action.value)), dirty: true };

    case "CONFIRM_RUNNERS_SUGGESTION":
      return { ...state, runnersPendingConfirmation: false, dirty: true };

    case "APPLY_RUNNER_ACTION": {
      const runner = state.runners[action.base];
      if (!runner) return state;

      if (action.action === "scored") {
        return {
          ...state,
          runners: { ...state.runners, [action.base]: null },
          scoredThisAtBat: [...state.scoredThisAtBat, runner],
          pendingRbi: state.suggestedResult === "error" ? state.pendingRbi : Math.min(4, state.pendingRbi + 1),
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
      return {
        ...state,
        runners: advanced.runners,
        scoredThisAtBat: advanced.scored.length > 0 ? [...state.scoredThisAtBat, ...advanced.scored] : state.scoredThisAtBat,
        runnersPendingConfirmation: false,
        dirty: true,
      };
    }

    case "CONFIRM_LOCAL": {
      const runsScored = state.scoredThisAtBat.length;
      const nextBattingOrder =
        state.mode === "hitting" ? (state.battingOrderPosition % 9) + 1 : state.battingOrderPosition;
      const nextStreak = action.wasLowAccuracy ? state.consecutiveLowAccuracyAtBats + 1 : 0;
      return {
        ...state,
        outs: action.isOut ? Math.min(3, state.outs + 1) : state.outs,
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
        pendingRbi: 0,
        pendingHitType: null,
        scoredThisAtBat: [],
        runnersPendingConfirmation: false,
        consecutiveLowAccuracyAtBats: nextStreak,
        showLowAccuracyWarning: nextStreak >= LOW_ACCURACY_STREAK_WARNING,
        lastConfirmed: {
          atBatId: action.atBatId,
          mode: state.mode,
          runsScored,
          wasOut: action.isOut,
          runnersBeforeAtBat: state.runnersAtAtBatStart ?? {},
          prevConsecutiveLowAccuracyAtBats: state.consecutiveLowAccuracyAtBats,
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
        outs: state.lastConfirmed.wasOut ? Math.max(0, state.outs - 1) : state.outs,
        runners: state.lastConfirmed.runnersBeforeAtBat,
        ourScore: state.lastConfirmed.mode === "hitting" ? Math.max(0, state.ourScore - state.lastConfirmed.runsScored) : state.ourScore,
        opponentScore:
          state.lastConfirmed.mode === "pitching" ? Math.max(0, state.opponentScore - state.lastConfirmed.runsScored) : state.opponentScore,
        consecutiveLowAccuracyAtBats: state.lastConfirmed.prevConsecutiveLowAccuracyAtBats,
        showLowAccuracyWarning: state.lastConfirmed.prevConsecutiveLowAccuracyAtBats >= LOW_ACCURACY_STREAK_WARNING,
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
        endInningConfirmOpen: false,
        dirty: true,
      };
    }

    case "SET_SCORE":
      return { ...state, ourScore: action.ourScore, opponentScore: action.opponentScore, dirty: true };

    case "SET_PANEL": {
      const key =
        action.panel === "substitution"
          ? "substitutionPanelOpen"
          : action.panel === "endInning"
            ? "endInningConfirmOpen"
            : action.panel === "endGame"
              ? "endGameConfirmOpen"
              : "postGameOpen";
      return { ...state, [key]: action.open } as OperatorState;
    }

    case "MARK_SAVED":
      return { ...state, dirty: false, savedAt: Date.now() };

    default:
      return state;
  }
}

export function shouldWarnLowAccuracy(streak: number): boolean {
  return streak >= LOW_ACCURACY_STREAK_WARNING;
}
