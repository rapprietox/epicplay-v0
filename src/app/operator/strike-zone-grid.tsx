"use client";

import { useRef } from "react";
import type { PitchOutcome } from "@/lib/supabase/types";

const OUTCOME_COLOR: Record<PitchOutcome, string> = {
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

export function StrikeZoneGrid({
  selectedZone,
  lastPitchZone,
  onTap,
}: {
  selectedZone: { x: number; y: number } | null;
  lastPitchZone: { x: number; y: number; outcome: PitchOutcome } | null;
  onTap: (x: number, y: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  function handleTap(e: React.MouseEvent<HTMLDivElement>) {
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
      role="button"
      aria-label="Strike zone -- tap to mark pitch location"
      className="glossy relative aspect-square w-full max-w-[280px] min-h-[280px] cursor-pointer overflow-hidden rounded-md border-2 border-border bg-surface"
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

      {selectedZone && (
        <span
          className="glow-green pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent-green bg-accent-green/40"
          style={{ left: `${selectedZone.x}%`, top: `${selectedZone.y}%` }}
        />
      )}
      {lastPitchZone && (
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
