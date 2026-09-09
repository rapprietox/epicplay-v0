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

export type RunnerQuickAction = "advance" | "scored" | "out" | "stolen_base" | "picked_off" | "error_advance";
export type Base = "first" | "second" | "third";

// How a runner reached home -- drives RBI eligibility (Fix 1/4). Only "hit",
// "sac_fly", and "forced_walk_hbp" credit the batter with an RBI.
export type ScoreMethod = "hit" | "wild_pitch" | "passed_ball" | "balk" | "error" | "sac_fly" | "forced_walk_hbp";

export const SCORE_METHOD_AWARDS_RBI: Record<ScoreMethod, boolean> = {
  hit: true,
  sac_fly: true,
  forced_walk_hbp: true,
  wild_pitch: false,
  passed_ball: false,
  balk: false,
  error: false,
};

export const SCORE_METHOD_LABELS: Record<ScoreMethod, string> = {
  hit: "Hit by batter",
  wild_pitch: "Wild pitch",
  passed_ball: "Passed ball",
  balk: "Balk",
  error: "Error",
  sac_fly: "Sacrifice fly",
  forced_walk_hbp: "Walk/HBP forced in",
};

// wild_pitch/passed_ball/balk/error map onto the existing game_events
// enum for attribution logging; hit/sac_fly/forced_walk_hbp don't log a
// separate event -- they're just how the batter's own at-bat result
// already explains the run.
export const SCORE_METHOD_EVENT: Partial<Record<ScoreMethod, "wild_pitch" | "passed_ball" | "balk" | "error">> = {
  wild_pitch: "wild_pitch",
  passed_ball: "passed_ball",
  balk: "balk",
  error: "error",
};

// Auto-implied score method for runners the suggestion engine advances
// off the batter's own result (single/double/triple/hr -> hit;
// walk/hbp -> forced; error/fc -> no RBI, same as a manual "Error" pick).
export function resultToScoreMethod(result: AtBatResult): ScoreMethod {
  if (result === "walk" || result === "hbp") return "forced_walk_hbp";
  if (result === "error" || result === "fc") return "error";
  return "hit";
}

export interface ScoredRunner {
  runner: RunnerState;
  method: ScoreMethod;
}

// Arranged like a field: outfield row, infield row, battery row.
export const FIELDING_LAYOUT: FieldingPosition[][] = [
  ["LF", "CF", "RF"],
  ["3B", "SS", "2B", "1B"],
  ["P", "C"],
];

export interface LocalPitch {
  pitch_number: number;
  pitch_type: PitchType | null;
  zone_x: number | null;
  zone_y: number | null;
  outcome: PitchOutcome;
  // Whether the batter swung -- only populated going forward (see the
  // pitches.swing migration); older pitches and the session heat map log
  // leave this undefined/null.
  swing?: boolean | null;
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
  // Every pitch logged this game (all at-bats, never cleared on
  // confirm/undo) -- feeds the operator's own "Session Heat Map" toggle.
  // Not authoritative (an undone pitch stays in it), just a quick in-game
  // visual reference; the real heat maps (player/team/pitcher pages) read
  // straight from the pitches table.
  gamePitchLog: LocalPitch[];
  selectedPitchType: PitchType | null;
  selectedZone: { x: number; y: number } | null;
  lastPitchZone: { x: number; y: number; outcome: PitchOutcome } | null;
  awaitingResult: boolean;
  suggestedResult: AtBatResult | null;
  fieldTap: { x: number; y: number } | null;
  pendingRbi: number;
  pendingHitType: HitType | null;
  // Runners suggested/confirmed to have scored on the current in-progress
  // at-bat, each tagged with how they scored (Fix 1/4) -- the sole source
  // of truth for runsScored at confirm time (no separate manual "runs
  // scored" stepper, to avoid it drifting out of sync with what's
  // actually been marked on the diamond). pendingRbi auto-recomputes from
  // this list's RBI-eligible entries but stays a manually-adjustable
  // stepper on top, for the judgment calls a formula won't get right.
  scoredThisAtBat: ScoredRunner[];
  // True right after a result is picked and the suggested runner movement
  // has been applied to `runners` but not yet reviewed -- drives the
  // "Confirm Runners" pulsing UI on the diamond. Cleared by tapping
  // Confirm Runners, by any manual per-runner override, or by Confirm At-Bat.
  runnersPendingConfirmation: boolean;
  // Fielding credit captured after the field-diagram tap on an out
  // (Fix 6) -- exactly one of playerId/opponentPlayerId is set, resolved
  // from the lineup (mode 'pitching', ours) or opponent_players (mode
  // 'hitting', theirs) by position.
  pendingFielding: { position: FieldingPosition; playerId: string | null; opponentPlayerId: string | null } | null;

  pitchCountForCurrentPitcher: number;
  pitchCountAck75: boolean;
  pitchCountAck85: boolean;
  pitchCountAck100: boolean;
  // Running average of atBatAccuracyRatio across every confirmed at-bat
  // this game (sum/count, not a consecutive-streak counter) -- drives both
  // the "Logging: N% accurate" display and the < 70% warning banner.
  accuracyRatioSum: number;
  accuracyAtBatCount: number;
  showLowAccuracyWarning: boolean;

  // Fix 2: live box-score-style mini dashboard. H/R are our offense
  // (accumulated hitting-mode at-bats); E/K are our defense (accumulated
  // pitching-mode at-bats -- errors we commit fielding, strikeouts we
  // record pitching). LOB is ours only, captured when a hitting half-inning
  // ends. See CLAUDE.md for the "why this framing" note.
  hitsThisInning: number;
  runsThisInning: number;
  errorsThisInning: number;
  kThisInning: number;
  hitsGame: number;
  runsGame: number;
  errorsGame: number;
  kGame: number;
  lobGame: number;

  lastConfirmed: {
    atBatId: string;
    secondAtBatId: string | null;
    mode: AtBatMode;
    runsScored: number;
    outsRecorded: number;
    runnersBeforeAtBat: Runners;
    prevAccuracyRatioSum: number;
    prevAccuracyAtBatCount: number;
    prevBoxScore: {
      hitsThisInning: number;
      runsThisInning: number;
      errorsThisInning: number;
      kThisInning: number;
      hitsGame: number;
      runsGame: number;
      errorsGame: number;
      kGame: number;
    };
    deadline: number;
  } | null;

  substitutionPanelOpen: boolean;
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
  double_play: true,
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
  double_play: "Double Play",
};

// Results where the ball was put in play and an out was recorded --
// Fix 6 prompts for fielding credit after these (plus double_play, which
// gets its own 2-position picker in the DP wizard instead).
export const FIELDABLE_OUT_RESULTS: AtBatResult[] = ["flyout", "groundout", "lineout"];

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
  "double_play",
];

// Sequential flow (Fix 4): once a hit type is picked, only these results
// make baseball sense for it, so the result menu filters down to just
// these instead of showing all 12. A "sac fly" isn't its own AtBatResult
// here -- it's still a "flyout" result, credited as a sac fly via the
// runner's ScoreMethod when they score (the mechanism Sprint 3 already
// built), so it deliberately isn't listed as a separate button. Popup and
// bunt aren't named in the original spec (only ground ball/fly ball/line
// drive were) -- these two lists are a reasonable extrapolation of the
// same "what can this batted ball actually become" logic.
export const HIT_TYPE_RESULT_OPTIONS: Record<HitType, AtBatResult[]> = {
  groundball: ["groundout", "single", "double", "error", "fc", "double_play"],
  flyball: ["flyout", "single", "double", "triple", "hr"],
  linedrive: ["lineout", "single", "double", "triple", "hr"],
  popup: ["flyout", "single", "error", "fc"],
  bunt: ["groundout", "single", "error", "fc"],
  hr: ["hr"],
};

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

export const OUTCOME_LABELS: Record<PitchOutcome, string> = {
  ball: "Ball",
  strike: "Strike",
  foul: "Foul",
  hbp: "HBP",
  inplay: "In Play",
};
