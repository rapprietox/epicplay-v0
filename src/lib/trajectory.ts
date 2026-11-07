import type { LineHitCategory } from "@/lib/heat-map";

// Shared ball-trajectory shape, extracted from PlayerSprayChart
// (src/app/player/clubhouse/pro/player-spray-chart.tsx) so the live
// broadcast page (src/app/live/[token]/live-view.tsx) can reuse the
// exact same arc/glow/duration per hit type instead of a second,
// drifting copy. See PlayerSprayChart's own comment for the full design
// history ("3D trajectory redesign, v2: everything is a parabola --
// just different heights and angles").
export interface TrajectoryStyle {
  color: string;
  durationMs: number;
  strokeWidth: number;
  peakPct: number; // peak height as a fraction of the home-to-landing distance
  overshootFactor: number; // extends the path's endpoint this fraction further past the real landing spot
  glow: string | undefined; // exact CSS filter value, or undefined for no glow
  starburst: boolean;
}

export const TRAJECTORY_STYLE: Record<LineHitCategory, TrajectoryStyle> = {
  groundball: { color: "#EF9F27", durationMs: 350, strokeWidth: 2.5, peakPct: 0.05, overshootFactor: 0, glow: undefined, starburst: false },
  linedrive: { color: "#F0C060", durationMs: 300, strokeWidth: 3, peakPct: 0.15, overshootFactor: 0, glow: undefined, starburst: false },
  flyball: { color: "#2ECC71", durationMs: 800, strokeWidth: 3, peakPct: 0.45, overshootFactor: 0, glow: undefined, starburst: false },
  hr: {
    color: "#F0C060",
    durationMs: 1200,
    strokeWidth: 4,
    peakPct: 0.7,
    overshootFactor: 0.15,
    glow: "drop-shadow(0 0 8px #F0C060)",
    starburst: true,
  },
  popup: { color: "#1A6B3C", durationMs: 400, strokeWidth: 2, peakPct: 0.25, overshootFactor: 0, glow: undefined, starburst: false },
  // "other" is also what a null hit_type (every Quick Mode ball in
  // play) resolves to via lineHitCategory -- the generic arc the live
  // page's own spec calls for when there's no hit_type to go on.
  other: { color: "#5A7A8A", durationMs: 300, strokeWidth: 2, peakPct: 0.08, overshootFactor: 0, glow: undefined, starburst: false },
};

export interface TrajectoryPath {
  d: string;
  endX: number;
  endY: number;
}

// The one shape every hit type shares. overshootFactor (home run only)
// extends the endpoint beyond the real landing coordinate first, so the
// peak then sits centered over the whole dramatized flight.
export function parabolaPath(x1: number, y1: number, x2: number, y2: number, peakPct: number, overshootFactor: number): TrajectoryPath {
  const dist = Math.hypot(x2 - x1, y2 - y1) || 1;
  const dirX = (x2 - x1) / dist;
  const dirY = (y2 - y1) / dist;
  const endX = x2 + dirX * dist * overshootFactor;
  const endY = y2 + dirY * dist * overshootFactor;
  const midX = (x1 + endX) / 2;
  const midY = (y1 + endY) / 2 - dist * peakPct;
  return { d: `M ${x1},${y1} Q ${midX},${midY} ${endX},${endY}`, endX, endY };
}
