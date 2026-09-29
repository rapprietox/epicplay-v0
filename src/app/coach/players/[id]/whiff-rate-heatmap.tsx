"use client";

import { useEffect, useMemo, useState } from "react";
import { computeZoneWhiffLines, whiffRateColor, ZONE_MAP_PITCH_FILTERS, type WhiffPitch } from "@/lib/heat-map";
import type { PitchType } from "@/lib/supabase/types";
import { ZoneGrid, PitchTypeToggle, type ZoneCell } from "./zone-grid";

type WhiffPitchWithType = WhiffPitch & { pitch_type: PitchType | null };

// Map 2: Swing & Miss Rate by Zone -- higher is worse for the batter
// (opposite color direction from the batting-average heat map), so a
// coach can immediately see where a pitcher should attack. Own
// independent pitch-type toggle (per spec, filtered separately from
// Map 3's).
export function WhiffRateHeatmap({
  pitches,
  title = "Swing & Miss Rate by Zone",
}: {
  pitches: WhiffPitchWithType[];
  title?: string;
}) {
  const [pitchType, setPitchType] = useState<PitchType | "all">("all");
  const [revealed, setRevealed] = useState(false);

  const filtered = useMemo(
    () => (pitchType === "all" ? pitches : pitches.filter((p) => p.pitch_type === pitchType)),
    [pitches, pitchType]
  );
  const lines = useMemo(() => computeZoneWhiffLines(filtered), [filtered]);

  const cells: ZoneCell[] = useMemo(() => {
    const worstRate = Math.max(...lines.filter((l) => l.rate !== null).map((l) => l.rate!), -1);
    return lines.map((line) => ({
      color: whiffRateColor(line),
      primary: line.rate !== null ? `${Math.round(line.rate * 100)}%` : "—",
      secondary: line.swings > 0 ? `${line.swings} swing${line.swings === 1 ? "" : "s"}` : undefined,
      glow: line.rate !== null && line.rate === worstRate && line.rate > 0.5,
    }));
  }, [lines]);

  useEffect(() => {
    setRevealed(false);
    const t = setTimeout(() => setRevealed(true), 50);
    return () => clearTimeout(t);
  }, [pitchType, pitches]);

  return (
    <div>
      <p className="text-center text-xs font-semibold uppercase tracking-wide text-white">{title}</p>
      <p className="text-center text-[10px] text-accent-red/80">Red zones = pitcher should attack here</p>

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
