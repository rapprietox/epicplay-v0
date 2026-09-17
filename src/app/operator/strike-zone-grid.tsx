"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
// corners (5x5 grid minus the center 3x3 = 16). Its coordinates fall
// outside 0-100 rather than the 0-100 range being redefined -- see the
// pitches_ball_zone_range migration for why (existing zone_x/zone_y
// values must keep meaning what they always have). RING is the ring's
// thickness in the same 0-100-scaled units as the strike zone; a later
// fix widened it from 100/6 to 100/5 -- exactly a 20% increase
// ((100/5)/(100/6) = 6/5), for bigger tap targets during fast gameplay.
// Widening it doesn't corrupt any historical data: no shipped feature
// buckets by "which of the 16 ring cells" yet (only the 9 strike zones
// are ever aggregated -- zoneIndexFromCoords returns null for anything
// outside 0-100), so the exact ring-cell center coordinate isn't
// load-bearing the way the strike zone's own 0-100 meaning is.
const RING = 100 / 5;
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

// Which of the 5x5 grid's cells a coordinate falls in -- col/row each land
// in 0-4 (1-3 is the strike zone's own thirds, 0/4 are the outer ball-zone
// ring). Exported so the pitch-outcome popup (operator-console.tsx) can
// filter which outcomes make sense for a given tap (Fix: Ball/HBP don't
// exist inside the strike zone; Strike-looking doesn't exist outside it;
// HBP only in specific inside-column/mid-height ring cells) without
// duplicating this grid's own geometry.
export function classifyZone(x: number, y: number): { col: number; row: number; isBallZone: boolean } {
  const col = cellIndex(x);
  const row = cellIndex(y);
  return { col, row, isBallZone: col === 0 || col === 4 || row === 0 || row === 4 };
}

// Ball-zone taps snap to the center of whichever of the 16 ring cells was
// tapped (no need for 9x9 precision out there); strike-zone taps keep the
// existing fine snap.
function snapTap(x: number, y: number): { x: number; y: number } {
  const { col, row, isBallZone } = classifyZone(x, y);
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
  flashKey,
  disabled,
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
  // Fix 5: bumped by the caller (a fresh number, any change triggers it --
  // not a boolean, since a boolean toggled true->true on back-to-back
  // pitches wouldn't re-trigger a CSS animation) after every ball/strike/
  // foul/HBP confirmation. Never bumped for "In Play" -- that transitions
  // straight to the field diagram instead.
  flashKey?: number;
  // Fix 1 (batter handedness): true while the operator hasn't picked a
  // stance yet for an unknown batter -- taps are inert and the grid reads
  // as visually inactive until a stance is chosen.
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isHeatMap = heatMapPitches !== undefined;

  // Fix 1: the popup used to be positioned as a percentage inside this
  // same box -- but the box has overflow-hidden (to clip the SVG/dots to
  // its rounded corners), so any part of the popup that fell outside the
  // ~280x280px grid was silently clipped, not just "off in the page
  // somewhere." tapAnchor captures the tap's real viewport pixel position
  // (from getBoundingClientRect(), per spec) plus which half of the grid
  // it landed in, so the popup can be portaled straight to <body> and
  // positioned with `position: fixed` -- escaping the clipping container
  // entirely -- instead of living inside it.
  const [tapAnchor, setTapAnchor] = useState<{ clientX: number; clientY: number; topHalf: boolean; leftHalf: boolean } | null>(
    null
  );

  function handleTap(e: React.MouseEvent<HTMLDivElement>) {
    if (isHeatMap || disabled) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const fracX = (e.clientX - rect.left) / rect.width;
    const fracY = (e.clientY - rect.top) / rect.height;
    const relX = EXT_MIN + fracX * EXT_SPAN;
    const relY = EXT_MIN + fracY * EXT_SPAN;
    const snapped = snapTap(relX, relY);
    setTapAnchor({ clientX: e.clientX, clientY: e.clientY, topHalf: fracY < 0.5, leftHalf: fracX < 0.5 });
    onTap(snapped.x, snapped.y);
  }

  return (
    <div
      ref={ref}
      onClick={handleTap}
      role={isHeatMap ? undefined : "button"}
      aria-disabled={disabled}
      aria-label={isHeatMap ? "Session heat map -- this game's pitch locations" : "Strike zone and ball zones -- tap to mark pitch location"}
      className={`glossy relative aspect-square w-full max-w-[280px] min-h-[280px] overflow-hidden rounded-md border-2 border-border bg-surface ${
        isHeatMap ? "" : disabled ? "opacity-40" : "cursor-pointer"
      }`}
    >
      <svg viewBox={`${EXT_MIN} ${EXT_MIN} ${EXT_SPAN} ${EXT_SPAN}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
        {/* Ball-zone ring: translucent red background, immediately
            distinct at a glance from the strike zone's green -- per spec. */}
        <rect x={EXT_MIN} y={EXT_MIN} width={EXT_SPAN} height={EXT_SPAN} fill="rgba(226, 75, 74, 0.15)" />
        <rect x={0} y={0} width={100} height={100} fill="#071A0E" />

        {/* Ring cell dividers, continuing the strike-zone column/row
            boundaries out into the ring -- subtle dashed red lines (not
            the strike zone's green/dark-green) reinforcing the same
            distinction. DIVIDERS covers all 4 boundary positions
            (0/33.33/66.67/100) so every ring cell (including corners)
            gets a full edge. */}
        {RING_DIVIDERS.map((pos) => (
          <line key={`ring-v-${pos}`} x1={pos} y1={EXT_MIN} x2={pos} y2={0} stroke="#E24B4A" strokeWidth={0.4} strokeOpacity={0.5} strokeDasharray="1.5,1.5" />
        ))}
        {RING_DIVIDERS.map((pos) => (
          <line key={`ring-v2-${pos}`} x1={pos} y1={100} x2={pos} y2={EXT_MAX} stroke="#E24B4A" strokeWidth={0.4} strokeOpacity={0.5} strokeDasharray="1.5,1.5" />
        ))}
        {RING_DIVIDERS.map((pos) => (
          <line key={`ring-h-${pos}`} x1={EXT_MIN} y1={pos} x2={0} y2={pos} stroke="#E24B4A" strokeWidth={0.4} strokeOpacity={0.5} strokeDasharray="1.5,1.5" />
        ))}
        {RING_DIVIDERS.map((pos) => (
          <line key={`ring-h2-${pos}`} x1={100} y1={pos} x2={EXT_MAX} y2={pos} stroke="#E24B4A" strokeWidth={0.4} strokeOpacity={0.5} strokeDasharray="1.5,1.5" />
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

        {/* Fix 5 (v2): pitch confirmation flash -- a gold-stroked duplicate
            of the strike zone's own grid lines, laid exactly on top and
            keyed by flashKey so it remounts (restarting the CSS animation)
            on every ball/strike/foul/HBP. Only its opacity animates
            (0->1->0->1->0, see .grid-line-flash in globals.css) -- the
            real lines underneath are never recolored, so there's no way
            for this to get "stuck" showing gold. pointer-events: none (via
            the Tailwind class) so it can never intercept a tap, even
            mid-flash. Scoped to the strike zone's own lines, not the
            ball-zone ring's dividers -- those just got their own red
            styling above and flashing them gold too would muddy that. */}
        {!isHeatMap && !!flashKey && (
          <g key={flashKey} className="grid-line-flash pointer-events-none">
            {INNER_LINES.map((pos) => (
              <line key={`flash-v-${pos}`} x1={pos} y1={0} x2={pos} y2={100} stroke="#F0C060" strokeWidth={0.4} />
            ))}
            {INNER_LINES.map((pos) => (
              <line key={`flash-h-${pos}`} x1={0} y1={pos} x2={100} y2={pos} stroke="#F0C060" strokeWidth={0.4} />
            ))}
            {THIRDS.map((pos) => (
              <line key={`flash-V-${pos}`} x1={pos} y1={0} x2={pos} y2={100} stroke="#F0C060" strokeWidth={0.8} />
            ))}
            {THIRDS.map((pos) => (
              <line key={`flash-H-${pos}`} x1={0} y1={pos} x2={100} y2={pos} stroke="#F0C060" strokeWidth={0.8} />
            ))}
            <rect x={0} y={0} width={100} height={100} fill="none" stroke="#F0C060" strokeWidth={1} />
          </g>
        )}
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

      {!isHeatMap && selectedZone && popupContent && tapAnchor && (
        <PopupPortal anchor={tapAnchor}>{popupContent}</PopupPortal>
      )}
    </div>
  );
}

// Below the tap point when it's in the top half of the grid, above it when
// in the bottom half; anchored to the tap's right edge (menu extends left)
// when the tap was in the right half, and vice versa -- per spec. Rendered
// via a portal straight to <body> with `position: fixed` in real viewport
// pixels (not the grid's own percentage space) so the parent's
// overflow-hidden can never clip it. After the first paint, a boundary
// check measures the popup's own rendered rect and nudges it back on-screen
// if it still overflows the viewport (e.g. a tap very close to a screen
// edge) -- a pure CSS heuristic alone can't know the popup's actual size.
function PopupPortal({
  anchor,
  children,
}: {
  anchor: { clientX: number; clientY: number; topHalf: boolean; leftHalf: boolean };
  children: React.ReactNode;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  const [nudge, setNudge] = useState({ dx: 0, dy: 0 });

  useLayoutEffect(() => {
    setNudge({ dx: 0, dy: 0 });
    const el = popupRef.current;
    if (!el) return;
    const margin = 8;
    const rect = el.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    if (rect.left < margin) dx = margin - rect.left;
    else if (rect.right > window.innerWidth - margin) dx = window.innerWidth - margin - rect.right;
    if (rect.top < margin) dy = margin - rect.top;
    else if (rect.bottom > window.innerHeight - margin) dy = window.innerHeight - margin - rect.bottom;
    if (dx !== 0 || dy !== 0) setNudge({ dx, dy });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor.clientX, anchor.clientY, anchor.topHalf, anchor.leftHalf]);

  if (typeof document === "undefined") return null;

  const gap = 8;
  const baseTransform = `translate(${anchor.leftHalf ? "0" : "-100%"}, ${anchor.topHalf ? `${gap}px` : `calc(-100% - ${gap}px)`})`;

  return createPortal(
    <div
      ref={popupRef}
      className="fixed z-50"
      style={{
        left: anchor.clientX,
        top: anchor.clientY,
        transform: `${baseTransform} translate(${nudge.dx}px, ${nudge.dy}px)`,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body
  );
}
