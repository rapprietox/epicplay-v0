// Lineup Intelligence 2.0, Part 5. "claude-opus-5"/"claude-sonnet-5" are
// this app's real, current model ids (see src/lib/anthropic.ts and
// src/app/coach/kairos-actions.ts) -- used verbatim, no correction
// needed here unlike the earlier "claude-sonnet-4-6" mistakes.
export const AI_MODELS = {
  liveLineupFeedback: "claude-sonnet-5",
  fullLineupAnalysis: "claude-opus-5",
  postGameLoss: "claude-opus-5",
  postGameWin: "claude-sonnet-5",
  kairosChat: "claude-sonnet-5",
  zoneInsights: "claude-sonnet-5",
} as const;
