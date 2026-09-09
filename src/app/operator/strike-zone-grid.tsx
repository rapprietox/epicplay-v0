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
// under pressure" from the base spec. Strike-zone coordinates still land
// in 0-100 (unchanged since Sprint 3/4 -- every historical pitch's
// zone_x/zone_y means exactly this).
const SUB_DIVISIONS = 9;
const CELL = 100 / SUB_DIVISIONS;

function snapToGrid(value: number): number {
  const index = Math.min(SUB_DIVISIONS - 1, Math.max(0, Math.floor(value / CELL)));
  return index * CELL + CELL / 2;
}

const INNER_LINES = Array.from({ length: SUB_DIVISIONS - 1 }, (_, i) => (i + 1) * CELL);
const THIRDS = [100 / 3, (2 * 100) / 3];

// Fix 2: a 16-cell outer "ball zone" ring around the original 9-cell
// strike zone -- 3 zones each on the top/bottom/left/right edges plus 4
// corners (5x5 grid minus the center 3x3 = 16). The ring is deliberately
// narrower than a strike-zone third ("ball zones ... smaller"), and its
// coordinates fall outside 0-100 rather than the 0-100 range being
// redefined -- see the pitches_ball_zone_range migration for why
// (existing zone_x/zone_y values must keep meaning what they always have).
const RING = 100 / 6;
export const EXT_MIN = -RING;
const EXT_MAX = 100 + RING;
const EXT_SPAN = EXT_MAX - EXT_MIN;
const GRID_BOUNDS = [EXT_MIN, 0, THIRDS[0], THIRDS[1], 100, EXT_MAX];
const RING_DIVIDERS = [0, THIRDS[0], THIRDS[1], 100];

function toPct(v: number): number {
  return ((v - EXT_MIN) / EXT_SPAN) * 100;
}

function cellIndex(v: number): number {
  for (let i = 0; i < GRID_BOUNDS.length - 2; i++) {
    if (v < GRID_BOUNDS[i + 1]) return i;
  }
  return GRID_BOUNDS.length - 2;
}

// Ball-zone taps snap to the center of whichever of the 16 ring cells was
// tapped (no need for 9x9 precision out there); strike-zone taps keep the
// existing fine snap.
function snapTap(x: number, y: number): { x: number; y: number } {
  const col = cellIndex(x);
  const row = cellIndex(y);
  const isBallZone = col === 0 || col === 4 || row === 0 || row === 4;
  if (!isBallZone) return { x: snapToGrid(x), y: snapToGrid(y) };
  const cx = Math.round((GRID_BOUNDS[col] + GRID_BOUNDS[col + 1]) / 2 * 100) / 100;
  const cy = Math.round((GRID_BOUNDS[row] + GRID_BOUNDS[row + 1]) / 2 * 100) / 100;
  return { x: cx, y: cy };
}

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
  popupContent,
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
  // Sequential-flow (Fix 4) outcome popup, rendered anchored to
  // selectedZone -- the caller supplies just the menu content, this
  // component owns the percentage-based positioning (same coordinate
  // space as the tap dots) and edge clamping so it never renders off the
  // tap surface.
  popupContent?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isHeatMap = heatMapPitches !== undefined;

  function handleTap(e: React.MouseEvent<HTMLDivElement>) {
    if (isHeatMap) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const relX = EXT_MIN + ((e.clientX - rect.left) / rect.width) * EXT_SPAN;
    const relY = EXT_MIN + ((e.clientY - rect.top) / rect.height) * EXT_SPAN;
    const snapped = snapTap(relX, relY);
    onTap(snapped.x, snapped.y);
  }

  return (
    <div
      ref={ref}
      onClick={handleTap}
      role={isHeatMap ? undefined : "button"}
      aria-label={isHeatMap ? "Session heat map -- this game's pitch locations" : "Strike zone and ball zones -- tap to mark pitch location"}
      className={`glossy relative aspect-square w-full max-w-[280px] min-h-[280px] overflow-hidden rounded-md border-2 border-border bg-surface ${isHeatMap ? "" : "cursor-pointer"}`}
    >
      <svg viewBox={`${EXT_MIN} ${EXT_MIN} ${EXT_SPAN} ${EXT_SPAN}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
        {/* Ball-zone ring: darker background than the strike zone */}
        <rect x={EXT_MIN} y={EXT_MIN} width={EXT_SPAN} height={EXT_SPAN} fill="#04120A" />
        <rect x={0} y={0} width={100} height={100} fill="#071A0E" />

        {/* Ring cell dividers, continuing the strike-zone column/row
            boundaries out into the ring -- subtle dashed lines, per spec.
            DIVIDERS covers all 4 boundary positions (0/33.33/66.67/100)
            so every ring cell (including corners) gets a full edge. */}
        {RING_DIVIDERS.map((pos) => (
          <line key={`ring-v-${pos}`} x1={pos} y1={EXT_MIN} x2={pos} y2={0} stroke="#1A3D28" strokeWidth={0.4} strokeDasharray="1.5,1.5" />
        ))}
        {RING_DIVIDERS.map((pos) => (
          <line key={`ring-v2-${pos}`} x1={pos} y1={100} x2={pos} y2={EXT_MAX} stroke="#1A3D28" strokeWidth={0.4} strokeDasharray="1.5,1.5" />
        ))}
        {RING_DIVIDERS.map((pos) => (
          <line key={`ring-h-${pos}`} x1={EXT_MIN} y1={pos} x2={0} y2={pos} stroke="#1A3D28" strokeWidth={0.4} strokeDasharray="1.5,1.5" />
        ))}
        {RING_DIVIDERS.map((pos) => (
          <line key={`ring-h2-${pos}`} x1={100} y1={pos} x2={EXT_MAX} y2={pos} stroke="#1A3D28" strokeWidth={0.4} strokeDasharray="1.5,1.5" />
        ))}

        {/* Strike-zone interior */}
        {INNER_LINES.map((pos) => (
          <line key={`v-${pos}`} x1={pos} y1={0} x2={pos} y2={100} stroke="#1A3D28" strokeWidth={0.4} />
        ))}
        {INNER_LINES.map((pos) => (
          <line key={`h-${pos}`} x1={0} y1={pos} x2={100} y2={pos} stroke="#1A3D28" strokeWidth={0.4} />
        ))}
        {THIRDS.map((pos) => (
          <line key={`V-${pos}`} x1={pos} y1={0} x2={pos} y2={100} stroke="#2ECC71" strokeWidth={0.8} opacity={0.6} />
        ))}
        {THIRDS.map((pos) => (
          <line key={`H-${pos}`} x1={0} y1={pos} x2={100} y2={pos} stroke="#2ECC71" strokeWidth={0.8} opacity={0.6} />
        ))}

        {/* Strike-zone boundary -- separates it from the ball-zone ring */}
        <rect x={0} y={0} width={100} height={100} fill="none" stroke="#2ECC71" strokeWidth={1} opacity={0.85} />
      </svg>

      {isHeatMap
        ? heatMapPitches
            .filter((p): p is ZonePitch & { zone_x: number; zone_y: number } => p.zone_x !== null && p.zone_y !== null)
            .map((p, i) => (
              <span
                key={i}
                className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-80"
                style={{ left: `${toPct(p.zone_x)}%`, top: `${toPct(p.zone_y)}%`, backgroundColor: OUTCOME_COLOR[p.outcome] }}
              />
            ))
        : pendingPitches
            .filter((p): p is ZonePitch & { zone_x: number; zone_y: number } => p.zone_x !== null && p.zone_y !== null)
            .map((p, i) => (
              <span
                key={i}
                className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-60"
                style={{ left: `${toPct(p.zone_x)}%`, top: `${toPct(p.zone_y)}%`, backgroundColor: OUTCOME_COLOR[p.outcome] }}
              />
            ))}

      {!isHeatMap && selectedZone && (
        <span
          className="glow-green pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent-green bg-accent-green/40"
          style={{ left: `${toPct(selectedZone.x)}%`, top: `${toPct(selectedZone.y)}%` }}
        />
      )}
      {!isHeatMap && lastPitchZone && (
        <span
          className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background"
          style={{
            left: `${toPct(lastPitchZone.x)}%`,
            top: `${toPct(lastPitchZone.y)}%`,
            backgroundColor: OUTCOME_COLOR[lastPitchZone.outcome],
          }}
        />
      )}

      {!isHeatMap && selectedZone && popupContent && (
        <div
          className="absolute z-10"
          style={{
            left: `${toPct(selectedZone.x)}%`,
            top: `${toPct(selectedZone.y)}%`,
            transform: `translate(${toPct(selectedZone.x) > 55 ? "-100%" : "0%"}, ${toPct(selectedZone.y) > 55 ? "-100%" : "0%"})`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {popupContent}
        </div>
      )}
    </div>
  );
}
