"use client";

import { useEffect, useMemo, useState } from "react";
import { computeZoneLocationLines, pitchLocationColor, ZONE_MAP_PITCH_FILTERS, type LocationPitch } from "@/lib/heat-map";
import type { PitchType } from "@/lib/supabase/types";
import { ZoneGrid, PitchTypeToggle, type ZoneCell } from "./zone-grid";

type LocationPitchWithType = LocationPitch & { pitch_type: PitchType | null };

// Map 3: Pitch Location Tendency -- frequency, not outcome. Where
// pitches actually get thrown against this batter (or, at team scale,
// against the whole lineup). Own independent pitch-type toggle.
export function PitchLocationHeatmap({
  pitches,
  title = "Pitch Location Tendency",
}: {
  pitches: LocationPitchWithType[];
  title?: string;
}) {
  const [pitchType, setPitchType] = useState<PitchType | "all">("all");
  const [revealed, setRevealed] = useState(false);

  const filtered = useMemo(
    () => (pitchType === "all" ? pitches : pitches.filter((p) => p.pitch_type === pitchType)),
    [pitches, pitchType]
  );
  const lines = useMemo(() => computeZoneLocationLines(filtered), [filtered]);

  const cells: ZoneCell[] = useMemo(
    () =>
      lines.map((line) => ({
        color: pitchLocationColor(line),
        primary: line.count > 0 ? `${Math.round(line.pct)}%` : "—",
        secondary: line.count > 0 ? `${line.count} pitch${line.count === 1 ? "" : "es"}` : undefined,
        glow: line.pct >= 36,
      })),
    [lines]
  );

  useEffect(() => {
    setRevealed(false);
    const t = setTimeout(() => setRevealed(true), 50);
    return () => clearTimeout(t);
  }, [pitchType, pitches]);

  return (
    <div>
      <p className="text-center text-xs font-semibold uppercase tracking-wide text-white">{title}</p>
      <p className="text-center text-[10px] text-accent-gold/80">Gold zones = pitcher targets here most{title.startsWith("Team") ? " against us" : " against this batter"}</p>

      <div className="mt-2">
        <PitchTypeToggle options={ZONE_MAP_PITCH_FILTERS} value={pitchType} onChange={setPitchType} />
      </div>

      <div className="mt-3">
        <ZoneGrid cells={cells} revealed={revealed} />
      </div>

      <p className="mt-2 text-center text-[9px] text-foreground/30">Location only -- not tied to the result of the at-bat</p>
    </div>
  );
}
