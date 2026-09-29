"use client";

import { useEffect, useMemo, useState } from "react";
import { computeZoneLocationLines, pitchLocationColor, pitcherLocationColor, ZONE_MAP_PITCH_FILTERS, type LocationPitch } from "@/lib/heat-map";
import type { PitchType } from "@/lib/supabase/types";
import { ZoneGrid, PitchTypeToggle, type ZoneCell } from "./zone-grid";

type LocationPitchWithType = LocationPitch & { pitch_type: PitchType | null };

// Map 3: Pitch Location Tendency -- frequency, not outcome. Shared
// between the batter page ("where do pitchers attack this batter") and
// the pitcher page ("does this pitcher telegraph his own locations") --
// same computeZoneLocationLines math, a distinct amber-toned palette for
// the pitcher perspective (pitcherLocationColor) so the two contexts
// read as visually distinct, and framing text that names whose tendency
// is being shown.
export function PitchLocationHeatmap({
  pitches,
  title = "Pitch Location Tendency",
  perspective = "batter",
}: {
  pitches: LocationPitchWithType[];
  title?: string;
  perspective?: "batter" | "pitcher";
}) {
  const [pitchType, setPitchType] = useState<PitchType | "all">("all");
  const [revealed, setRevealed] = useState(false);

  const filtered = useMemo(
    () => (pitchType === "all" ? pitches : pitches.filter((p) => p.pitch_type === pitchType)),
    [pitches, pitchType]
  );
  const lines = useMemo(() => computeZoneLocationLines(filtered), [filtered]);
  const colorFor = perspective === "pitcher" ? pitcherLocationColor : pitchLocationColor;

  const cells: ZoneCell[] = useMemo(
    () =>
      lines.map((line) => ({
        color: colorFor(line),
        primary: line.count > 0 ? `${Math.round(line.pct)}%` : "—",
        secondary: line.count > 0 ? `${line.count} pitch${line.count === 1 ? "" : "es"}` : undefined,
        glow: line.pct >= 36,
      })),
    [lines, colorFor]
  );

  useEffect(() => {
    setRevealed(false);
    const t = setTimeout(() => setRevealed(true), 50);
    return () => clearTimeout(t);
  }, [pitchType, pitches]);

  const subtitle =
    perspective === "pitcher"
      ? "Gold zones = pitcher throws here most — is he predictable?"
      : `Gold zones = pitcher targets here most${title.startsWith("Team") ? " against us" : " against this batter"}`;

  return (
    <div>
      <p className="text-center text-xs font-semibold uppercase tracking-wide text-white">{title}</p>
      <p className="text-center text-[10px] text-accent-gold/80">{subtitle}</p>

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
