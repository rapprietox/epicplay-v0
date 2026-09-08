import type {
  AtBatMode,
  AtBatResult,
  HitType,
  InningHalf,
  PitchOutcome,
  PitchType,
  RunnerState,
  Runners,
} from "@/lib/supabase/types";

export type RunnerQuickAction = "advance" | "scored" | "out" | "stolen_base" | "picked_off" | "error_advance";
export type Base = "first" | "second" | "third";

export interface LocalPitch {
  pitch_number: number;
  pitch_type: PitchType | null;
  zone_x: number | null;
  zone_y: number | null;
  outcome: PitchOutcome;
}

export interface OperatorState {
  gameId: string;
  mode: AtBatMode;
  inning: number;
  inningHalf: InningHalf;
  outs: number;
  ourScore: number;
  opponentScore: number;
  battingOrderPosition: number;
  currentPitcherId: string | null;
  opponentBatterName: string;
  runners: Runners;
  // Snapshot of `runners` taken when the current draft at-bat started, so
  // Undo can restore base state exactly, not just score/outs/batting order.
  runnersAtAtBatStart: Runners | null;

  currentAtBatId: string | null;
  balls: number;
  strikes: number;
  pendingPitches: LocalPitch[];
  selectedPitchType: PitchType | null;
  selectedZone: { x: number; y: number } | null;
  lastPitchZone: { x: number; y: number; outcome: PitchOutcome } | null;
  awaitingResult: boolean;
  suggestedResult: AtBatResult | null;
  fieldTap: { x: number; y: number } | null;
  pendingRbi: number;
  pendingHitType: HitType | null;
  // Runners suggested/confirmed to have scored on the current in-progress
  // at-bat -- the sole source of truth for runsScored at confirm time (no
  // separate manual "runs scored" stepper, to avoid it drifting out of
  // sync with what's actually been marked on the diamond).
  scoredThisAtBat: RunnerState[];
  // True right after a result is picked and the suggested runner movement
  // has been applied to `runners` but not yet reviewed -- drives the
  // "Confirm Runners" pulsing UI on the diamond. Cleared by tapping
  // Confirm Runners, by any manual per-runner override, or by Confirm At-Bat.
  runnersPendingConfirmation: boolean;

  pitchCountForCurrentPitcher: number;
  pitchCountAck75: boolean;
  pitchCountAck85: boolean;
  pitchCountAck100: boolean;
  consecutiveLowAccuracyAtBats: number;
  showLowAccuracyWarning: boolean;

  lastConfirmed: {
    atBatId: string;
    mode: AtBatMode;
    runsScored: number;
    wasOut: boolean;
    runnersBeforeAtBat: Runners;
    prevConsecutiveLowAccuracyAtBats: number;
    deadline: number;
  } | null;

  substitutionPanelOpen: boolean;
  endInningConfirmOpen: boolean;
  endGameConfirmOpen: boolean;
  postGameOpen: boolean;

  dirty: boolean;
  savedAt: number;
}

export const RESULT_IS_OUT: Record<AtBatResult, boolean> = {
  single: false,
  double: false,
  triple: false,
  hr: false,
  flyout: true,
  groundout: true,
  lineout: true,
  strikeout: true,
  walk: false,
  hbp: false,
  error: false,
  fc: false,
};

export const RESULT_LABELS: Record<AtBatResult, string> = {
  single: "Single",
  double: "Double",
  triple: "Triple",
  hr: "HR",
  flyout: "Fly Out",
  groundout: "Ground Out",
  lineout: "Line Out",
  strikeout: "Strikeout",
  walk: "Walk",
  hbp: "HBP",
  error: "Error",
  fc: "FC",
};

export const RESULT_BUTTON_ORDER: AtBatResult[] = [
  "single",
  "double",
  "triple",
  "hr",
  "flyout",
  "groundout",
  "lineout",
  "strikeout",
  "walk",
  "error",
  "fc",
];

export const PITCH_TYPE_LABELS: Record<PitchType, string> = {
  fastball: "Fastball",
  curveball: "Curveball",
  changeup: "Changeup",
  slider: "Slider",
  "2seam": "2-Seam",
  other: "Other",
};

export const HIT_TYPE_LABELS: Record<HitType, string> = {
  groundball: "Ground ball",
  linedrive: "Line drive",
  flyball: "Fly ball",
  bunt: "Bunt",
  popup: "Popup",
  hr: "HR",
};
