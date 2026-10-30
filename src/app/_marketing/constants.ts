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

// Confirmed facts only -- the Lions are a real team whose 2026 DLL
// season is logged in this codebase's own supabase/data-ops/*.sql
// scripts (2026_lions_season_setup.sql and its follow-up corrections).
// No player names, scores, or win/loss records from those scripts are
// reproduced here -- that's real youth players' game data, not
// marketing copy, and the user hasn't confirmed any specific number for
// public use. Only the team name, league label, and season year are
// taken as given; everything else stays generic until confirmed.
export const CASE_STUDY = {
  teamName: "Lions",
  league: "DLL",
  season: "2026",
  // Left empty on purpose -- QuoteCard only renders when this is
  // non-empty, so a real quote can be dropped in later without any
  // other code change.
  quote: "",
  quoteAttribution: "",
};
