"use client";

import { useRef } from "react";
import type { PitchOutcome } from "@/lib/supabase/types";

export const OUTCOME_COLOR: Record<PitchOutcome, string> = {
  ball: "#24A058",
  strike: "#E24B4A",
  foul: "#EF9F27",
  hbp: "#B060F0",
  inplay: "#2ECC71",
};

// Visually subdivided into a 9x9 grid (81 zones) for more precise tap
// location within each of the 3 main thirds, while staying a single large
// tap surface (not 81 individual buttons) -- the whole ~280x280 box is one
// tap target, satisfying "large tap targets, operator is tapping fast
// under pressure" from the base spec. Coordinates still land in 0-100.
const SUB_DIVISIONS = 9;
const CELL = 100 / SUB_DIVISIONS;

function snapToGrid(value: number): number {
  const index = Math.min(SUB_DIVISIONS - 1, Math.max(0, Math.floor(value / CELL)));
  return index * CELL + CELL / 2;
}

const INNER_LINES = Array.from({ length: SUB_DIVISIONS - 1 }, (_, i) => (i + 1) * CELL);
const OUTER_LINES = [100 / 3, (2 * 100) / 3];

interface ZonePitch {
  zone_x: number | null;
  zone_y: number | null;
  outcome: PitchOutcome;
}

export function StrikeZoneGrid({
  selectedZone,
  lastPitchZone,
  pendingPitches = [],
  heatMapPitches,
  onTap,
}: {
  selectedZone: { x: number; y: number } | null;
  lastPitchZone: { x: number; y: number; outcome: PitchOutcome } | null;
  // The current at-bat's pitch sequence so far -- shown as small dots
  // building up in real time. Omitted (or empty) outside logging mode.
  pendingPitches?: ZonePitch[];
  // When set, renders session heat map mode instead of logging mode: every
  // pitch location logged so far this game, colored by outcome, and tap
  // capture is disabled (this is a read-only view).
  heatMapPitches?: ZonePitch[];
  onTap: (x: number, y: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isHeatMap = heatMapPitches !== undefined;

  function handleTap(e: React.MouseEvent<HTMLDivElement>) {
    if (isHeatMap) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const relX = ((e.clientX - rect.left) / rect.width) * 100;
    const relY = ((e.clientY - rect.top) / rect.height) * 100;
    onTap(snapToGrid(relX), snapToGrid(relY));
  }

  return (
    <div
      ref={ref}
      onClick={handleTap}
      role={isHeatMap ? undefined : "button"}
      aria-label={isHeatMap ? "Session heat map -- this game's pitch locations" : "Strike zone -- tap to mark pitch location"}
      className={`glossy relative aspect-square w-full max-w-[280px] min-h-[280px] overflow-hidden rounded-md border-2 border-border bg-surface ${isHeatMap ? "" : "cursor-pointer"}`}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
        {INNER_LINES.map((pos) => (
          <line key={`v-${pos}`} x1={pos} y1={0} x2={pos} y2={100} stroke="#1A3D28" strokeWidth={0.4} />
        ))}
        {INNER_LINES.map((pos) => (
          <line key={`h-${pos}`} x1={0} y1={pos} x2={100} y2={pos} stroke="#1A3D28" strokeWidth={0.4} />
        ))}
        {OUTER_LINES.map((pos) => (
          <line key={`V-${pos}`} x1={pos} y1={0} x2={pos} y2={100} stroke="#2ECC71" strokeWidth={0.8} opacity={0.6} />
        ))}
        {OUTER_LINES.map((pos) => (
          <line key={`H-${pos}`} x1={0} y1={pos} x2={100} y2={pos} stroke="#2ECC71" strokeWidth={0.8} opacity={0.6} />
        ))}
      </svg>

      {isHeatMap
        ? heatMapPitches
            .filter((p): p is ZonePitch & { zone_x: number; zone_y: number } => p.zone_x !== null && p.zone_y !== null)
            .map((p, i) => (
              <span
                key={i}
                className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-80"
                style={{ left: `${p.zone_x}%`, top: `${p.zone_y}%`, backgroundColor: OUTCOME_COLOR[p.outcome] }}
              />
            ))
        : pendingPitches
            .filter((p): p is ZonePitch & { zone_x: number; zone_y: number } => p.zone_x !== null && p.zone_y !== null)
            .map((p, i) => (
              <span
                key={i}
                className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-60"
                style={{ left: `${p.zone_x}%`, top: `${p.zone_y}%`, backgroundColor: OUTCOME_COLOR[p.outcome] }}
              />
            ))}

      {!isHeatMap && selectedZone && (
        <span
          className="glow-green pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent-green bg-accent-green/40"
          style={{ left: `${selectedZone.x}%`, top: `${selectedZone.y}%` }}
        />
      )}
      {!isHeatMap && lastPitchZone && (
        <span
          className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background"
          style={{
            left: `${lastPitchZone.x}%`,
            top: `${lastPitchZone.y}%`,
            backgroundColor: OUTCOME_COLOR[lastPitchZone.outcome],
          }}
        />
      )}
    </div>
  );
}
