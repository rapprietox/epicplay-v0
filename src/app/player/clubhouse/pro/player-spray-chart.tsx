"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DOT_RESULT_COLOR,
  dotResultCategory,
  lineHitCategory,
  LINE_HIT_CATEGORY_COLOR,
  LINE_HIT_CATEGORY_LABEL,
  type SprayDot,
  type LineHitCategory,
} from "@/lib/heat-map";
import type { FieldCalibrationPoints, GameType } from "@/lib/supabase/types";
import { formatGameDate } from "@/lib/dates";

type Dot = SprayDot & { gameType: GameType };
type HitTypeFilter = "all" | "groundball" | "linedrive" | "flyball";
type GameTypeFilter = "all" | "season" | "playoff";
type View = "2d" | "3d";

const HIT_TYPE_FILTERS: { value: HitTypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "groundball", label: "Ground balls" },
  { value: "linedrive", label: "Line drives" },
  { value: "flyball", label: "Fly balls" },
];

const LINE_CATEGORY_ORDER: LineHitCategory[] = ["flyball", "groundball", "linedrive", "popup", "hr", "other"];

// Five-fixes batch, Fix 5. A forked, player-Clubhouse-only spray chart --
// not a mode on the shared src/app/coach/players/[id]/spray-chart.tsx,
// which stays exactly as it was (its own Lines/Dots toggle, used
// unchanged by the coach's per-player page AND the coach's team-wide
// spray chart in team-analytics.tsx). The 2D/3D split requested here is
// a bigger behavioral fork than that shared component's existing
// hideCalibrationHelpLink prop -- a different background image, a
// different toggle vocabulary (2D/3D vs Lines/Dots), and per-hit-type
// trajectory physics (arc height, glow, animation duration) the coach's
// pages never asked for. Forking avoids bloating the shared component
// with player-only branches and avoids silently changing the coach's
// already-working views.
//
// Trajectory shape per hit type -- ground ball and line drive render as
// straight lines (the spec's own wording for both), fly ball and home
// run as a parabolic arc via a quadratic bezier whose control point is
// offset "up" (toward negative y) from the straight-line midpoint,
// scaled by the shot's own distance so a short and a long fly ball both
// read as a believable arc rather than a fixed pixel bulge. Popup and
// "other" (unknown hit_type) aren't named in the spec -- extrapolated
// from the same LINE_HIT_CATEGORY_COLOR palette the shared Lines view
// already uses: popup gets a small, quick arc (a short, high, harmless
// pop-up), "other" a plain straight line at the same pace as a ground
// ball, the safest default with no real trajectory data to justify a
// curve.
interface TrajectoryStyle {
  color: string;
  durationMs: number;
  arcFactor: number; // 0 = straight line, higher = more bowed arc
  glow: boolean;
}

const TRAJECTORY_STYLE: Record<LineHitCategory, TrajectoryStyle> = {
  groundball: { color: "#EF9F27", durationMs: 300, arcFactor: 0, glow: false },
  linedrive: { color: "#F0C060", durationMs: 300, arcFactor: 0.04, glow: false },
  flyball: { color: "#2ECC71", durationMs: 700, arcFactor: 0.16, glow: false },
  hr: { color: "#F0C060", durationMs: 1000, arcFactor: 0.28, glow: true },
  popup: { color: LINE_HIT_CATEGORY_COLOR.popup, durationMs: 400, arcFactor: 0.12, glow: false },
  other: { color: LINE_HIT_CATEGORY_COLOR.other, durationMs: 300, arcFactor: 0, glow: false },
};

function arcPath(x1: number, y1: number, x2: number, y2: number, arcFactor: number): string {
  if (arcFactor === 0) return `M ${x1},${y1} L ${x2},${y2}`;
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2 - dist * arcFactor;
  return `M ${x1},${y1} Q ${midX},${midY} ${x2},${y2}`;
}

export function PlayerSprayChart({ dots, fieldCalibration }: { dots: Dot[]; fieldCalibration: FieldCalibrationPoints | null }) {
  const [view, setView] = useState<View>("2d");
  const [hitTypeFilter, setHitTypeFilter] = useState<HitTypeFilter>("all");
  const [gameTypeFilter, setGameTypeFilter] = useState<GameTypeFilter>("all");
  const [selected, setSelected] = useState<Dot | null>(null);
  const [revealed, setRevealed] = useState(false);

  const filtered = useMemo(
    () =>
      dots.filter((d) => {
        if (hitTypeFilter !== "all" && d.hitType !== hitTypeFilter) return false;
        if (gameTypeFilter !== "all" && d.gameType !== gameTypeFilter) return false;
        return true;
      }),
    [dots, hitTypeFilter, gameTypeFilter]
  );

  const breakdown = useMemo(() => {
    const counts = new Map<LineHitCategory, number>();
    for (const d of filtered) {
      const cat = lineHitCategory(d);
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    const total = filtered.length;
    return LINE_CATEGORY_ORDER.map((cat) => ({
      category: cat,
      count: counts.get(cat) ?? 0,
      pct: total > 0 ? ((counts.get(cat) ?? 0) / total) * 100 : 0,
    })).filter((row) => row.count > 0);
  }, [filtered]);

  useEffect(() => {
    setRevealed(false);
    const t = setTimeout(() => setRevealed(true), 50);
    return () => clearTimeout(t);
  }, [filtered, view]);

  return (
    <section className="glossy rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-lg font-semibold uppercase tracking-wide text-white">Spray Chart</h2>
          <p className="mt-1 text-xs text-foreground/50">Every ball in play this season, tap a mark for details</p>
        </div>
        {fieldCalibration && (
          <div className="flex gap-1 text-xs">
            <button
              onClick={() => {
                setSelected(null);
                setView("2d");
              }}
              className={`rounded-full border px-3 py-1 transition ${
                view === "2d" ? "border-accent-primary bg-accent-primary/20 text-white" : "border-border text-foreground/50"
              }`}
            >
              2D &middot; Dots
            </button>
            <button
              onClick={() => {
                setSelected(null);
                setView("3d");
              }}
              className={`rounded-full border px-3 py-1 transition ${
                view === "3d" ? "border-accent-primary bg-accent-primary/20 text-white" : "border-border text-foreground/50"
              }`}
            >
              3D &middot; Trajectory
            </button>
          </div>
        )}
      </div>

      {!fieldCalibration ? (
        <p className="mt-3 rounded-md border border-accent-amber/40 bg-accent-amber/10 px-3 py-2 text-sm text-accent-amber">
          Ask your coach to calibrate the field to unlock the spray chart.
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-1 text-xs">
            {HIT_TYPE_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setHitTypeFilter(f.value)}
                className={`rounded-full border px-3 py-1 transition ${
                  hitTypeFilter === f.value ? "border-accent-primary bg-accent-primary/20 text-white" : "border-border text-foreground/50"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1 text-xs">
            {(["all", "season", "playoff"] as GameTypeFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setGameTypeFilter(f)}
                className={`rounded-full border px-3 py-1 capitalize transition ${
                  gameTypeFilter === f ? "border-accent-primary bg-accent-primary/20 text-white" : "border-border text-foreground/50"
                }`}
              >
                {f === "all" ? "All games" : f}
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-col items-center gap-3 sm:flex-row sm:items-start">
            <div className="relative w-full max-w-[320px]">
              <div
                className="relative aspect-square w-full overflow-hidden rounded-md border border-border bg-background"
                style={{
                  backgroundImage: `url('${view === "2d" ? "/field-2d.png" : "/field-3d.png"}')`,
                  backgroundSize: "cover",
                  backgroundPosition: "center top",
                }}
              >
                <div className="pointer-events-none absolute inset-0" style={{ background: "rgba(0, 0, 0, 0.15)" }} />

                <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
                  {view === "2d"
                    ? // 2D view: dots only, per spec -- no lines, no line toggle.
                      filtered.map((d, i) => {
                        const cat = dotResultCategory(d.result);
                        const isHr = cat === "hr";
                        return (
                          <circle
                            key={i}
                            cx={d.x}
                            cy={d.y}
                            r={selected === d ? 2.4 : 1.6}
                            fill={DOT_RESULT_COLOR[cat]}
                            stroke={isHr ? "#030A06" : "none"}
                            strokeWidth={isHr ? 0.3 : 0}
                            className="cursor-pointer transition-all"
                            style={{
                              filter: isHr
                                ? selected === d
                                  ? "drop-shadow(0 0 5px #F0C060)"
                                  : "drop-shadow(0 0 3px #F0C060)"
                                : selected === d
                                  ? "drop-shadow(0 0 4px #00FF7F)"
                                  : undefined,
                            }}
                            onClick={() => setSelected(d === selected ? null : d)}
                          />
                        );
                      })
                    : // 3D view: animated trajectory lines, home plate as origin.
                      filtered.map((d, i) => {
                        const cat = lineHitCategory(d);
                        const style = TRAJECTORY_STYLE[cat];
                        const isSelected = selected === d;
                        const path = arcPath(fieldCalibration.home_plate.x, fieldCalibration.home_plate.y, d.x, d.y, style.arcFactor);
                        return (
                          <g key={i}>
                            <path
                              d={path}
                              fill="none"
                              stroke={style.color}
                              strokeWidth={d.category === "out" ? 1 : 2}
                              strokeLinecap="round"
                              pathLength={1}
                              style={{
                                strokeDasharray: 1,
                                strokeDashoffset: revealed ? 0 : 1,
                                transition: `stroke-dashoffset ${style.durationMs}ms ease-out`,
                                transitionDelay: `${Math.min(i, 40) * 20}ms`,
                                filter: style.glow ? "drop-shadow(0 0 3px #F0C060) drop-shadow(0 0 6px #F0C060)" : undefined,
                                opacity: isSelected ? 1 : 0.85,
                              }}
                            />
                            <circle
                              cx={d.x}
                              cy={d.y}
                              r={isSelected ? 1.8 : 1}
                              fill={style.color}
                              stroke={cat === "hr" ? "#030A06" : "none"}
                              strokeWidth={cat === "hr" ? 0.3 : 0}
                              className="cursor-pointer"
                              style={{
                                opacity: revealed ? 1 : 0,
                                transition: "opacity 0.3s ease-out",
                                transitionDelay: `${Math.min(i, 40) * 20 + style.durationMs}ms`,
                                filter: isSelected ? "drop-shadow(0 0 4px #00FF7F)" : undefined,
                              }}
                              onClick={() => setSelected(d === selected ? null : d)}
                            />
                          </g>
                        );
                      })}
                </svg>
              </div>

              {view === "3d" && breakdown.length > 0 && (
                <div className="absolute bottom-1.5 right-1.5 rounded-md border border-border bg-background/85 px-2 py-1.5 backdrop-blur-sm">
                  {breakdown.map((row) => (
                    <div key={row.category} className="flex items-center gap-1.5 text-[9px] leading-tight text-foreground/70">
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{
                          backgroundColor: LINE_HIT_CATEGORY_COLOR[row.category],
                          boxShadow: row.category === "hr" ? "0 0 3px #F0C060" : undefined,
                        }}
                      />
                      <span>{LINE_HIT_CATEGORY_LABEL[row.category]}</span>
                      <span className="ml-auto pl-2 text-white">{Math.round(row.pct)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex-1">
              {view === "2d" && (
                <div className="flex flex-wrap gap-3 text-[11px] text-foreground/50">
                  <LegendDot color={DOT_RESULT_COLOR.hit} label="Hit" />
                  <LegendDot color={DOT_RESULT_COLOR.hr} label="Home Run" />
                  <LegendDot color={DOT_RESULT_COLOR.out} label="Out" />
                  <LegendDot color={DOT_RESULT_COLOR.error} label="Error" />
                </div>
              )}

              {selected ? (
                <div className="mt-3 rounded-md border border-border bg-background/50 p-3 text-sm">
                  <p className="font-heading text-base font-bold capitalize text-white">{selected.result.replace("_", " ")}</p>
                  <p className="mt-1 text-xs text-foreground/60">
                    Inning {selected.inning} &middot; {selected.gameDate ? formatGameDate(selected.gameDate) : "—"}
                  </p>
                  <p className="text-xs text-foreground/60">vs {selected.opponentName}</p>
                </div>
              ) : (
                <p className="mt-3 text-xs text-foreground/40">Tap a mark to see the play.</p>
              )}
              {filtered.length === 0 && <p className="mt-3 text-xs text-foreground/40">No balls in play match this filter.</p>}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-full border border-border" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
