"use client";

import { useState } from "react";
import { ReliabilityBadge } from "@/components/reliability-badge";
import { zoneColor, whiffRateColor, pitchLocationColor } from "@/lib/heat-map";
import { SPRAY_FIELD_IMAGES } from "../constants";

// Every number in this file is fabricated for illustration -- the
// "Sample data" label on the section head is load-bearing, not
// decorative. The heat-map cells are colored by the REAL
// zoneColor/whiffRateColor/pitchLocationColor functions from
// src/lib/heat-map.ts (not a re-invented color scale), fed sample
// lines with a real spread (some zones near .080, others near .420,
// per the request) so the three tabs actually look different from
// each other, matching how the real product's heat maps read. The
// rating vocabulary/colors below (EXCELLENT / GOOD / CONSIDER /
// BLUNDER) and the reliability badge are also the real ones this app
// uses (src/app/coach/games/[id]/setup/lineup-builder.tsx and
// src/lib/reliability.ts) -- only the sample players' stats are made up.

type Metric = "avg" | "whiff" | "location";
type PitchFilter = "all" | "fastball" | "curveball" | "slider";

const METRIC_TABS: { key: Metric; label: string }[] = [
  { key: "avg", label: "Batting Average" },
  { key: "whiff", label: "Swing & Miss" },
  { key: "location", label: "Pitch Location" },
];

const PITCH_FILTERS: { key: PitchFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "fastball", label: "Fastball" },
  { key: "curveball", label: "Curveball" },
  { key: "slider", label: "Slider" },
];

// One pitch-count table drives all three metrics' "pitches seen" math,
// the same way one real pitches table backs every heat map in the app.
const COUNTS: Record<PitchFilter, number[]> = {
  all: [14, 19, 12, 23, 31, 18, 16, 21, 15],
  fastball: [10, 16, 9, 20, 28, 16, 6, 8, 5],
  curveball: [1, 1, 1, 2, 2, 1, 7, 9, 8],
  slider: [3, 2, 2, 1, 1, 1, 3, 4, 2],
};

// Batting average per zone -- deliberately spans .08 to .42 (per the
// request) so the tab visibly uses the full zoneColor range, not just
// one or two bands.
const AVG: Record<PitchFilter, number[]> = {
  all: [0.08, 0.22, 0.15, 0.35, 0.42, 0.28, 0.1, 0.18, 0.12],
  fastball: [0.14, 0.28, 0.2, 0.38, 0.46, 0.32, 0.16, 0.24, 0.18],
  curveball: [0.04, 0.1, 0.06, 0.18, 0.24, 0.14, 0.05, 0.08, 0.05],
  slider: [0.06, 0.14, 0.09, 0.22, 0.28, 0.18, 0.07, 0.11, 0.08],
};

// Whiff rate (0-1 fraction, matching ZoneWhiffLine.rate) -- low in the
// meatball middle zone, climbing sharply low-and-away, the classic
// chase-zone pattern.
const WHIFF: Record<PitchFilter, number[]> = {
  all: [0.28, 0.18, 0.35, 0.12, 0.08, 0.15, 0.55, 0.62, 0.7],
  fastball: [0.15, 0.1, 0.2, 0.06, 0.04, 0.08, 0.3, 0.35, 0.42],
  curveball: [0.45, 0.32, 0.55, 0.25, 0.18, 0.28, 0.75, 0.85, 0.9],
  slider: [0.35, 0.24, 0.42, 0.18, 0.12, 0.2, 0.62, 0.7, 0.78],
};

function avgLine(filter: PitchFilter, zone: number) {
  const ab = COUNTS[filter][zone];
  const avg = AVG[filter][zone];
  return { ab, h: Math.round(ab * avg), avg };
}

function whiffLine(filter: PitchFilter, zone: number) {
  const swings = COUNTS[filter][zone];
  const rate = WHIFF[filter][zone];
  return { swings, misses: Math.round(swings * rate), rate };
}

function locationLine(filter: PitchFilter, zone: number) {
  const counts = COUNTS[filter];
  const total = counts.reduce((a, b) => a + b, 0);
  const count = counts[zone];
  return { count, pct: total ? (count / total) * 100 : 0 };
}

function cellColor(metric: Metric, filter: PitchFilter, zone: number): string {
  if (metric === "avg") return zoneColor(avgLine(filter, zone));
  if (metric === "whiff") return whiffRateColor(whiffLine(filter, zone));
  return pitchLocationColor(locationLine(filter, zone));
}

function cellTooltip(metric: Metric, filter: PitchFilter, zone: number): string {
  const count = COUNTS[filter][zone];
  if (metric === "avg") return `${avgLine(filter, zone).avg.toFixed(3)} AVG · ${count} pitches`;
  if (metric === "whiff") return `${Math.round(whiffLine(filter, zone).rate * 100)}% whiff · ${count} pitches`;
  return `${locationLine(filter, zone).pct.toFixed(0)}% of pitches, ${count} pitches`;
}

// Legend bands copied verbatim from each real color function's own
// thresholds in src/lib/heat-map.ts, not re-derived -- if those
// thresholds ever change, this legend would need updating to match.
const LEGEND: Record<Metric, { color: string; label: string }[]> = {
  avg: [
    { color: "#173A22", label: ".000-.150" },
    { color: "#EF9F27", label: ".151-.299" },
    { color: "#2ECC71", label: ".300-.399" },
    { color: "#F0C060", label: ".400+" },
  ],
  whiff: [
    { color: "#173A22", label: "0-15% whiff" },
    { color: "#EF9F27", label: "16-30%" },
    { color: "#E8720C", label: "31-50%" },
    { color: "#E24B4A", label: "51%+" },
  ],
  location: [
    { color: "#12240F", label: "0-5% of pitches" },
    { color: "#1D5A34", label: "6-15%" },
    { color: "#24A058", label: "16-25%" },
    { color: "#2ECC71", label: "26-35%" },
    { color: "#F0C060", label: "36%+" },
  ],
};

interface SprayPoint {
  key: string;
  x: number;
  y: number;
  category: "groundball" | "linedrive" | "flyball" | "hr";
  label: string;
}

// Same category palette as src/lib/heat-map.ts's LINE_HIT_CATEGORY_COLOR.
const CATEGORY_COLOR: Record<SprayPoint["category"], string> = {
  groundball: "#EF9F27",
  linedrive: "#F0C060",
  flyball: "#2ECC71",
  hr: "#FFFFFF",
};

// peakPct/overshoot copied from PlayerSprayChart's own TRAJECTORY_STYLE
// (src/app/player/clubhouse/pro/player-spray-chart.tsx) -- "everything
// is a parabola, just a different height," home run the one exception
// with overshoot + a glow + a starburst on landing.
const PEAK_PCT: Record<SprayPoint["category"], number> = {
  groundball: 0.05,
  linedrive: 0.15,
  flyball: 0.45,
  hr: 0.7,
};
const HOME: { x: number; y: number } = { x: 50, y: 92 };

const SPRAY_POINTS: SprayPoint[] = [
  { key: "g1", x: 42, y: 78, category: "groundball", label: "Groundball, 3-4" },
  { key: "g2", x: 60, y: 82, category: "groundball", label: "Groundball, 5-3" },
  { key: "l1", x: 30, y: 52, category: "linedrive", label: "Line drive, LF line" },
  { key: "l2", x: 68, y: 46, category: "linedrive", label: "Line drive, RF gap" },
  { key: "f1", x: 50, y: 22, category: "flyball", label: "Fly ball, CF" },
  { key: "hr1", x: 78, y: 14, category: "hr", label: "Home run, RF" },
];

function parabolaPath(x1: number, y1: number, x2: number, y2: number, peakPct: number, overshootFactor: number) {
  const dist = Math.hypot(x2 - x1, y2 - y1) || 1;
  const dirX = (x2 - x1) / dist;
  const dirY = (y2 - y1) / dist;
  const endX = x2 + dirX * dist * overshootFactor;
  const endY = y2 + dirY * dist * overshootFactor;
  const midX = (x1 + endX) / 2;
  const midY = (y1 + endY) / 2 - dist * peakPct;
  return { d: `M ${x1},${y1} Q ${midX},${midY} ${endX},${endY}`, endX, endY };
}

interface LineupSample {
  name: string;
  rating: "EXCELLENT" | "GOOD" | "CONSIDER" | "BLUNDER";
  reason: string;
  stats: { gamesPlayed: number; totalAB: number; opponentsCount: number };
}

const RATING_STYLE: Record<LineupSample["rating"], { emoji: string; color: string }> = {
  EXCELLENT: { emoji: "🌟", color: "#2ECC71" },
  GOOD: { emoji: "✅", color: "#2ECC71" },
  CONSIDER: { emoji: "❓", color: "#EF9F27" },
  BLUNDER: { emoji: "💀", color: "#E24B4A" },
};

const LINEUP_SAMPLES: LineupSample[] = [
  {
    name: "Marcus Johnson",
    rating: "EXCELLENT",
    reason: "High on-base rate over his last several games -- exactly the profile a leadoff slot wants.",
    stats: { gamesPlayed: 12, totalAB: 95, opponentsCount: 4 },
  },
  {
    name: "Carlos Mendoza",
    rating: "GOOD",
    reason: "Solid contact and enough speed to make something happen on the bases.",
    stats: { gamesPlayed: 8, totalAB: 60, opponentsCount: 3 },
  },
  {
    name: "Kenji Tanaka",
    rating: "CONSIDER",
    reason: "Decent average, but not the classic on-base-and-run profile for the top of the order.",
    stats: { gamesPlayed: 6, totalAB: 40, opponentsCount: 2 },
  },
  {
    name: "Diego Reyes",
    rating: "BLUNDER",
    reason: "Power bat with a low on-base rate -- that production belongs lower in the order, not leading off.",
    stats: { gamesPlayed: 10, totalAB: 70, opponentsCount: 3 },
  },
];

export function InteractiveDemo() {
  const [metric, setMetric] = useState<Metric>("avg");
  const [filter, setFilter] = useState<PitchFilter>("all");
  const [sprayMode, setSprayMode] = useState<"2d" | "3d">("2d");
  const [lineupPick, setLineupPick] = useState<string>(LINEUP_SAMPLES[0].name);

  const picked = LINEUP_SAMPLES.find((p) => p.name === lineupPick) ?? LINEUP_SAMPLES[0];
  const ratingStyle = RATING_STYLE[picked.rating];

  return (
    <section className="demo-section section-full" id="demo">
      <div className="section">
        <div className="demo-head">
          <h2 className="section-headline headline-white">Try it yourself.</h2>
          <p className="demo-sample-label">Sample data -- Marcus Johnson, Carlos Mendoza, Kenji Tanaka, Diego Reyes</p>
        </div>

        <div className="demo-grid-layout">
          {/* Heat map tile */}
          <div className="card demo-tile cursor-glow">
            <div className="demo-tabs">
              {METRIC_TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={`demo-tab ${metric === t.key ? "active" : ""}`}
                  onClick={() => setMetric(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="demo-filter-row">
              {PITCH_FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={`demo-filter-chip ${filter === f.key ? "active" : ""}`}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="demo-zone-grid">
              {Array.from({ length: 9 }).map((_, i) => (
                <div
                  key={i}
                  className="demo-zone-cell"
                  tabIndex={0}
                  style={{ background: cellColor(metric, filter, i) }}
                >
                  <span className="demo-tooltip">{cellTooltip(metric, filter, i)}</span>
                </div>
              ))}
            </div>
            <div className="demo-legend">
              {LEGEND[metric].map((l) => (
                <span key={l.label} className="demo-legend-item">
                  <i style={{ background: l.color }} />
                  {l.label}
                </span>
              ))}
            </div>
          </div>

          {/* Spray chart tile */}
          <div className="card demo-tile cursor-glow">
            <div className="demo-tile-header">
              <div>
                <p className="demo-tile-title">Spray Chart</p>
                <p className="demo-sample-label demo-sample-label-inline">Sample data</p>
              </div>
              <div className="demo-spray-toggle">
                <button type="button" className={sprayMode === "2d" ? "active" : ""} onClick={() => setSprayMode("2d")}>
                  2D
                </button>
                <button type="button" className={sprayMode === "3d" ? "active" : ""} onClick={() => setSprayMode("3d")}>
                  3D
                </button>
              </div>
            </div>
            <div
              className="demo-spray-field"
              style={{ backgroundImage: `url('${sprayMode === "2d" ? SPRAY_FIELD_IMAGES["2d"] : SPRAY_FIELD_IMAGES["3d"]}')` }}
            >
              <svg viewBox="0 0 100 100" className="demo-spray-svg" aria-hidden="true">
                {sprayMode === "2d"
                  ? SPRAY_POINTS.map((p) => (
                      <circle key={p.key} cx={p.x} cy={p.y} r={p.category === "hr" ? 3.2 : 2.4} fill={CATEGORY_COLOR[p.category]} />
                    ))
                  : SPRAY_POINTS.map((p) => {
                      const isHr = p.category === "hr";
                      const { d: path, endX, endY } = parabolaPath(HOME.x, HOME.y, p.x, p.y, PEAK_PCT[p.category], isHr ? 0.15 : 0);
                      return (
                        <g key={p.key}>
                          <path
                            className="demo-traj"
                            d={path}
                            fill="none"
                            stroke={CATEGORY_COLOR[p.category]}
                            strokeWidth={isHr ? 2.4 : 1.4}
                            strokeLinecap="round"
                            pathLength={1}
                            style={isHr ? { filter: "drop-shadow(0 0 6px #F0C060)" } : undefined}
                          />
                          {isHr && (
                            <circle
                              cx={endX}
                              cy={endY}
                              r={2.6}
                              fill="#F0C060"
                              className="demo-traj-landing"
                              style={{ filter: "drop-shadow(0 0 6px #F0C060)" }}
                            />
                          )}
                        </g>
                      );
                    })}
              </svg>
            </div>
            <div className="demo-spray-legend">
              <span>
                <i style={{ background: CATEGORY_COLOR.groundball }} /> Ground ball
              </span>
              <span>
                <i style={{ background: CATEGORY_COLOR.linedrive }} /> Line drive
              </span>
              <span>
                <i style={{ background: CATEGORY_COLOR.flyball }} /> Fly ball
              </span>
              <span>
                <i style={{ background: CATEGORY_COLOR.hr }} /> Home run
              </span>
            </div>
          </div>

          {/* Lineup blunder mini demo */}
          <div className="card demo-tile demo-tile-wide cursor-glow">
            <p className="demo-tile-title">Who bats leadoff?</p>
            <div className="demo-lineup-picker">
              {LINEUP_SAMPLES.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  className={`demo-player-chip ${lineupPick === p.name ? "active" : ""}`}
                  onClick={() => setLineupPick(p.name)}
                >
                  {p.name}
                </button>
              ))}
            </div>
            <div className="demo-lineup-result">
              <div className="demo-rating-chip" style={{ color: ratingStyle.color, borderColor: ratingStyle.color }}>
                {ratingStyle.emoji} {picked.rating}
              </div>
              <p className="demo-reason">{picked.reason}</p>
              <div className="demo-reliability">
                <ReliabilityBadge stats={picked.stats} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
