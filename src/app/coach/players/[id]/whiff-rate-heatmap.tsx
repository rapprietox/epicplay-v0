"use client";

import { useEffect, useMemo, useState } from "react";
import {
  computeZoneWhiffLines,
  computeZoneDamageLines,
  whiffRateColor,
  pitcherWhiffRateColor,
  damageRateColor,
  ZONE_MAP_PITCH_FILTERS,
  type WhiffPitch,
} from "@/lib/heat-map";
import type { PitchType } from "@/lib/supabase/types";
import { ZoneGrid, PitchTypeToggle, type ZoneCell } from "./zone-grid";

// isDamage is optional -- only ever populated (and only ever read) when
// perspective === "pitcher"; a batter-perspective caller never computes
// it and the Damage Rate toggle never renders there, so it's fine left
// undefined on that path.
type WhiffPitchWithType = WhiffPitch & { pitch_type: PitchType | null; isDamage?: boolean };

// Map 2: Swing & Miss Rate by Zone, plus (pitcher perspective only) a
// Damage Rate toggle -- same component, same pitch-type filter, same
// grid, a second calculation over the same filtered pitches (per spec:
// "same component, different calculation"). Two perspectives already
// shared this component before the toggle existed -- the swing/miss math
// (computeZoneWhiffLines) is identical either way, only the color
// direction and framing text differ: "batter" colors high whiff red (bad
// for the batter, the pitcher's opportunity); "pitcher" colors it green
// (good for the pitcher, their own out-pitch zone).
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
  const [metric, setMetric] = useState<"whiff" | "damage">("whiff");
  const [revealed, setRevealed] = useState(false);

  const filtered = useMemo(
    () => (pitchType === "all" ? pitches : pitches.filter((p) => p.pitch_type === pitchType)),
    [pitches, pitchType]
  );
  const showDamage = perspective === "pitcher" && metric === "damage";

  const whiffLines = useMemo(() => computeZoneWhiffLines(filtered), [filtered]);
  const damageLines = useMemo(
    () => computeZoneDamageLines(filtered.map((p) => ({ zone_x: p.zone_x, zone_y: p.zone_y, isDamage: p.isDamage ?? false }))),
    [filtered]
  );
  const whiffColorFor = perspective === "pitcher" ? pitcherWhiffRateColor : whiffRateColor;

  const cells: ZoneCell[] = useMemo(() => {
    if (showDamage) {
      return damageLines.map((line) => ({
        color: damageRateColor(line),
        primary: line.rate !== null ? `${Math.round(line.rate * 100)}%` : "—",
        secondary: line.total > 0 ? `${line.total} pitch${line.total === 1 ? "" : "es"}` : undefined,
        glow: line.rate !== null && line.rate > 0.4,
      }));
    }
    return whiffLines.map((line) => ({
      color: whiffColorFor(line),
      primary: line.rate !== null ? `${Math.round(line.rate * 100)}%` : "—",
      secondary: line.swings > 0 ? `${line.swings} swing${line.swings === 1 ? "" : "s"}` : undefined,
      // Top band gets the glow on both perspectives -- per the batter
      // spec's own "51%+ -> bright red" and the pitcher spec's "51%+
      // -> bright green with glow," both treat 51%+ as the extreme
      // band worth calling out, on every qualifying cell (not just the
      // single most extreme one).
      glow: line.rate !== null && line.rate > 0.5,
    }));
  }, [showDamage, damageLines, whiffLines, whiffColorFor]);

  useEffect(() => {
    setRevealed(false);
    const t = setTimeout(() => setRevealed(true), 50);
    return () => clearTimeout(t);
  }, [pitchType, metric, pitches]);

  const displayTitle = showDamage ? "Damage Rate by Zone" : title;
  const subtitle = showDamage
    ? "Green zones = safe, red zones = dangerous contact allowed"
    : perspective === "pitcher"
      ? "Green zones = pitcher's out pitch locations"
      : "Red zones = pitcher should attack here";
  const subtitleColor = showDamage ? "text-accent-red/80" : perspective === "pitcher" ? "text-accent-green/80" : "text-accent-red/80";

  return (
    <div>
      <p className="text-center text-xs font-semibold uppercase tracking-wide text-white">{displayTitle}</p>
      <p className={`text-center text-[10px] ${subtitleColor}`}>{subtitle}</p>

      {perspective === "pitcher" && (
        <div className="mt-2 flex justify-center gap-1 text-xs">
          {(["whiff", "damage"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`rounded-full border px-2.5 py-1 font-semibold uppercase tracking-wide transition ${
                metric === m ? "border-accent-gold bg-accent-gold/20 text-white" : "border-border text-foreground/50"
              }`}
            >
              {m === "whiff" ? "Whiff Rate" : "Damage Rate"}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2">
        <PitchTypeToggle options={ZONE_MAP_PITCH_FILTERS} value={pitchType} onChange={setPitchType} />
      </div>

      <div className="mt-3">
        <ZoneGrid cells={cells} revealed={revealed} />
      </div>

      <p className="mt-2 text-center text-[9px] text-foreground/30">
        {showDamage ? "Minimum 3 pitches shown as a rate" : "Minimum 3 swings shown as a rate"} -- fewer shows &ldquo;—&rdquo;
      </p>
    </div>
  );
}
