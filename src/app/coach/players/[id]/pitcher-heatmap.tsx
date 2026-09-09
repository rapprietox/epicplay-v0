"use client";

import { useEffect, useMemo, useState } from "react";
import { computeZoneBattingLines, zoneColor, zoneIndexFromCoords, type AtBatWithZone } from "@/lib/heat-map";
import { PITCH_TYPES, STRIKE_OUTCOMES } from "@/lib/count-stats";
import { formatAvg } from "@/lib/stats";
import type { AtBatResult, PitchOutcome, PitchType } from "@/lib/supabase/types";

interface ZonePitchTypeAtBat extends AtBatWithZone {
  result: AtBatResult;
  pitchType: PitchType | null;
}
interface RawPitch {
  pitch_type: PitchType | null;
  zone_x: number | null;
  zone_y: number | null;
  outcome: PitchOutcome;
}

function strikeRateColor(rate: number, total: number): string {
  if (total === 0) return "#1A3D28";
  if (rate >= 0.7) return "#2ECC71";
  if (rate >= 0.5) return "#24A058";
  if (rate >= 0.3) return "#EF9F27";
  return "#173A22";
}

export function PitcherHeatmap({ atBats, pitches }: { atBats: ZonePitchTypeAtBat[]; pitches: RawPitch[] }) {
  const [pitchType, setPitchType] = useState<PitchType>("fastball");
  const [revealed, setRevealed] = useState(false);

  const zoneBattingLines = useMemo(
    () => computeZoneBattingLines(atBats.filter((ab) => ab.pitchType === pitchType)),
    [atBats, pitchType]
  );

  const strikeRateLines = useMemo(() => {
    const totals = Array.from({ length: 9 }, () => ({ strikes: 0, total: 0 }));
    for (const p of pitches) {
      if (p.pitch_type !== pitchType || p.zone_x === null || p.zone_y === null) continue;
      const zone = zoneIndexFromCoords(p.zone_x, p.zone_y);
      totals[zone].total += 1;
      if (STRIKE_OUTCOMES.has(p.outcome)) totals[zone].strikes += 1;
    }
    return totals.map((t) => ({ ...t, rate: t.total > 0 ? t.strikes / t.total : 0 }));
  }, [pitches, pitchType]);

  useEffect(() => {
    setRevealed(false);
    const t = setTimeout(() => setRevealed(true), 50);
    return () => clearTimeout(t);
  }, [pitchType]);

  return (
    <section className="glossy rounded-lg border border-border bg-surface p-5">
      <h2 className="font-heading text-lg font-semibold uppercase tracking-wide text-white">Pitcher Heat Map</h2>
      <p className="mt-1 text-xs text-foreground/50">Where this pitcher throws each pitch type, and how batters respond</p>

      <div className="mt-3 flex flex-wrap gap-1 text-xs">
        {PITCH_TYPES.map((t) => (
          <button
            key={t.value}
            onClick={() => setPitchType(t.value)}
            className={`rounded-full border px-3 py-1 transition ${
              pitchType === t.value ? "border-accent-primary bg-accent-primary/20 text-white" : "border-border text-foreground/50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <p className="text-center text-xs uppercase tracking-wide text-foreground/40">Opponent BA Against</p>
          <div className="mx-auto mt-2 grid w-full max-w-[220px] grid-cols-3 grid-rows-3 gap-1 rounded-md border-2 border-border bg-background p-1">
            {zoneBattingLines.map((line, i) => (
              <div
                key={i}
                className="flex aspect-square flex-col items-center justify-center rounded transition-colors duration-700"
                style={{ backgroundColor: revealed ? zoneColor(line) : "#1A3D28" }}
              >
                {line.ab > 0 ? (
                  <span className="font-heading text-sm font-bold text-background">{formatAvg(line.avg)}</span>
                ) : (
                  <span className="text-[10px] text-foreground/30">—</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-center text-xs uppercase tracking-wide text-foreground/40">Strike Rate by Zone</p>
          <p className="text-center text-[10px] text-foreground/30">
            (strike/foul/in-play share -- not swing-and-miss specifically, see note below)
          </p>
          <div className="mx-auto mt-2 grid w-full max-w-[220px] grid-cols-3 grid-rows-3 gap-1 rounded-md border-2 border-border bg-background p-1">
            {strikeRateLines.map((line, i) => (
              <div
                key={i}
                className="flex aspect-square flex-col items-center justify-center rounded transition-colors duration-700"
                style={{ backgroundColor: revealed ? strikeRateColor(line.rate, line.total) : "#1A3D28" }}
              >
                {line.total > 0 ? (
                  <>
                    <span className="font-heading text-sm font-bold text-background">{Math.round(line.rate * 100)}%</span>
                    <span className="text-[9px] text-background/70">{line.total} pitches</span>
                  </>
                ) : (
                  <span className="text-[10px] text-foreground/30">—</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="mt-4 text-[11px] text-foreground/40">
        Labeled &quot;Strike Rate,&quot; not &quot;Whiff Rate&quot; -- the pitches table records a generic
        &quot;strike&quot; outcome without distinguishing swinging from called strikes, so a true swing-and-miss
        rate isn&apos;t something this data can measure yet.
      </p>
    </section>
  );
}
