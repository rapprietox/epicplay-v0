"use client";

import { useEffect, useMemo, useState } from "react";
import { computeZoneWhiffLines, whiffRateColor, pitcherWhiffRateColor, ZONE_MAP_PITCH_FILTERS, type WhiffPitch } from "@/lib/heat-map";
import type { PitchType } from "@/lib/supabase/types";
import { ZoneGrid, PitchTypeToggle, type ZoneCell } from "./zone-grid";

type WhiffPitchWithType = WhiffPitch & { pitch_type: PitchType | null };

// Map 2: Swing & Miss Rate by Zone. Two perspectives share this
// component (per the pitcher-maps batch's own "reuse if possible"
// instruction) -- the swing/miss math (computeZoneWhiffLines) is
// identical either way, only the color direction and framing text
// differ: "batter" colors high whiff red (bad for the batter, the
// pitcher's opportunity); "pitcher" colors it green (good for the
// pitcher, their own out-pitch zone).
export function WhiffRateHeatmap({
  pitches,
  title = "Swing & Miss Rate by Zone",
  perspective = "batter",
}: {
  pitches: WhiffPitchWithType[];
  title?: string;
  perspective?: "batter" | "pitcher";
}) {
  const [pitchType, setPitchType] = useState<PitchType | "all">("all");
  const [revealed, setRevealed] = useState(false);

  const filtered = useMemo(
    () => (pitchType === "all" ? pitches : pitches.filter((p) => p.pitch_type === pitchType)),
    [pitches, pitchType]
  );
  const lines = useMemo(() => computeZoneWhiffLines(filtered), [filtered]);
  const colorFor = perspective === "pitcher" ? pitcherWhiffRateColor : whiffRateColor;

  const cells: ZoneCell[] = useMemo(
    () =>
      lines.map((line) => ({
        color: colorFor(line),
        primary: line.rate !== null ? `${Math.round(line.rate * 100)}%` : "—",
        secondary: line.swings > 0 ? `${line.swings} swing${line.swings === 1 ? "" : "s"}` : undefined,
        // Top band gets the glow on both perspectives -- per the batter
        // spec's own "51%+ -> bright red" and the pitcher spec's "51%+
        // -> bright green with glow," both treat 51%+ as the extreme
        // band worth calling out, on every qualifying cell (not just the
        // single most extreme one).
        glow: line.rate !== null && line.rate > 0.5,
      })),
    [lines, colorFor]
  );

  useEffect(() => {
    setRevealed(false);
    const t = setTimeout(() => setRevealed(true), 50);
    return () => clearTimeout(t);
  }, [pitchType, pitches]);

  return (
    <div>
      <p className="text-center text-xs font-semibold uppercase tracking-wide text-white">{title}</p>
      <p className={`text-center text-[10px] ${perspective === "pitcher" ? "text-accent-green/80" : "text-accent-red/80"}`}>
        {perspective === "pitcher" ? "Green zones = pitcher's out pitch locations" : "Red zones = pitcher should attack here"}
      </p>

      <div className="mt-2">
        <PitchTypeToggle options={ZONE_MAP_PITCH_FILTERS} value={pitchType} onChange={setPitchType} />
      </div>

      <div className="mt-3">
        <ZoneGrid cells={cells} revealed={revealed} />
      </div>

      <p className="mt-2 text-center text-[9px] text-foreground/30">Minimum 3 swings shown as a rate -- fewer shows &ldquo;—&rdquo;</p>
    </div>
  );
}
