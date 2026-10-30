// Shared facts for the marketing site's expanded funnel. Centralized
// here (not hand-typed per component) so every section drawing from the
// same sample roster, trust-strip feature list, or Lions case-study
// facts stays consistent, and so verified facts have exactly one place
// to correct if something changes.
//
// TRUTH RULE: every name below is fake, every stat is fabricated for
// illustration, and every component that renders this data must render
// a visible "Sample data" label alongside it. Never add a real stat,
// user count, or testimonial here.

export const SAMPLE_NAMES = [
  "Marcus Johnson",
  "Carlos Mendoza",
  "Kenji Tanaka",
  "Diego Reyes",
  "Tyler Chen",
  "Miguel Santos",
] as const;

// What the platform actually tracks, verified against the schema and
// lib/stats.ts, heat-map.ts, operator/*, coach/opponent-scouting-section.tsx,
// and player/clubhouse/* before being listed here -- this is the Trust
// Strip marquee content.
export const TRACKED_FEATURES = [
  "Pitch-by-pitch logging",
  "Batting average heat maps",
  "Spray charts",
  "AI lineup intelligence",
  "Opponent scouting",
  "Player Clubhouse",
  "Reliability-scored insights",
  "Live pitch counts",
] as const;

// Founding Season section: deliberately no team name and no league
// name -- generic, true facts only. This platform really was built
// around one real team's first logged season and a real operator at
// the field, but naming that team/league here isn't this component's
// call to make, so the copy in CaseStudy.tsx stays generic on purpose.
export const FOUNDING_SEASON = {
  // Left empty on purpose -- QuoteCard only renders when this is
  // non-empty, so a real quote can be dropped in later without any
  // other code change.
  quote: "",
  quoteAttribution: "",
};

// KAIROS section: falls back to the CSS orb if this file doesn't
// exist yet (it doesn't) -- see Kairos.tsx's onError handler. Kept as
// one constant so a real/AI-generated image can be swapped in later
// without touching the component.
export const KAIROS_IMAGE_SRC = "/kairos.png";

// Interactive Demo's spray chart: the exact same field background
// images the real app's PlayerSprayChart already uses
// (src/app/player/clubhouse/pro/player-spray-chart.tsx), so the demo
// matches the product instead of inventing its own art. Kept as one
// constant so an AI-generated replacement can be swapped in later
// without touching the component.
export const SPRAY_FIELD_IMAGES = {
  "2d": "/field-2d.png",
  "3d": "/field-3d.png",
} as const;
