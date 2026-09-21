"use client";

import { useMemo, useRef, useState } from "react";
import type { FieldCalibrationPoints, FieldType, PlayerPositionCalibration } from "@/lib/supabase/types";
import { saveFieldCalibration } from "./actions";

type Point = { x: number; y: number };
// Change 1 (calibrate-field-tabs batch): CalibrationImage is now generic
// over an arbitrary ordered point set, keyed by plain strings -- tab 3
// ("Player Positions") has a completely different shape from tabs 1-2
// (10 named positions, 9 required + 1 optional, vs. 7 always-required
// field anchors), and duplicating the whole click/drag/reset/save UI a
// second time for it would have meant keeping two copies in sync by
// hand. Each tab still builds its own strongly-typed payload before
// calling saveFieldCalibration, so the generic string-keyed state here
// never leaks into the saved shape.
type PointsState = Record<string, Point | null>;

interface PointDef {
  key: string;
  label: string;
  hint: string;
  color: string;
  optional?: boolean;
}

// Click order, per spec, exactly -- CF between LF and RF (not the order
// the JSON example in the request happened to list its keys in, which
// doesn't matter since it's a plain object with no inherent ordering).
const FIELD_POINT_ORDER: PointDef[] = [
  { key: "home_plate", label: "Home Plate", hint: "", color: "#F0C060" },
  { key: "first_base", label: "First Base", hint: "", color: "#2ECC71" },
  { key: "second_base", label: "Second Base", hint: "", color: "#24A058" },
  { key: "third_base", label: "Third Base", hint: "", color: "#1A6B3C" },
  { key: "lf_wall", label: "Left Field Wall", hint: "end of left foul line", color: "#E24B4A" },
  { key: "cf_wall", label: "Center Field Wall", hint: "deepest point", color: "#B060F0" },
  { key: "rf_wall", label: "Right Field Wall", hint: "end of right foul line", color: "#EF9F27" },
];

// Change 1: tab 3's 10 points, in the exact order given -- 9 required
// (real defensive positions, replacing lib/field-zones.ts's
// formula-based guesses with hand-placed truth) plus one optional DH/EH
// spot at the end.
const POSITION_POINT_ORDER: PointDef[] = [
  { key: "P", label: "Pitcher", hint: "", color: "#F0C060" },
  { key: "C", label: "Catcher", hint: "", color: "#2ECC71" },
  { key: "1B", label: "First Baseman", hint: "", color: "#24A058" },
  { key: "2B", label: "Second Baseman", hint: "", color: "#1A6B3C" },
  { key: "3B", label: "Third Baseman", hint: "", color: "#E24B4A" },
  { key: "SS", label: "Shortstop", hint: "", color: "#B060F0" },
  { key: "LF", label: "Left Fielder", hint: "", color: "#EF9F27" },
  { key: "CF", label: "Center Fielder", hint: "", color: "#4AA8E2" },
  { key: "RF", label: "Right Fielder", hint: "", color: "#E24BAF" },
  { key: "DH", label: "DH/EH", hint: "Designated/Extra Hitter — optional", color: "#8899AA", optional: true },
];

function emptyPoints(order: PointDef[]): PointsState {
  return Object.fromEntries(order.map((p) => [p.key, null]));
}

function clamp01to100(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
}

// One tab's worth of state and UI -- image, overlay dots, legend, save
// button. All three tabs render this identically now, just pointed at a
// different image/point set/independent point state, since each has its
// own row in field_calibration.
function CalibrationImage({
  fieldType,
  imageSrc,
  pointOrder,
  requiredCount,
  points,
  setPoints,
  savedAt,
  onSaved,
}: {
  fieldType: FieldType;
  imageSrc: string;
  pointOrder: PointDef[];
  // First `requiredCount` entries of pointOrder must be placed before
  // Save appears -- the rest (if any) stay placeable but optional.
  requiredCount: number;
  points: PointsState;
  setPoints: (updater: (prev: PointsState) => PointsState) => void;
  savedAt: number | null;
  onSaved: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draggingKey = useRef<string | null>(null);

  const nextPoint = useMemo(() => pointOrder.find((p) => !points[p.key]) ?? null, [pointOrder, points]);
  const placedCount = pointOrder.filter((p) => points[p.key]).length;
  const requiredPlaced = pointOrder.slice(0, requiredCount).every((p) => points[p.key]);

  function positionFromEvent(e: { clientX: number; clientY: number }): Point | null {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: clamp01to100(((e.clientX - rect.left) / rect.width) * 100),
      y: clamp01to100(((e.clientY - rect.top) / rect.height) * 100),
    };
  }

  function handleContainerClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!nextPoint) return; // every point already placed -- dragging is the only way to move one now
    const pos = positionFromEvent(e);
    if (!pos) return;
    setPoints((prev) => ({ ...prev, [nextPoint.key]: pos }));
  }

  function handleDotPointerDown(key: string, e: React.PointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    draggingKey.current = key;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleDotPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingKey.current) return;
    const pos = positionFromEvent(e);
    if (!pos) return;
    const key = draggingKey.current;
    setPoints((prev) => ({ ...prev, [key]: pos }));
  }

  function handleDotPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    draggingKey.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function resetPoint(key: string) {
    setPoints((prev) => ({ ...prev, [key]: null }));
  }

  function resetAll() {
    setPoints(() => emptyPoints(pointOrder));
  }

  async function handleSave() {
    if (!requiredPlaced) return;
    // Only placed points are included -- an unplaced optional point
    // (DH) is simply absent from the saved object, not written as null.
    const payload: Record<string, Point> = {};
    for (const p of pointOrder) {
      const v = points[p.key];
      if (v) payload[p.key] = v;
    }
    setSaving(true);
    setError(null);
    try {
      await saveFieldCalibration(fieldType, payload as unknown as FieldCalibrationPoints | PlayerPositionCalibration);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save -- check connection and try again");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
      <div>
        <div
          ref={containerRef}
          onClick={handleContainerClick}
          className="glossy relative w-full cursor-crosshair overflow-hidden rounded-lg border border-border bg-background select-none"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- fixed local
              asset the calibration coordinates are measured directly against;
              next/image's layout/placeholder behavior isn't relevant here. */}
          <img src={imageSrc} alt="" draggable={false} className="pointer-events-none block w-full select-none" />

          {pointOrder.map((p, i) => {
            const pos = points[p.key];
            if (!pos) return null;
            return (
              <div
                key={p.key}
                onPointerDown={(e) => handleDotPointerDown(p.key, e)}
                onPointerMove={handleDotPointerMove}
                onPointerUp={handleDotPointerUp}
                onClick={(e) => e.stopPropagation()}
                className="absolute flex -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full border-2 border-background text-[11px] font-bold text-background shadow-lg active:cursor-grabbing"
                style={{ left: `${pos.x}%`, top: `${pos.y}%`, backgroundColor: p.color, width: 26, height: 26, touchAction: "none" }}
                title={p.label}
              >
                {i + 1}
                <span
                  className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-medium text-white"
                  style={{ border: `1px solid ${p.color}` }}
                >
                  {p.label} — {pos.x.toFixed(1)}%, {pos.y.toFixed(1)}%
                </span>
              </div>
            );
          })}
        </div>

        <p className="mt-2 text-xs text-foreground/50">
          {nextPoint
            ? `${requiredPlaced ? "All required points placed. " : ""}Click the image to place: ${nextPoint.label}${
                nextPoint.hint ? ` (${nextPoint.hint})` : ""
              }${requiredPlaced ? ", or save below." : ""}`
            : `All ${pointOrder.length} points placed — drag any dot to fine-tune, or save below.`}
        </p>
      </div>

      <div className="glossy flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-foreground/50">
          Points ({placedCount}/{pointOrder.length})
        </p>
        <div className="flex flex-col gap-1.5">
          {pointOrder.map((p, i) => {
            const pos = points[p.key];
            return (
              <div key={p.key} className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-background"
                    style={{ backgroundColor: p.color }}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-white">
                      {p.label}
                      {p.optional && <span className="ml-1 text-foreground/40">(optional)</span>}
                    </p>
                    <p className="truncate text-[10px] text-foreground/40">
                      {pos ? `${pos.x.toFixed(1)}%, ${pos.y.toFixed(1)}%` : p.hint || "Not placed"}
                    </p>
                  </div>
                </div>
                {pos && (
                  <button
                    type="button"
                    onClick={() => resetPoint(p.key)}
                    className="shrink-0 text-[10px] text-foreground/50 hover:text-accent-red"
                  >
                    Reset
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-1 flex items-center justify-between">
          <button type="button" onClick={resetAll} className="text-xs text-foreground/40 hover:text-accent-red">
            Reset all
          </button>
          {savedAt && <span className="text-[10px] text-accent-green">Saved ✓</span>}
        </div>

        {error && <p className="text-xs text-accent-red">{error}</p>}

        {requiredPlaced && (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="mt-1 min-h-[44px] rounded-md bg-accent-primary px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : `Save ${fieldType === "positions" ? "Positions" : "Calibration"}`}
          </button>
        )}
      </div>
    </div>
  );
}

export function CalibrationTool({
  initial2d,
  initial3d,
  initialPositions,
}: {
  initial2d: FieldCalibrationPoints | null;
  initial3d: FieldCalibrationPoints | null;
  initialPositions: PlayerPositionCalibration | null;
}) {
  const [tab, setTab] = useState<FieldType>("2d");
  const [points2d, setPoints2d] = useState<PointsState>(() => ({ ...emptyPoints(FIELD_POINT_ORDER), ...(initial2d ?? {}) }));
  const [points3d, setPoints3d] = useState<PointsState>(() => ({ ...emptyPoints(FIELD_POINT_ORDER), ...(initial3d ?? {}) }));
  const [pointsPositions, setPointsPositions] = useState<PointsState>(() => ({
    ...emptyPoints(POSITION_POINT_ORDER),
    ...(initialPositions ?? {}),
  }));
  const [savedAt2d, setSavedAt2d] = useState<number | null>(initial2d ? Date.now() : null);
  const [savedAt3d, setSavedAt3d] = useState<number | null>(initial3d ? Date.now() : null);
  const [savedAtPositions, setSavedAtPositions] = useState<number | null>(initialPositions ? Date.now() : null);

  return (
    <div className="glossy rounded-lg border border-border bg-surface p-5">
      <p className="text-sm text-foreground/60">
        Click to place each calibration point. Drag to adjust. This is a one-time setup step — Claude Code uses these
        coordinates instead of guessing where a ball landed on the field image.
      </p>

      <div className="mt-4 flex gap-2 border-b border-border">
        {(
          [
            { type: "2d" as FieldType, label: "field-2d.png (top-down)" },
            { type: "3d" as FieldType, label: "field-3d.png (elevated)" },
            { type: "positions" as FieldType, label: "Player Positions" },
          ]
        ).map((t) => (
          <button
            key={t.type}
            type="button"
            onClick={() => setTab(t.type)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === t.type ? "border-accent-primary text-white" : "border-transparent text-foreground/50 hover:text-white"
            }`}
          >
            {t.label}
            {(t.type === "2d" ? savedAt2d : t.type === "3d" ? savedAt3d : savedAtPositions) && (
              <span className="ml-1.5 text-accent-green">●</span>
            )}
          </button>
        ))}
      </div>

      {tab === "2d" && (
        <CalibrationImage
          key="2d"
          fieldType="2d"
          imageSrc="/field-2d.png"
          pointOrder={FIELD_POINT_ORDER}
          requiredCount={FIELD_POINT_ORDER.length}
          points={points2d}
          setPoints={setPoints2d}
          savedAt={savedAt2d}
          onSaved={() => setSavedAt2d(Date.now())}
        />
      )}
      {tab === "3d" && (
        <CalibrationImage
          key="3d"
          fieldType="3d"
          imageSrc="/field-3d.png"
          pointOrder={FIELD_POINT_ORDER}
          requiredCount={FIELD_POINT_ORDER.length}
          points={points3d}
          setPoints={setPoints3d}
          savedAt={savedAt3d}
          onSaved={() => setSavedAt3d(Date.now())}
        />
      )}
      {tab === "positions" && (
        <CalibrationImage
          key="positions"
          fieldType="positions"
          imageSrc="/field-2d.png"
          pointOrder={POSITION_POINT_ORDER}
          requiredCount={9}
          points={pointsPositions}
          setPoints={setPointsPositions}
          savedAt={savedAtPositions}
          onSaved={() => setSavedAtPositions(Date.now())}
        />
      )}
    </div>
  );
}
