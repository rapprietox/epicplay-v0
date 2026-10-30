"use client";

import { useState } from "react";
import { ReliabilityBadge } from "@/components/reliability-badge";

// Every number in this file is fabricated for illustration -- the
// "Sample data" label on the section head is load-bearing, not
// decorative. The rating vocabulary/colors below (EXCELLENT / GOOD /
// CONSIDER / BLUNDER) and the reliability badge are the real ones this
// app actually uses (src/app/coach/games/[id]/setup/lineup-builder.tsx
// and src/lib/reliability.ts) -- only the sample players' stats are
// made up.

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

const COUNTS: Record<PitchFilter, number[]> = {
  fastball: [10, 16, 9, 20, 28, 16, 6, 8, 5],
  curveball: [1, 1, 1, 2, 2, 1, 7, 9, 8],
  slider: [3, 2, 2, 1, 1, 1, 3, 4, 2],
  all: [14, 19, 12, 23, 31, 18, 16, 21, 15],
};

const AVG: Record<PitchFilter, number[]> = {
  all: [0.26, 0.3, 0.255, 0.335, 0.36, 0.31, 0.215, 0.25, 0.23],
  fastball: [0.28, 0.32, 0.27, 0.355, 0.38, 0.33, 0.26, 0.29, 0.27],
  curveball: [0.18, 0.21, 0.19, 0.23, 0.25, 0.22, 0.15, 0.17, 0.16],
  slider: [0.21, 0.24, 0.22, 0.26, 0.28, 0.25, 0.17, 0.19, 0.18],
};

const WHIFF: Record<PitchFilter, number[]> = {
  all: [20, 16, 24, 9, 6, 11, 38, 44, 33],
  fastball: [12, 10, 16, 5, 4, 7, 24, 28, 20],
  curveball: [38, 34, 42, 22, 18, 26, 58, 64, 52],
  slider: [30, 26, 34, 16, 13, 20, 48, 54, 42],
};

function locationPct(filter: PitchFilter, zone: number) {
  const counts = COUNTS[filter];
  const total = counts.reduce((a, b) => a + b, 0);
  return total ? Math.round((counts[zone] / total) * 100) : 0;
}

function cellBackground(metric: Metric, filter: PitchFilter, zone: number) {
  if (metric === "avg") {
    const v = AVG[filter][zone];
    const t = Math.min(1, Math.max(0, (v - 0.15) / 0.25));
    return `rgba(46, 204, 113, ${0.12 + t * 0.55})`;
  }
  if (metric === "whiff") {
    const v = WHIFF[filter][zone];
    const t = Math.min(1, v / 65);
    return `rgba(226, 75, 74, ${0.1 + t * 0.6})`;
  }
  const v = locationPct(filter, zone);
  const t = Math.min(1, v / 25);
  return `rgba(240, 192, 96, ${0.1 + t * 0.6})`;
}

function cellTooltip(metric: Metric, filter: PitchFilter, zone: number) {
  const count = COUNTS[filter][zone];
  if (metric === "avg") return `${AVG[filter][zone].toFixed(3)} AVG · ${count} pitches`;
  if (metric === "whiff") return `${WHIFF[filter][zone]}% whiff · ${count} pitches`;
  return `${locationPct(filter, zone)}% of pitches, ${count} pitches`;
}

interface SprayPoint {
  key: string;
  x: number;
  y: number;
  category: "ground" | "line" | "fly" | "hr";
  label: string;
}

const SPRAY_POINTS: SprayPoint[] = [
  { key: "g1", x: 42, y: 78, category: "ground", label: "Groundball, 3-4" },
  { key: "g2", x: 60, y: 82, category: "ground", label: "Groundball, 5-3" },
  { key: "l1", x: 30, y: 52, category: "line", label: "Line drive, LF line" },
  { key: "l2", x: 68, y: 46, category: "line", label: "Line drive, RF gap" },
  { key: "f1", x: 50, y: 22, category: "fly", label: "Fly ball, CF" },
  { key: "hr1", x: 78, y: 14, category: "hr", label: "Home run, RF" },
];

const CATEGORY_COLOR: Record<SprayPoint["category"], string> = {
  ground: "#EF9F27",
  line: "#F0C060",
  fly: "#2ECC71",
  hr: "#FFFFFF",
};

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
                  style={{ background: cellBackground(metric, filter, i) }}
                >
                  <span className="demo-tooltip">{cellTooltip(metric, filter, i)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Spray chart tile */}
          <div className="card demo-tile cursor-glow">
            <div className="demo-tile-header">
              <p className="demo-tile-title">Spray Chart</p>
              <div className="demo-spray-toggle">
                <button
                  type="button"
                  className={sprayMode === "2d" ? "active" : ""}
                  onClick={() => setSprayMode("2d")}
                >
                  2D
                </button>
                <button
                  type="button"
                  className={sprayMode === "3d" ? "active" : ""}
                  onClick={() => setSprayMode("3d")}
                >
                  3D
                </button>
              </div>
            </div>
            <svg viewBox="0 0 100 100" className="demo-spray-svg" aria-hidden="true">
              <path d="M50,96 L8,30 M50,96 L92,30 M50,96 Q50,8 50,8" fill="none" stroke="#1A3D28" strokeWidth="1" />
              {sprayMode === "2d"
                ? SPRAY_POINTS.map((p) => (
                    <circle key={p.key} cx={p.x} cy={p.y} r={p.category === "hr" ? 3.2 : 2.4} fill={CATEGORY_COLOR[p.category]} />
                  ))
                : SPRAY_POINTS.map((p) => {
                    const arcHeight = p.category === "ground" ? 2 : p.category === "line" ? 10 : p.category === "fly" ? 28 : 40;
                    const midX = (50 + p.x) / 2;
                    const midY = 96 - arcHeight;
                    return (
                      <path
                        key={p.key}
                        className="demo-traj"
                        d={`M50,96 Q${midX},${midY} ${p.x},${p.y}`}
                        fill="none"
                        stroke={CATEGORY_COLOR[p.category]}
                        strokeWidth="1.4"
                        pathLength={1}
                      />
                    );
                  })}
            </svg>
            <div className="demo-spray-legend">
              <span>
                <i style={{ background: CATEGORY_COLOR.ground }} /> Ground
              </span>
              <span>
                <i style={{ background: CATEGORY_COLOR.line }} /> Line drive
              </span>
              <span>
                <i style={{ background: CATEGORY_COLOR.fly }} /> Fly ball
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
