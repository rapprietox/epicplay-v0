"use client";

import { useEffect, useMemo, useState } from "react";
import { computeZoneBattingLines, zoneColor, type AtBatWithZone } from "@/lib/heat-map";
import type { GameType } from "@/lib/supabase/types";
import { formatAvg } from "@/lib/stats";

type ZoneAtBat = AtBatWithZone & { gameType: GameType };
type Filter = "all" | "season" | "playoff" | "friendly";

const FILTERS: Filter[] = ["all", "season", "playoff", "friendly"];

export function StrikeZoneHeatmap({
  battingAtBats,
  pitchingAtBats,
  hasPitchingData,
}: {
  battingAtBats: ZoneAtBat[];
  pitchingAtBats: ZoneAtBat[];
  hasPitchingData: boolean;
}) {
  const [view, setView] = useState<"batting" | "pitching">("batting");
  const [filter, setFilter] = useState<Filter>("all");
  const [revealed, setRevealed] = useState(false);

  const source = view === "batting" ? battingAtBats : pitchingAtBats;
  const filtered = useMemo(
    () => (filter === "all" ? source : source.filter((ab) => ab.gameType === filter)),
    [source, filter]
  );
  const lines = useMemo(() => computeZoneBattingLines(filtered), [filtered]);

  useEffect(() => {
    setRevealed(false);
    const t = setTimeout(() => setRevealed(true), 50);
    return () => clearTimeout(t);
  }, [view, filter]);

  return (
    <section className="glossy rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-lg font-semibold uppercase tracking-wide text-white">
          Strike Zone Heat Map
        </h2>
        {hasPitchingData && (
          <div className="flex gap-1 rounded-md border border-border p-1 text-xs">
            {(["batting", "pitching"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded px-3 py-1 capitalize transition ${
                  view === v ? "bg-accent-primary text-white" : "text-foreground/50 hover:text-white"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="mt-1 text-xs text-foreground/50">
        {view === "batting" ? "Batting average by pitch location" : "Opponent batting average against, by pitch location"}
      </p>

      <div className="mt-2 flex flex-wrap gap-1 text-xs">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 capitalize transition ${
              filter === f ? "border-accent-primary bg-accent-primary/20 text-white" : "border-border text-foreground/50"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="mx-auto mt-4 grid w-full max-w-[280px] grid-cols-3 grid-rows-3 gap-1 rounded-md border-2 border-border bg-background p-1">
        {lines.map((line, i) => (
          <div
            key={i}
            className="flex aspect-square flex-col items-center justify-center rounded transition-colors duration-700"
            style={{ backgroundColor: revealed ? zoneColor(line) : "#1A3D28" }}
          >
            {line.ab > 0 ? (
              <>
                <span className="font-heading text-lg font-bold text-background">{formatAvg(line.avg)}</span>
                <span className="text-[10px] text-background/70">{line.ab} AB</span>
              </>
            ) : (
              <span className="text-[10px] text-foreground/30">—</span>
            )}
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap justify-center gap-3 text-[11px] text-foreground/50">
        <LegendSwatch color="#173A22" label=".000–.150" />
        <LegendSwatch color="#EF9F27" label=".151–.299" />
        <LegendSwatch color="#2ECC71" label=".300–.399" />
        <LegendSwatch color="#F0C060" label=".400+" />
      </div>
    </section>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
