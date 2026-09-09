"use client";

import { useEffect, useMemo, useState } from "react";
import {
  SPRAY_CATEGORY_COLOR,
  lineHitCategory,
  LINE_HIT_CATEGORY_COLOR,
  LINE_HIT_CATEGORY_LABEL,
  type SprayDot,
  type LineHitCategory,
} from "@/lib/heat-map";
import type { GameType } from "@/lib/supabase/types";
import { formatGameDate } from "@/lib/dates";

type Dot = SprayDot & { gameType: GameType };
type HitTypeFilter = "all" | "groundball" | "linedrive" | "flyball";
type GameTypeFilter = "all" | "season" | "playoff";
type View = "lines" | "zones";

const HIT_TYPE_FILTERS: { value: HitTypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "groundball", label: "Ground balls" },
  { value: "linedrive", label: "Line drives" },
  { value: "flyball", label: "Fly balls" },
];

const HOME_PLATE = { x: 50, y: 92 };
const LINE_CATEGORY_ORDER: LineHitCategory[] = ["flyball", "groundball", "linedrive", "popup", "hr", "other"];

export function SprayChart({ dots }: { dots: Dot[] }) {
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
        <div className="flex gap-1 text-xs">
          {(["lines", "zones"] as View[]).map((v) => (
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
      </div>

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
          <svg viewBox="0 0 100 100" className="w-full rounded-md border border-border bg-background">
            <path d="M 50 92 L 8 50 A 60 60 0 0 1 92 50 Z" fill="#2D5A1B" stroke="#1A3D28" strokeWidth="0.5" />
            <path d="M 50 92 L 28 70 A 32 32 0 0 1 72 70 Z" fill="#3A7A25" />
            <path d="M 50 92 L 8 50 M 50 92 L 92 50" stroke="#C8F0D5" strokeWidth="0.4" opacity="0.4" />
            <rect x="35" y="35" width="24" height="24" fill="#A9814B" transform="rotate(45 50 62)" opacity="0.85" />

            {view === "lines"
              ? filtered.map((d, i) => {
                  const cat = lineHitCategory(d);
                  const color = LINE_HIT_CATEGORY_COLOR[cat];
                  const isHr = cat === "hr";
                  const isSelected = selected === d;
                  return (
                    <g key={i}>
                      <line
                        x1={HOME_PLATE.x}
                        y1={HOME_PLATE.y}
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
              : filtered.map((d, i) => (
                  <circle
                    key={i}
                    cx={d.x}
                    cy={d.y}
                    r={selected === d ? 2.4 : 1.6}
                    fill={SPRAY_CATEGORY_COLOR[d.category]}
                    stroke={d.category === "hr" ? "#030A06" : "none"}
                    strokeWidth={d.category === "hr" ? 0.3 : 0}
                    className="cursor-pointer transition-all"
                    style={selected === d ? { filter: "drop-shadow(0 0 4px #00FF7F)" } : undefined}
                    onClick={() => setSelected(d === selected ? null : d)}
                  />
                ))}
          </svg>

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
          {view === "zones" && (
            <div className="flex flex-wrap gap-3 text-[11px] text-foreground/50">
              <LegendDot color={SPRAY_CATEGORY_COLOR.hit} label="Hit" />
              <LegendDot color={SPRAY_CATEGORY_COLOR.out} label="Out" />
              <LegendDot color={SPRAY_CATEGORY_COLOR.xbh} label="Extra-base hit" />
              <LegendDot color={SPRAY_CATEGORY_COLOR.hr} label="HR" />
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
