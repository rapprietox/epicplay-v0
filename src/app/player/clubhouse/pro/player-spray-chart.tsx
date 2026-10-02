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

// Spray-chart batch: a single shared component now used by BOTH the
// coach's per-player page (src/app/coach/players/[id]/player-breakdown-client.tsx)
// and the player's own Clubhouse (src/app/player/clubhouse/pro-section.tsx)
// -- the old coach-only SprayChart (Lines/Dots toggle) has been deleted,
// not kept alongside this one, since coaches asked to see the same
// 2D/Dots-3D/Trajectory view players get rather than maintaining two
// divergent spray charts. The team-wide spray chart in
// src/app/coach/team-analytics.tsx is a separate, simpler inline
// implementation (no 2D/3D toggle) and is unaffected by any of this.
//
// 3D trajectory redesign, v2: "everything is a parabola -- just
// different heights and angles." One quadratic-bezier shape for every
// hit type (parabolaPath below) -- start at home plate, end at the
// landing spot, control point X at the horizontal midpoint, control
// point Y offset "up" from the straight-line midpoint by peakPct * the
// shot's own distance. The earlier version gave ground ball a bespoke
// bounce-bump path and line drive a motion-blur duplicate + end flash;
// both are gone now in favor of one consistent curve family, differing
// only by how high it peaks -- a barely-there 5% bulge for a ground
// ball reads as "almost flat" without needing a separate path shape.
// Home run is still the one exception with its own decoration
// (overshoot + starburst), since "continues past the wall" and "lands
// with an explosion" are genuinely different asks, not just a taller
// version of the same arc.
//
// Popup and "other" (unknown hit_type) aren't named in the spec --
// extrapolated the same way as before: small/modest peak heights with
// no special decoration, the safest default with no real trajectory
// data to justify anything more.
interface TrajectoryStyle {
  color: string;
  durationMs: number;
  strokeWidth: number;
  peakPct: number; // peak height as a fraction of the home-to-landing distance
  overshootFactor: number; // extends the path's endpoint this fraction further past the real landing spot
  glow: string | undefined; // exact CSS filter value, or undefined for no glow
  starburst: boolean;
}

const TRAJECTORY_STYLE: Record<LineHitCategory, TrajectoryStyle> = {
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
  popup: { color: LINE_HIT_CATEGORY_COLOR.popup, durationMs: 400, strokeWidth: 2, peakPct: 0.25, overshootFactor: 0, glow: undefined, starburst: false },
  other: { color: LINE_HIT_CATEGORY_COLOR.other, durationMs: 300, strokeWidth: 2, peakPct: 0.08, overshootFactor: 0, glow: undefined, starburst: false },
};

interface PathResult {
  d: string;
  endX: number;
  endY: number;
}

// The one shape every hit type now shares. overshootFactor (home run
// only) extends the endpoint beyond the real landing coordinate first,
// so the peak then sits centered over the whole dramatized flight --
// the ball/starburst animate to this extended point, while the detail
// panel on click still reports the real at-bat's own data regardless of
// where it's dramatized to land.
function parabolaPath(x1: number, y1: number, x2: number, y2: number, peakPct: number, overshootFactor: number): PathResult {
  const dist = Math.hypot(x2 - x1, y2 - y1) || 1;
  const dirX = (x2 - x1) / dist;
  const dirY = (y2 - y1) / dist;
  const endX = x2 + dirX * dist * overshootFactor;
  const endY = y2 + dirY * dist * overshootFactor;
  const midX = (x1 + endX) / 2;
  const midY = (y1 + endY) / 2 - dist * peakPct;
  return { d: `M ${x1},${y1} Q ${midX},${midY} ${endX},${endY}`, endX, endY };
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

  // 150ms stagger between each trajectory (per spec), capped so a big
  // game log doesn't push the last few plays minutes into the future.
  const delayMsFor = (i: number) => Math.min(i, 20) * 150;

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

                <svg
                  key={`${view}-${hitTypeFilter}-${gameTypeFilter}`}
                  viewBox="0 0 100 100"
                  className="absolute inset-0 h-full w-full"
                  style={
                    view === "3d" ? { transform: "perspective(600px) rotateX(20deg)", transformOrigin: "bottom center" } : undefined
                  }
                >
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
                    : // 3D view: one parabola shape for every hit type, just
                      // a different peak height/angle -- home plate as origin.
                      filtered.map((d, i) => {
                        const cat = lineHitCategory(d);
                        const style = TRAJECTORY_STYLE[cat];
                        const isSelected = selected === d;
                        const home = fieldCalibration.home_plate;
                        const { d: path, endX, endY } = parabolaPath(home.x, home.y, d.x, d.y, style.peakPct, style.overshootFactor);
                        const delayMs = delayMsFor(i);
                        const delaySec = delayMs / 1000;
                        const durationSec = style.durationMs / 1000;
                        const strokeW = d.category === "out" ? Math.max(1, style.strokeWidth - 1) : style.strokeWidth;

                        return (
                          <g key={i} onClick={() => setSelected(d === selected ? null : d)} className="cursor-pointer">
                            <path
                              d={path}
                              fill="none"
                              stroke={style.color}
                              strokeWidth={strokeW}
                              strokeLinecap="round"
                              pathLength={1}
                              style={{
                                strokeDasharray: 1,
                                strokeDashoffset: revealed ? 0 : 1,
                                transition: `stroke-dashoffset ${style.durationMs}ms ease-out`,
                                transitionDelay: `${delayMs}ms`,
                                filter: style.glow,
                                opacity: isSelected ? 1 : 0.9,
                              }}
                            />

                            {/* A very short fading trail behind the ball: 3
                                ghost dots tracing the SAME path, each starting
                                a little later than the real ball so at any
                                instant they sit a little behind it, each more
                                transparent than the last. */}
                            {[0.3, 0.17, 0.08].map((ghostOpacity, gi) => {
                              const ghostDelaySec = delaySec + durationSec * (0.06 * (gi + 1));
                              return (
                                <circle key={`ghost-${gi}`} r={1.6} fill={style.color} opacity={revealed ? ghostOpacity : 0}>
                                  <animateMotion dur={`${durationSec}s`} begin={`${ghostDelaySec}s`} fill="freeze" path={path} />
                                </circle>
                              );
                            })}

                            {/* The ball itself, traveling the path via SMIL
                                animateMotion -- fill="freeze" leaves it
                                sitting at the landing spot once it arrives,
                                doubling as the static landing marker. */}
                            <circle
                              r={isSelected ? 2 : 1.6}
                              fill={style.color}
                              stroke={cat === "hr" ? "#030A06" : "none"}
                              strokeWidth={cat === "hr" ? 0.3 : 0}
                              opacity={revealed ? 1 : 0}
                              style={{
                                transition: "opacity 0.15s ease-out",
                                transitionDelay: `${delayMs}ms`,
                                filter: isSelected ? "drop-shadow(0 0 4px #00FF7F)" : style.glow,
                              }}
                            >
                              <animateMotion dur={`${durationSec}s`} begin={`${delaySec}s`} fill="freeze" path={path} />
                            </circle>

                            {/* Home run: an 8-line radiating starburst once it lands. */}
                            {style.starburst &&
                              Array.from({ length: 8 }).map((_, k) => {
                                const angle = (k / 8) * Math.PI * 2;
                                const len = 3.2;
                                return (
                                  <line
                                    key={k}
                                    x1={endX}
                                    y1={endY}
                                    x2={endX + Math.cos(angle) * len}
                                    y2={endY + Math.sin(angle) * len}
                                    stroke="#F0C060"
                                    strokeWidth={0.6}
                                    strokeLinecap="round"
                                    style={{
                                      animation: revealed
                                        ? `player-spray-starburst 0.45s ease-out ${delaySec + durationSec}s forwards`
                                        : "none",
                                    }}
                                  />
                                );
                              })}
                          </g>
                        );
                      })}
                </svg>
              </div>

              {view === "3d" && breakdown.length > 0 && (
                <div className="absolute bottom-1.5 right-1.5 rounded-md border border-border bg-background/85 px-2 py-1.5 backdrop-blur-sm">
                  {breakdown.map((row) => (
                    <div key={row.category} className="flex items-center gap-1.5 text-[9px] leading-tight text-foreground/70">
                      <svg width="14" height="6" className="shrink-0">
                        <line
                          x1="0"
                          y1="3"
                          x2="14"
                          y2="3"
                          stroke={LINE_HIT_CATEGORY_COLOR[row.category]}
                          strokeWidth={row.category === "hr" ? 3 : 2}
                          strokeLinecap="round"
                          style={row.category === "hr" ? { filter: "drop-shadow(0 0 2px #F0C060)" } : undefined}
                        />
                      </svg>
                      <span>{LINE_HIT_CATEGORY_LABEL[row.category]}</span>
                      <span className="ml-auto pl-2 text-white">
                        {row.count} &middot; {Math.round(row.pct)}%
                      </span>
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

      <style>{`
        @keyframes player-spray-starburst {
          0% { opacity: 0; }
          25% { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>
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
