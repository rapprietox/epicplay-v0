"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { computeZoneBattingLines, zoneColor, SPRAY_CATEGORY_COLOR, type AtBatWithZone, type SprayDot } from "@/lib/heat-map";
import { formatAvg } from "@/lib/stats";
import { formatGameDate } from "@/lib/dates";
import { RESULT_LABELS } from "@/lib/operator/types";
import { updateSprayDotPosition, setSprayChartLocked } from "./actions";
import type { PitchOutcome, PitchType } from "@/lib/supabase/types";
import { ZoneAnalyticsRow } from "./players/[id]/zone-analytics-row";

interface TeamHitterPitch {
  swing: boolean | null;
  outcome: PitchOutcome;
  zone_x: number | null;
  zone_y: number | null;
  pitch_type: PitchType | null;
}

// Fix 2: carries who hit the ball -- this chart mixes every player's
// dots together (unlike the per-player spray chart), so the tooltip
// needs a name/jersey the plain SprayDot type never had to track.
// Manual dot positioning batch: also carries the at_bats row's own id,
// needed to persist a dragged dot back to the exact row it came from.
type TeamSprayDot = SprayDot & { atBatId: string; playerName: string; playerJersey: number | null };

export function TeamAnalytics({
  zoneAtBats,
  sprayDots,
  opponentNames,
  nextOpponentName,
  hitterPitches,
  sprayChartLocked,
}: {
  zoneAtBats: AtBatWithZone[];
  sprayDots: TeamSprayDot[];
  opponentNames: string[];
  nextOpponentName: string | null;
  // Whiff-rate/pitch-location maps batch: every pitch thrown to one of
  // our own batters, team-wide -- "our whole team's" swing-and-miss rate
  // and what opposing pitchers target against us, not any one player's.
  hitterPitches: TeamHitterPitch[];
  // Manual dot positioning batch: persisted on `teams`, not per-game --
  // see the migration's own comment for why (this chart has no
  // single-game view to attach a per-game flag to).
  sprayChartLocked: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const [opponentFilter, setOpponentFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [unlockConfirmOpen, setUnlockConfirmOpen] = useState(false);
  const [positionOverrides, setPositionOverrides] = useState<Record<string, { x: number; y: number }>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // A lock can only ever flip to true from this component's own Lock
  // button, which already drops editMode itself -- this just covers the
  // same team dashboard being open in a second tab/device.
  useEffect(() => {
    if (sprayChartLocked) setEditMode(false);
  }, [sprayChartLocked]);

  const lines = useMemo(() => computeZoneBattingLines(zoneAtBats), [zoneAtBats]);

  const weakestZoneIndex = useMemo(() => {
    let worstIndex = -1;
    let worstAvg = Infinity;
    lines.forEach((line, i) => {
      if (line.ab >= 3 && line.avg < worstAvg) {
        worstAvg = line.avg;
        worstIndex = i;
      }
    });
    return worstIndex;
  }, [lines]);

  const filteredDots = useMemo(
    () => (opponentFilter === "all" ? sprayDots : sprayDots.filter((d) => d.opponentName === opponentFilter)),
    [sprayDots, opponentFilter]
  );

  // Manual dot positioning batch: a dragged-but-not-yet-saved dot renders
  // at its local override position rather than waiting on the server
  // round-trip, so the drag itself feels immediate.
  const displayDots = useMemo(
    () => filteredDots.map((d) => (positionOverrides[d.atBatId] ? { ...d, ...positionOverrides[d.atBatId] } : d)),
    [filteredDots, positionOverrides]
  );
  const selected = displayDots.find((d) => d.atBatId === selectedId) ?? null;

  useEffect(() => {
    setRevealed(false);
    const t = setTimeout(() => setRevealed(true), 50);
    return () => clearTimeout(t);
  }, [zoneAtBats]);

  function pointToPct(clientX: number, clientY: number): { x: number; y: number } | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const x = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100));
    return { x, y };
  }

  function handleDragStart(e: React.PointerEvent<SVGCircleElement>, atBatId: string) {
    if (!editMode || sprayChartLocked) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragError(null);
    setDraggingId(atBatId);
  }

  function handleDragMove(e: React.PointerEvent<SVGCircleElement>, atBatId: string) {
    if (draggingId !== atBatId) return;
    const pt = pointToPct(e.clientX, e.clientY);
    if (!pt) return;
    setPositionOverrides((prev) => ({ ...prev, [atBatId]: pt }));
  }

  async function handleDragEnd(e: React.PointerEvent<SVGCircleElement>, atBatId: string) {
    if (draggingId !== atBatId) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDraggingId(null);
    const pt = positionOverrides[atBatId];
    if (!pt) return;

    setSavingId(atBatId);
    const result = await updateSprayDotPosition(atBatId, pt.x, pt.y);
    setSavingId(null);
    if (result.ok) {
      setSavedId(atBatId);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSavedId(null), 2000);
    } else {
      setDragError(result.error);
      // Revert the optimistic position -- the server never saved it.
      setPositionOverrides((prev) => {
        const next = { ...prev };
        delete next[atBatId];
        return next;
      });
    }
  }

  async function handleLock() {
    setEditMode(false);
    setDraggingId(null);
    const result = await setSprayChartLocked(true);
    if (!result.ok) setDragError(result.error);
  }

  async function handleConfirmUnlock() {
    setUnlockConfirmOpen(false);
    const result = await setSprayChartLocked(false);
    if (!result.ok) setDragError(result.error);
  }

  return (
    <section className="glossy rounded-lg border border-border bg-surface p-5">
      <h2 className="font-heading text-xl font-bold uppercase tracking-wide text-white">Team Analytics</h2>

      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-foreground/40">Team Batting Average by Zone</p>
          <div className="mx-auto mt-3 grid w-full max-w-[240px] grid-cols-3 grid-rows-3 gap-1 rounded-md border-2 border-border bg-background p-1">
            {lines.map((line, i) => (
              <div
                key={i}
                className={`flex aspect-square flex-col items-center justify-center rounded transition-colors duration-700 ${
                  i === weakestZoneIndex ? "ring-2 ring-accent-red" : ""
                }`}
                style={{ backgroundColor: revealed ? zoneColor(line) : "#1A3D28" }}
              >
                {line.ab > 0 ? (
                  <>
                    <span className="font-heading text-base font-bold text-background">{formatAvg(line.avg)}</span>
                    <span className="text-[9px] text-background/70">{line.ab} AB</span>
                  </>
                ) : (
                  <span className="text-[10px] text-foreground/30">—</span>
                )}
              </div>
            ))}
          </div>

          {weakestZoneIndex >= 0 && (
            <div className="mt-3 rounded-md border border-accent-red/50 bg-accent-red/10 p-3 text-center">
              <p className="text-xs font-semibold uppercase tracking-wide text-accent-red">Weakness Finder</p>
              <p className="mt-1 text-sm text-white">
                Weakest zone: {formatAvg(lines[weakestZoneIndex].avg)}
                {nextOpponentName ? ` — expect it targeted against ${nextOpponentName}` : " — expect pitchers to target it"}
              </p>
            </div>
          )}
        </div>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-wide text-foreground/40">Team Spray Chart</p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={opponentFilter}
                onChange={(e) => {
                  setOpponentFilter(e.target.value);
                  setSelectedId(null);
                }}
                className="rounded border border-border bg-background px-2 py-1 text-xs text-white"
              >
                <option value="all">All opponents</option>
                {opponentNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>

              {/* Manual dot positioning batch: locked blocks entry into
                  edit mode entirely -- the button becomes the unlock
                  prompt instead of a plain toggle. */}
              {sprayChartLocked ? (
                <button
                  type="button"
                  onClick={() => setUnlockConfirmOpen(true)}
                  className="rounded-full border border-border px-3 py-1 text-xs text-foreground/50 transition hover:text-white"
                >
                  Locked 🔒
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setEditMode((v) => !v)}
                    className={`rounded-full border px-3 py-1 text-xs transition ${
                      editMode ? "border-accent-primary bg-accent-primary/20 text-white" : "border-border text-foreground/50 hover:text-white"
                    }`}
                  >
                    Adjust Dots
                  </button>
                  {editMode && (
                    <button
                      type="button"
                      onClick={handleLock}
                      className="rounded-full border border-accent-green px-3 py-1 text-xs text-accent-green transition hover:bg-accent-green/10"
                    >
                      Lock
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
          {editMode && !sprayChartLocked && (
            <p className="mt-1 text-[11px] text-accent-primary">Drag a dot to reposition it. Tap Lock when you&apos;re done.</p>
          )}

          {/* field-2d.png spray chart batch (team version): same real-photo
              background + dark overlay as the shared PlayerSprayChart
              (src/app/player/clubhouse/pro/player-spray-chart.tsx, now
              used by both the coach's per-player page and the player's
              own Clubhouse) instead of a hand-drawn SVG diamond.
              field_x/field_y are already a direct 0-100 percentage
              against this image (see that component's own comment), so
              an SVG viewBox="0 0 100 100" overlay plots a dot at cx/cy
              exactly the same as `left: x%, top: y%` would -- same math,
              same result. No 2D/3D toggle here (unlike that shared
              component) -- this is a standalone, simpler inline
              implementation for the team-wide view, out of scope for
              this fix. */}
          <div className="relative mx-auto mt-3 aspect-square w-full max-w-[280px] overflow-hidden rounded-md border border-border bg-background">
            <div
              className="absolute inset-0"
              style={{ backgroundImage: "url('/field-2d.png')", backgroundSize: "cover", backgroundPosition: "center top" }}
            />
            <div className="pointer-events-none absolute inset-0" style={{ background: "rgba(0, 0, 0, 0.15)" }} />
            <svg ref={svgRef} viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
              {displayDots.map((d) => {
                const isSelected = selected?.atBatId === d.atBatId;
                const isDragging = draggingId === d.atBatId;
                return (
                  <circle
                    key={d.atBatId}
                    cx={d.x}
                    cy={d.y}
                    r={isDragging ? 2.6 : isSelected ? 2.2 : 1.4}
                    fill={SPRAY_CATEGORY_COLOR[d.category]}
                    className={editMode && !sprayChartLocked ? "cursor-grab" : "cursor-pointer"}
                    style={{
                      filter: isDragging ? "drop-shadow(0 0 5px #2ECC71)" : isSelected ? "drop-shadow(0 0 4px #00FF7F)" : undefined,
                      touchAction: "none",
                    }}
                    onClick={() => {
                      if (editMode) return;
                      setSelectedId(d.atBatId === selectedId ? null : d.atBatId);
                    }}
                    onPointerDown={(e) => handleDragStart(e, d.atBatId)}
                    onPointerMove={(e) => handleDragMove(e, d.atBatId)}
                    onPointerUp={(e) => void handleDragEnd(e, d.atBatId)}
                  />
                );
              })}
            </svg>
          </div>

          {savingId ? (
            <p className="mt-2 text-center text-xs text-foreground/50">Saving…</p>
          ) : savedId ? (
            <p className="mt-2 text-center text-xs text-accent-green">Position saved ✓</p>
          ) : dragError ? (
            <p className="mt-2 text-center text-xs text-accent-red">{dragError}</p>
          ) : selected ? (
            <div className="mt-2 text-center text-xs text-foreground/60">
              <p className="font-semibold text-white">
                #{selected.playerJersey ?? "—"} {selected.playerName}
              </p>
              <p>
                {RESULT_LABELS[selected.result]} &middot; Inning {selected.inning}
              </p>
              <p>
                {selected.gameDate ? formatGameDate(selected.gameDate) : "—"} &middot; vs {selected.opponentName}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-center text-xs text-foreground/40">
              {filteredDots.length === 0 ? "No balls in play for this filter." : "Tap a dot for details."}
            </p>
          )}
        </div>
      </div>

      {/* Whiff-rate/pitch-location maps batch: team-wide versions of Maps
          2/3 from the player page (ZoneAnalyticsRow, reused as-is --
          "aggregated across all players" just means the caller passes
          every batter's pitches instead of one player's). The panel
          above keeps its own richer "Weakness Finder" callout; this is
          the same uniform 3-map layout the player page uses, added
          alongside it rather than replacing it. */}
      {hitterPitches.length > 0 && (
        <div className="mt-6 border-t border-border pt-6">
          <ZoneAnalyticsRow
            battingAvgLines={computeZoneBattingLines(zoneAtBats)}
            whiffPitches={hitterPitches}
            locationPitches={hitterPitches}
            namePrefix="Team "
          />
        </div>
      )}

      {unlockConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setUnlockConfirmOpen(false)}>
          <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-5 text-center" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-heading text-lg font-bold text-white">Unlock dot positions?</h3>
            <p className="mt-2 text-sm text-foreground/70">
              Are you sure you want to unlock and edit dot positions?
            </p>
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={handleConfirmUnlock}
                className="flex-1 rounded-md bg-accent-primary px-4 py-2.5 text-sm font-semibold text-white"
              >
                Unlock
              </button>
              <button
                type="button"
                onClick={() => setUnlockConfirmOpen(false)}
                className="rounded-md border border-border px-4 py-2.5 text-sm text-foreground/70"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
