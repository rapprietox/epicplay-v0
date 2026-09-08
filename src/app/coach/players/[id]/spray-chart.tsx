"use client";

import { useMemo, useState } from "react";
import { SPRAY_CATEGORY_COLOR, type SprayDot } from "@/lib/heat-map";
import type { GameType } from "@/lib/supabase/types";
import { formatGameDate } from "@/lib/dates";

type Dot = SprayDot & { gameType: GameType };
type HitTypeFilter = "all" | "groundball" | "linedrive" | "flyball";
type GameTypeFilter = "all" | "season" | "playoff";

const HIT_TYPE_FILTERS: { value: HitTypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "groundball", label: "Ground balls" },
  { value: "linedrive", label: "Line drives" },
  { value: "flyball", label: "Fly balls" },
];

export function SprayChart({ dots }: { dots: Dot[] }) {
  const [hitTypeFilter, setHitTypeFilter] = useState<HitTypeFilter>("all");
  const [gameTypeFilter, setGameTypeFilter] = useState<GameTypeFilter>("all");
  const [selected, setSelected] = useState<Dot | null>(null);

  const filtered = useMemo(
    () =>
      dots.filter((d) => {
        if (hitTypeFilter !== "all" && d.hitType !== hitTypeFilter) return false;
        if (gameTypeFilter !== "all" && d.gameType !== gameTypeFilter) return false;
        return true;
      }),
    [dots, hitTypeFilter, gameTypeFilter]
  );

  return (
    <section className="glossy rounded-lg border border-border bg-surface p-5">
      <h2 className="font-heading text-lg font-semibold uppercase tracking-wide text-white">Spray Chart</h2>
      <p className="mt-1 text-xs text-foreground/50">Every ball in play this season, tap a dot for details</p>

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
        <svg viewBox="0 0 100 100" className="w-full max-w-[320px] rounded-md border border-border bg-background">
          <path d="M 50 92 L 8 50 A 60 60 0 0 1 92 50 Z" fill="#2D5A1B" stroke="#1A3D28" strokeWidth="0.5" />
          <path d="M 50 92 L 28 70 A 32 32 0 0 1 72 70 Z" fill="#3A7A25" />
          <path d="M 50 92 L 8 50 M 50 92 L 92 50" stroke="#C8F0D5" strokeWidth="0.4" opacity="0.4" />
          <rect x="35" y="35" width="24" height="24" fill="#A9814B" transform="rotate(45 50 62)" opacity="0.85" />

          {filtered.map((d, i) => (
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

        <div className="flex-1">
          <div className="flex flex-wrap gap-3 text-[11px] text-foreground/50">
            <LegendDot color={SPRAY_CATEGORY_COLOR.hit} label="Hit" />
            <LegendDot color={SPRAY_CATEGORY_COLOR.out} label="Out" />
            <LegendDot color={SPRAY_CATEGORY_COLOR.xbh} label="Extra-base hit" />
            <LegendDot color={SPRAY_CATEGORY_COLOR.hr} label="HR" />
          </div>

          {selected ? (
            <div className="mt-3 rounded-md border border-border bg-background/50 p-3 text-sm">
              <p className="font-heading text-base font-bold capitalize text-white">{selected.result.replace("_", " ")}</p>
              <p className="mt-1 text-xs text-foreground/60">
                Inning {selected.inning} &middot; {selected.gameDate ? formatGameDate(selected.gameDate) : "—"}
              </p>
              <p className="text-xs text-foreground/60">vs {selected.opponentName}</p>
            </div>
          ) : (
            <p className="mt-3 text-xs text-foreground/40">Tap a dot to see the play.</p>
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
