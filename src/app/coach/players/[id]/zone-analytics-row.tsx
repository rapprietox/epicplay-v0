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
//
// Pitcher-maps batch: reused as-is for the pitcher's own zone row
// (per that request's own "reuse if possible") via `perspective` --
// Map 1's data is "opponent BA against this pitcher" instead of "this
// batter's own average" (computeZoneBattingLines works either way, it's
// just fed pitching-mode zone at-bats instead of hitting-mode ones by
// the caller), and Maps 2/3 switch to the green/amber pitcher-favorable
// color scales instead of the batter ones. zoneColor itself needs no
// perspective switch -- a low average is a good outcome for whoever's
// pitching either way, so its existing dark-green/gold scale already
// reads correctly in both directions.
export function ZoneAnalyticsRow({
  battingAvgLines,
  whiffPitches,
  locationPitches,
  namePrefix = "",
  perspective = "batter",
}: {
  battingAvgLines: ZoneBattingLine[];
  whiffPitches: WhiffPitchInput[];
  locationPitches: LocationPitchInput[];
  namePrefix?: string;
  perspective?: "batter" | "pitcher";
}) {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    setRevealed(false);
    const t = setTimeout(() => setRevealed(true), 50);
    return () => clearTimeout(t);
  }, [battingAvgLines]);

  const map1Title = perspective === "pitcher" ? "Opponent BA vs Pitcher" : "Batting Average by Zone";
  const map1Subtitle =
    perspective === "pitcher" ? "Where opposing batters do the most damage against this pitcher" : "Where this batter does the most damage";
  const map2Title = perspective === "pitcher" ? "Whiff Rate by Zone" : "Swing & Miss Rate by Zone";

  return (
    <section className="glossy rounded-lg border border-border bg-surface p-5">
      <h2 className="font-heading text-lg font-semibold uppercase tracking-wide text-white">
        {namePrefix}
        {perspective === "pitcher" ? "Pitcher " : ""}Zone Analytics
      </h2>
      <p className="mt-1 text-xs text-foreground/50">
        {perspective === "pitcher"
          ? "Opponent average against, whiff rate, and this pitcher's own location tendency, side by side"
          : "Batting average, swing-and-miss rate, and pitch-location tendency, side by side"}
      </p>

      {/* Player-Clubhouse alignment batch, Fix 4: 1 column on mobile, 2 on
          tablet, 3 on desktop, per spec -- items-stretch so all three
          cards share the row's tallest height. Map 1 (inline below, a
          plain 3x3 grid -- there's no ring for a batting-average-by-zone
          stat) previously used its own 220px grid with no toggle row,
          which put its actual grid several pixels higher than Map 2/3's
          (280x320 ZoneGrid, preceded by a PitchTypeToggle row). It now
          mirrors that exact structure -- title, subtitle, an invisible
          spacer the same height as PitchTypeToggle's rendered row, then
          a 280x320-framed grid -- so all three titles, toggle rows, and
          grids land at the same vertical position across columns. */}
      <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 items-stretch">
        <div className="flex h-full flex-col">
          <p className="text-center text-xs font-semibold uppercase tracking-wide text-white">{map1Title}</p>
          <p className="text-center text-[10px] text-foreground/40">{map1Subtitle}</p>
          <div className="mt-2 h-[26px]" aria-hidden="true" />
          <div className="mt-3">
            <div
              className="mx-auto grid w-full max-w-[280px] grid-cols-3 grid-rows-3 gap-[3px] rounded-md border-2 border-border bg-background p-1"
              style={{ minHeight: 320 }}
            >
              {battingAvgLines.map((line, i) => (
                <div
                  key={i}
                  className="flex h-full w-full flex-col items-center justify-center rounded transition-colors duration-700"
                  style={{ backgroundColor: revealed ? zoneColor(line) : "#1A3D28" }}
                >
                  {line.ab > 0 ? (
                    <>
                      <span className="font-heading text-[13px] font-bold text-background">{formatAvg(line.avg)}</span>
                      <span className="text-[9px] text-background/70">{line.ab} AB</span>
                    </>
                  ) : (
                    <span className="text-[10px] text-foreground/30">—</span>
                  )}
                </div>
              ))}
            </div>
          </div>
          <p className="mt-2 text-center text-[9px] text-foreground/30">Zoned by the last pitch of each at-bat -- ring not applicable</p>
        </div>

        <WhiffRateHeatmap pitches={whiffPitches} title={`${namePrefix}${map2Title}`} perspective={perspective} />
        <PitchLocationHeatmap pitches={locationPitches} title={`${namePrefix}Pitch Location Tendency`} perspective={perspective} />
      </div>
    </section>
  );
}
