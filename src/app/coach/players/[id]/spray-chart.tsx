"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
type View = "lines" | "dots";

const HIT_TYPE_FILTERS: { value: HitTypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "groundball", label: "Ground balls" },
  { value: "linedrive", label: "Line drives" },
  { value: "flyball", label: "Fly balls" },
];

const LINE_CATEGORY_ORDER: LineHitCategory[] = ["flyball", "groundball", "linedrive", "popup", "hr", "other"];

// field-2d.png spray chart batch: at_bats.field_x/field_y are already
// measured as a direct 0-100 percentage against field-2d.png itself --
// that's been true since the fielding-play-logging batch switched the
// operator's own tap-to-mark diagram to this same image (see
// src/app/operator/field-diagram.tsx's own comment on this). They are
// NOT a separate abstract "field coordinate" system that needs mapping
// through the calibration anchors via interpolation -- a dot's x/y can
// be plotted directly as `left: x%, top: y%` on this same image, no math
// needed. The 7 calibration anchors are still genuinely useful here,
// just for a narrower purpose: they're the only source of a real,
// per-team home plate position (calibration.home_plate) for the "Lines"
// view to radiate from, replacing the old hardcoded (50, 92) guess the
// previous SVG-diamond version used. (Historical caveat, inherited from
// that same earlier batch, not newly introduced here: at-bats logged
// before that switch had field_x/field_y measured against the older
// field-diagram.jpg, so very old dots may be a little off against this
// image -- a known, previously-documented limitation, not something
// this batch attempts to retroactively correct.)
export function SprayChart({ dots, fieldCalibration }: { dots: Dot[]; fieldCalibration: FieldCalibrationPoints | null }) {
  const [view, setView] = useState<View>("lines");
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
            {(["lines", "dots"] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => {
                  setSelected(null);
                  setView(v);
                }}
                className={`rounded-full border px-3 py-1 capitalize transition ${
                  view === v ? "border-accent-primary bg-accent-primary/20 text-white" : "border-border text-foreground/50"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        )}
      </div>

      {!fieldCalibration ? (
        <p className="mt-3 rounded-md border border-accent-amber/40 bg-accent-amber/10 px-3 py-2 text-sm text-accent-amber">
          Calibrate your field first —{" "}
          <Link href="/coach/calibrate-field" className="underline hover:text-white">
            /coach/calibrate-field
          </Link>
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
                style={{ backgroundImage: "url('/field-2d.png')", backgroundSize: "cover", backgroundPosition: "center top" }}
              >
                {/* Subtle dark tint so marks read clearly against the photo, matching field-diagram.tsx's own treatment. */}
                <div className="pointer-events-none absolute inset-0" style={{ background: "rgba(0, 0, 0, 0.15)" }} />

                <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
                  {view === "lines"
                    ? filtered.map((d, i) => {
                        const cat = lineHitCategory(d);
                        const color = LINE_HIT_CATEGORY_COLOR[cat];
                        const isHr = cat === "hr";
                        const isSelected = selected === d;
                        return (
                          <g key={i}>
                            <line
                              x1={fieldCalibration.home_plate.x}
                              y1={fieldCalibration.home_plate.y}
                              x2={d.x}
                              y2={d.y}
                              stroke={color}
                              strokeWidth={d.category === "out" ? 1 : 2}
                              strokeLinecap="round"
                              pathLength={1}
                              style={{
                                strokeDasharray: 1,
                                strokeDashoffset: revealed ? 0 : 1,
                                transition: "stroke-dashoffset 0.8s ease-out",
                                transitionDelay: `${Math.min(i, 40) * 20}ms`,
                                filter: isHr ? "drop-shadow(0 0 3px #00FF7F)" : undefined,
                                opacity: isSelected ? 1 : 0.85,
                              }}
                            />
                            <circle
                              cx={d.x}
                              cy={d.y}
                              r={isSelected ? 1.8 : 1}
                              fill={color}
                              stroke={isHr ? "#030A06" : "none"}
                              strokeWidth={isHr ? 0.3 : 0}
                              className="cursor-pointer"
                              style={{
                                opacity: revealed ? 1 : 0,
                                transition: "opacity 0.3s ease-out",
                                transitionDelay: `${Math.min(i, 40) * 20 + 400}ms`,
                                filter: isSelected ? "drop-shadow(0 0 4px #00FF7F)" : undefined,
                              }}
                              onClick={() => setSelected(d === selected ? null : d)}
                            />
                          </g>
                        );
                      })
                    : filtered.map((d, i) => {
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
                      })}
                </svg>
              </div>

              {view === "lines" && breakdown.length > 0 && (
                <div className="absolute bottom-1.5 right-1.5 rounded-md border border-border bg-background/85 px-2 py-1.5 backdrop-blur-sm">
                  {breakdown.map((row) => (
                    <div key={row.category} className="flex items-center gap-1.5 text-[9px] leading-tight text-foreground/70">
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{
                          backgroundColor: LINE_HIT_CATEGORY_COLOR[row.category],
                          boxShadow: row.category === "hr" ? "0 0 3px #00FF7F" : undefined,
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
              {view === "dots" && (
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
