"use client";

import { useState } from "react";
import { formatAvg } from "@/lib/stats";

export interface TrendPoint {
  gameId: string;
  gameIndex: number; // 1-based, chronological
  opponentName: string;
  rollingAvg: number;
  gameLine: string; // e.g. "2-4, 1 HR"
}

// Clubhouse Pro enhancement, Part 4. Hand-built inline SVG polyline, no
// external library -- matching this app's established precedent for the
// heat maps and the spray chart's own radiating lines. Segment color
// follows the request literally ("green when trending up, red when
// trending down"): each segment between two consecutive points is
// colored by whether the average moved up or down over that segment,
// not one flat color for the whole line.
export function SeasonTrendChart({ points }: { points: TrendPoint[] }) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (points.length < 2) {
    return (
      <section className="glossy rounded-lg border border-border bg-surface p-5">
        <h2 className="font-heading text-lg font-semibold uppercase tracking-wide text-white">Season Trend</h2>
        <p className="mt-3 text-sm text-foreground/50">Not enough games logged yet to chart a trend.</p>
      </section>
    );
  }

  const width = 600;
  const height = 220;
  const padding = { top: 16, right: 16, bottom: 28, left: 40 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const maxAvg = Math.max(0.4, ...points.map((p) => p.rollingAvg));

  const xFor = (i: number) => padding.left + (i / (points.length - 1)) * plotW;
  const yFor = (avg: number) => padding.top + plotH - (avg / maxAvg) * plotH;

  const active = hovered !== null ? points[hovered] : null;

  return (
    <section className="glossy rounded-lg border border-border bg-surface p-5">
      <h2 className="font-heading text-lg font-semibold uppercase tracking-wide text-white">Season Trend</h2>
      <p className="mt-1 text-xs text-foreground/50">Rolling batting average by game</p>

      <div className="relative mt-3">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Season batting average trend">
          {[0, 0.25 * maxAvg, 0.5 * maxAvg, 0.75 * maxAvg, maxAvg].map((v) => (
            <line key={v} x1={padding.left} x2={width - padding.right} y1={yFor(v)} y2={yFor(v)} stroke="#1A3D28" strokeWidth={1} />
          ))}

          {points.slice(1).map((p, i) => {
            const prev = points[i];
            const up = p.rollingAvg >= prev.rollingAvg;
            return (
              <line
                key={p.gameId}
                x1={xFor(i)}
                y1={yFor(prev.rollingAvg)}
                x2={xFor(i + 1)}
                y2={yFor(p.rollingAvg)}
                stroke={up ? "#2ECC71" : "#E24B4A"}
                strokeWidth={2}
              />
            );
          })}

          {points.map((p, i) => (
            <circle
              key={p.gameId}
              cx={xFor(i)}
              cy={yFor(p.rollingAvg)}
              r={hovered === i ? 5 : 3.5}
              fill={i === 0 || p.rollingAvg >= points[i - 1].rollingAvg ? "#2ECC71" : "#E24B4A"}
              stroke="#030A06"
              strokeWidth={1}
              className="cursor-pointer"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
              onClick={() => setHovered((h) => (h === i ? null : i))}
            />
          ))}
        </svg>

        {active && (
          <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-md border border-accent-green/40 bg-[#0D2412] px-2 py-1 text-xs text-white shadow-lg">
            Game {active.gameIndex} vs {active.opponentName} — {active.gameLine}
          </div>
        )}
      </div>

      <p className="mt-1 text-center text-xs text-foreground/50">
        {active ? `${formatAvg(active.rollingAvg)} AVG through game ${active.gameIndex}` : "Hover or tap a point for that game's line"}
      </p>
    </section>
  );
}
