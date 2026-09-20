"use client";

import { useRef } from "react";

export function FieldDiagram({
  tap,
  onTap,
}: {
  tap: { x: number; y: number } | null;
  onTap: (x: number, y: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Unchanged from the old SVG version -- same 0-100 coordinate math, same
  // rounding, just read off a div's rect instead of an <svg>'s.
  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    onTap(Math.round(x * 10) / 10, Math.round(y * 10) / 10);
  }

  return (
    <div
      ref={ref}
      onClick={handleClick}
      role="button"
      aria-label="Field diagram -- tap where the ball landed"
      className="relative aspect-square w-full max-w-[360px] cursor-crosshair overflow-hidden rounded-md border border-border bg-background"
      style={{
        // Feature 1 (fielding-play logging batch): switched from the old
        // field-diagram.jpg to field-2d.png -- this is the SAME image the
        // field calibration tool measures its 7 anchor points against, so
        // a tap here now lines up with the zone geometry in
        // lib/field-zones.ts. Tapping against the old, uncalibrated image
        // would have made every auto-suggested fielder wrong. One real
        // consequence: field_x/field_y values logged before this change
        // were measured against field-diagram.jpg's own layout, not
        // field-2d.png's -- they aren't guaranteed to land in the same
        // zone on a re-interpretation, so historical taps predate
        // reliable zone lookup.
        backgroundImage: "url('/field-2d.png')",
        backgroundSize: "cover",
        backgroundPosition: "center top",
      }}
    >
      {/* Subtle dark tint so the gold tap marker below reads clearly
          against a busy photo background. */}
      <div className="pointer-events-none absolute inset-0" style={{ background: "rgba(0, 0, 0, 0.15)" }} />

      {tap && (
        <span
          className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
          style={{ left: `${tap.x}%`, top: `${tap.y}%`, backgroundColor: "#F0C060", borderColor: "#030A06" }}
        />
      )}
    </div>
  );
}
