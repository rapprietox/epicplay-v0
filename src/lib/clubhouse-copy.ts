// Explain-EPS/KAIROS/tracking-modes batch: wording for the three
// explainer surfaces (the "What is EPS?" panel, the Clubhouse Pro
// "What you get" list's KAIROS line, and its tracking-modes note) --
// kept in one place, same reasoning as src/lib/pricing.ts, so none of
// it can drift between the Performance Score card, the player profile,
// and the Pro list.

// EPS_PLAIN_LANGUAGE mirrors computeEps's real weights (src/lib/eps.ts):
// (obp+slg)/2, capped at 1.0, worth up to 40 points; walk rate (bb/pa),
// capped at 1.0, worth up to 30; "contact rate" (1 - k/pa), worth up to
// 20; stolen-base success rate (sb / (sb+caughtStealing)) worth up to
// 10, or a neutral 5 of 10 if the player's never attempted a steal.
// Scores 0-100 by construction (the four caps sum to at most 100), and
// computeEps returns null under 5 plate appearances (MIN_PA_FOR_EPS) --
// described here, not invented, straight from reading that file.
export const EPS_PLAIN_LANGUAGE =
  "EPS (EpicPlay Performance Score) is one number from 0 to 100 for a hitter's overall offense. " +
  "It's built from how often he gets on base and hits for power (OBP and SLG averaged together, up to 40 of the 100 points), " +
  "how often he walks (up to 30 points), how often he puts the ball in play instead of striking out (up to 20 points), " +
  "and how well he steals -- his stolen-base success rate (up to 10 points, or a neutral 5 if he's never attempted one, " +
  "so never trying isn't scored as bad baserunning).";

export const EPS_MIN_PA_NOTE = "A player needs at least 5 plate appearances before EPS shows a score at all.";

export const EPS_DISCLAIMER = "EPS is EpicPlay's own metric for this app -- it is not MLB's WAR or any official statistic.";

export const EPS_EXAMPLE =
  'Example: 20 plate appearances, a .400 OBP and .500 SLG, 3 walks, 4 strikeouts, and 2-for-2 stealing bases ' +
  'scores 18 (on-base/power) + 4.5 (walks) + 16 (contact) + 10 (steals) = 48.5 -- "Solid ⚾."';

// KAIROS_DESCRIPTION: replaces the one-line Pro-list description.
// Deliberately never names which AI model or company powers it (the
// product-facing name is KAIROS, full stop) -- matches how the KAIROS
// system prompts themselves never say "I am Claude" or mention Anthropic.
export const KAIROS_DESCRIPTION =
  "KAIROS is your personal AI baseball coach. Ask it about your swing, your weak spots, what to practice, and how you're doing. " +
  "It answers from your own logged numbers, and 20 messages a month are included. It only talks about baseball and your training, " +
  "and it can be wrong, so treat it as a guide, not a rule.";

// TRACKING_MODES_NOTE: verified against the actual data each feature
// reads before wording this, not assumed --
// - The 2D spray chart only needs an at-bat's field_x/field_y (the
//   ball-landing tap), which Quick Mode's result buttons still capture
//   via their own one-tap field diagram -- it is NOT Full-Mode-only.
// - Heat maps (src/app/coach/players/[id]/strike-zone-heatmap.tsx and
//   friends) need pitches.zone_x/zone_y per pitch, which Quick Mode
//   never logs at all (0 pitches by design -- see CLAUDE.md's Quick
//   Mode notes) -- Full Mode only.
// - The 3D spray chart's trajectory shape (src/app/player/clubhouse/
//   pro/player-spray-chart.tsx) picks its animation from the at-bat's
//   hit_type (groundball/linedrive/flyball/popup/bunt), which Quick
//   Mode also never captures -- so while a Quick-Mode at-bat's dot
//   still has a location, its 3D trajectory falls back to one generic
//   shape instead of the real ball-type-specific one.
export const TRACKING_MODES_NOTE =
  "Heat maps and 3D ball trajectories need games tracked pitch by pitch (Full Mode), because they use where each pitch crossed " +
  "the zone and how each ball was hit. Games logged in Quick Mode (results only) still count toward your stats.";
