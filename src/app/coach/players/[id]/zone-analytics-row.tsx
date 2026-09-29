"use client";

import { useEffect, useState } from "react";
import { zoneColor, type ZoneBattingLine } from "@/lib/heat-map";
import { formatAvg } from "@/lib/stats";
import { WhiffRateHeatmap } from "./whiff-rate-heatmap";
import { PitchLocationHeatmap } from "./pitch-location-heatmap";
import type { PitchOutcome, PitchType } from "@/lib/supabase/types";

interface WhiffPitchInput {
  swing: boolean | null;
  outcome: PitchOutcome;
  zone_x: number | null;
  zone_y: number | null;
  pitch_type: PitchType | null;
}
interface LocationPitchInput {
  zone_x: number | null;
  zone_y: number | null;
  pitch_type: PitchType | null;
}

// Whiff-rate / pitch-location maps batch: "show all three maps in a row"
// -- one shared section, three compact panels (Map 1's existing 3x3
// batting-average-by-zone grid, restated here without its own toggle to
// match the other two panels' weight; the full, toggleable version with
// the batting/pitching view switch and the friendly/season/playoff
// filter stays exactly where it already was, right above this row, for
// the pitching-side use case this row doesn't cover). Maps 2 and 3 each
// keep their own independent pitch-type toggle, per spec.
export function ZoneAnalyticsRow({
  battingAvgLines,
  whiffPitches,
  locationPitches,
  namePrefix = "",
}: {
  battingAvgLines: ZoneBattingLine[];
  whiffPitches: WhiffPitchInput[];
  locationPitches: LocationPitchInput[];
  namePrefix?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    setRevealed(false);
    const t = setTimeout(() => setRevealed(true), 50);
    return () => clearTimeout(t);
  }, [battingAvgLines]);

  return (
    <section className="glossy rounded-lg border border-border bg-surface p-5">
      <h2 className="font-heading text-lg font-semibold uppercase tracking-wide text-white">{namePrefix}Zone Analytics</h2>
      <p className="mt-1 text-xs text-foreground/50">Batting average, swing-and-miss rate, and pitch-location tendency, side by side</p>

      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div>
          <p className="text-center text-xs font-semibold uppercase tracking-wide text-white">Batting Average by Zone</p>
          <p className="text-center text-[10px] text-foreground/40">Where this batter does the most damage</p>
          <div className="mx-auto mt-3 grid w-full max-w-[220px] grid-cols-3 grid-rows-3 gap-1 rounded-md border-2 border-border bg-background p-1">
            {battingAvgLines.map((line, i) => (
              <div
                key={i}
                className="flex aspect-square flex-col items-center justify-center rounded transition-colors duration-700"
                style={{ backgroundColor: revealed ? zoneColor(line) : "#1A3D28" }}
              >
                {line.ab > 0 ? (
                  <>
                    <span className="font-heading text-sm font-bold text-background">{formatAvg(line.avg)}</span>
                    <span className="text-[9px] text-background/70">{line.ab} AB</span>
                  </>
                ) : (
                  <span className="text-[10px] text-foreground/30">—</span>
                )}
              </div>
            ))}
          </div>
          <p className="mt-2 text-center text-[9px] text-foreground/30">Zoned by the last pitch of each at-bat -- ring not applicable</p>
        </div>

        <WhiffRateHeatmap pitches={whiffPitches} title={`${namePrefix}Swing & Miss Rate by Zone`} />
        <PitchLocationHeatmap pitches={locationPitches} title={`${namePrefix}Pitch Location Tendency`} />
      </div>
    </section>
  );
}
