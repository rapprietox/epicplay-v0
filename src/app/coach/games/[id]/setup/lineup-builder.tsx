"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import type { Database, LineupDraftSlot, LoggingMode, PlayerPositionCalibration } from "@/lib/supabase/types";
import { nearestSavedPosition } from "@/lib/field-zones";
import { startGame, checkOtherActiveGame, type LineupSlot, type ActiveGameConflict } from "./actions";
import { endGame } from "@/app/operator/actions";
import { LoggingModeSelector } from "./logging-mode-selector";
import { FallbackPositionList } from "./fallback-position-list";
import { getLiveLineupFeedback, logLineupOverride, type LiveLineupFeedback } from "./live-feedback-actions";
import { FullLineupAnalysisPanel } from "./full-lineup-analysis-panel";
import type { FullLineupAnalysis } from "./full-lineup-analysis-actions";
import { PositionPickerMenu, anchorFromEvent, type PositionPickerAnchor } from "./position-picker-menu";
import { DraftManager } from "./draft-manager";
import { DraftCompare } from "./draft-compare";
import { saveDraftSlots, saveDraftAnalysis, saveUmpireName, lockLineup, unlockLineup, type LineupDraft } from "./draft-actions";

type Player = Database["public"]["Tables"]["players"]["Row"];

const DH = "DH";
const EH = "EH";

// Auto-batting-order batch: batting order is no longer a separate,
// manually-picked attribute -- it's assigned automatically, in drag
// order, the instant a player is dropped onto a position (field, DH, or
// EH all count). That means a Placement can no longer exist in a
// "position set, battingOrder not yet set" state the way it could when
// order was picked in a second step -- battingOrder is always a real
// number from the moment a placement is created, so it's typed as
// `number`, not `number | null`, to make that invariant explicit rather
// than relying on every reader to re-check for null.
interface Placement {
  playerId: string;
  position: string;
  battingOrder: number;
}

function slotsToPlacements(slots: LineupDraftSlot[]): Placement[] {
  return slots
    .filter((s): s is LineupDraftSlot & { position: string; batting_order: number } => Boolean(s.position) && s.batting_order !== null)
    .map((s) => ({ playerId: s.player_id, position: s.position, battingOrder: s.batting_order }));
}

function slotsToAbsentSet(slots: LineupDraftSlot[]): Set<string> {
  return new Set(slots.filter((s) => s.status === "absent").map((s) => s.player_id));
}

function nextBattingOrderFrom(slots: LineupDraftSlot[]): number {
  const existing = slots
    .filter((s) => s.position)
    .map((s) => s.batting_order)
    .filter((n): n is number => n !== null);
  return existing.length > 0 ? Math.max(...existing) + 1 : 1;
}

export function LineupBuilder({
  gameId,
  players,
  initialUmpireName,
  fieldPositionsCalibration,
  initialDrafts,
  initialLineupConfirmedAt,
}: {
  gameId: string;
  players: Player[];
  initialUmpireName: string | null;
  // Change 2 (calibrate-field-tabs batch): the "Player Positions"
  // calibration tab's saved points -- null when the coach hasn't
  // calibrated it yet, a real, expected state. Dropping a player snaps
  // to whichever saved point is closest, no math or interpolation, and
  // field placement is genuinely blocked (DH/EH and umpire name still
  // work) until this is calibrated.
  fieldPositionsCalibration: PlayerPositionCalibration | null;
  // Feature B (lineup drafts): page.tsx has already ensured at least
  // one draft exists (ensureDraftsAndLock) before this ever renders.
  initialDrafts: LineupDraft[];
  initialLineupConfirmedAt: string | null;
}) {
  const [drafts, setDrafts] = useState<LineupDraft[]>(initialDrafts);
  const [activeDraftId, setActiveDraftId] = useState<string>(initialDrafts[0].id);
  const activeDraft = drafts.find((d) => d.id === activeDraftId) ?? drafts[0];

  const [placements, setPlacements] = useState<Placement[]>(() => slotsToPlacements(activeDraft.slots));
  // Auto-batting-order batch: the next number to hand out, incremented
  // every successful drop and never decremented or reused -- removing a
  // player frees their number but leaves a gap (per spec: "do NOT
  // renumber everyone else"), and re-dragging them back in assigns a
  // fresh, later number rather than restoring the old one. Seeded from
  // whatever's already saved so reopening a partially-built lineup
  // continues the sequence instead of restarting it.
  const [nextBattingOrder, setNextBattingOrder] = useState(() => nextBattingOrderFrom(activeDraft.slots));
  const [absentPlayerIds, setAbsentPlayerIds] = useState<Set<string>>(() => slotsToAbsentSet(activeDraft.slots));
  const [umpireName, setUmpireName] = useState(initialUmpireName ?? "");
  // Quick Mode batch: defaults to "full" (the recommended path) -- see
  // logging-mode-selector.tsx for why selecting Quick Mode always routes
  // through the motivation card before this actually changes.
  const [loggingMode, setLoggingMode] = useState<LoggingMode>("full");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isSaving, startSave] = useTransition();
  const [isStarting, startStart] = useTransition();
  const [isLocking, startLocking] = useTransition();
  // Feature B: backward compatibility is resolved once, server-side,
  // before this component ever mounts (ensureDraftsAndLock backfills
  // lineup_confirmed_at for an old game that already had official rows)
  // -- so this is just a plain boolean from here on, no derived "or
  // does `lineup` already have rows" check needed at render time.
  const [isLocked, setIsLocked] = useState(initialLineupConfirmedAt !== null);
  const [showLockPrompt, setShowLockPrompt] = useState(false);
  // Launch-audit Fix 7: set only when Start Game finds another game for
  // this team already active -- renders the End-previous/Continue-anyway
  // dialog in place of actually starting, until the coach picks one.
  const [activeConflict, setActiveConflict] = useState<ActiveGameConflict | null>(null);
  const [isResolvingConflict, startResolveConflict] = useTransition();
  const [dragOver, setDragOver] = useState<"field" | "dh" | "eh" | null>(null);
  // Part 2 (live lineup feedback): keyed by playerId, not slot number --
  // a slot can get renumbered by a batting-order-card reorder, which
  // would silently misattach stale feedback if keyed by slot instead.
  const [feedbackByPlayerId, setFeedbackByPlayerId] = useState<Record<string, LiveLineupFeedback | "loading">>({});
  const [overrideOpenFor, setOverrideOpenFor] = useState<string | null>(null);
  const [overrideLoggedFor, setOverrideLoggedFor] = useState<Set<string>>(new Set());
  // Batting-order-card batch: drag-reorder state for the card's own rows
  // -- separate from `dragOver` (roster -> field/DH/EH placement), since
  // this drag never touches the roster or the drop zones at all.
  const [draggedOrderIndex, setDraggedOrderIndex] = useState<number | null>(null);
  const [dragOverOrderIndex, setDragOverOrderIndex] = useState<number | null>(null);
  // Feature A (tap-to-place): one shared picker, portaled, anchored off
  // whichever tap opened it -- see position-picker-menu.tsx.
  const [picker, setPicker] = useState<{ playerId: string; anchor: PositionPickerAnchor } | null>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const umpireTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const placedPlayerIds = new Set(placements.map((p) => p.playerId));
  const availablePlayers = players.filter((p) => !placedPlayerIds.has(p.id) && !absentPlayerIds.has(p.id));
  const absentPlayers = players.filter((p) => !placedPlayerIds.has(p.id) && absentPlayerIds.has(p.id));

  function buildLineupPayload(): LineupSlot[] {
    const starting: LineupSlot[] = placements.map((p) => ({
      batting_order: p.battingOrder,
      player_id: p.playerId,
      position: p.position,
      status: "starting",
    }));
    const placedIds = new Set(placements.map((p) => p.playerId));
    const reserveOrAbsent: LineupSlot[] = players
      .filter((p) => !placedIds.has(p.id))
      .map((p) => ({
        batting_order: null,
        player_id: p.id,
        position: null,
        status: absentPlayerIds.has(p.id) ? "absent" : "reserve",
      }));
    return [...starting, ...reserveOrAbsent];
  }

  // Feature B: debounced autosave to the ACTIVE draft -- every mutator
  // below calls this once at the end, so drag, tap-to-place, and the
  // dropdown fallback (which already shares placePlayer/removePlayer)
  // all autosave identically. A manual "Save Draft" click cancels any
  // pending timer and writes immediately instead.
  function scheduleAutosave() {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    const draftId = activeDraftId;
    autosaveTimerRef.current = setTimeout(() => {
      void saveDraftSlots(gameId, draftId, buildLineupPayloadRef.current());
    }, 1200);
  }
  // buildLineupPayload closes over `placements`/`absentPlayerIds`,
  // which are fresh at the moment scheduleAutosave is CALLED (every
  // mutator calls it right after its own setState) -- but the timeout
  // fires later, so it needs the LATEST payload builder, not the one
  // closed over at schedule time (same players list either way, this
  // just keeps placements/absentPlayerIds current). A ref sidesteps
  // re-creating scheduleAutosave on every placements change.
  const buildLineupPayloadRef = useRef(buildLineupPayload);
  buildLineupPayloadRef.current = buildLineupPayload;

  // Switching drafts: flush any pending autosave for the OLD draft
  // first (so an edit made right before switching is never lost), then
  // load the new draft's slots into placements/absentPlayerIds/
  // nextBattingOrder.
  function switchDraft(newId: string) {
    if (newId === activeDraftId) return;
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
      void saveDraftSlots(gameId, activeDraftId, buildLineupPayloadRef.current());
    }
    setActiveDraftId(newId);
  }

  useEffect(() => {
    const draft = drafts.find((d) => d.id === activeDraftId);
    if (!draft) return;
    setPlacements(slotsToPlacements(draft.slots));
    setAbsentPlayerIds(slotsToAbsentSet(draft.slots));
    setNextBattingOrder(nextBattingOrderFrom(draft.slots));
    setFeedbackByPlayerId({});
    setOverrideOpenFor(null);
    setError(null);
    setSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDraftId]);

  function markAbsent(playerId: string) {
    setError(null);
    setSaved(false);
    setAbsentPlayerIds((prev) => new Set(prev).add(playerId));
    scheduleAutosave();
  }

  function markAvailable(playerId: string) {
    setError(null);
    setSaved(false);
    setAbsentPlayerIds((prev) => {
      const next = new Set(prev);
      next.delete(playerId);
      return next;
    });
    scheduleAutosave();
  }

  // Auto-batting-order batch: every placement is created with both a
  // position and a real batting order in the same step, so "ready" is
  // now just "has a placement at all" -- no separate readiness check is
  // needed the way it was when order could lag behind position.
  const filledCount = placements.length;

  function playerName(playerId: string): string {
    const p = players.find((pl) => pl.id === playerId);
    return p ? `#${p.jersey_number ?? "—"} ${p.name}` : "Player";
  }

  // Feature 2 (lineup-status batch), pre-game scope: dragging onto an
  // occupied position bumps the existing occupant back to the roster
  // (unplaced) rather than blocking with an error. Auto-batting-order
  // batch: the newly dropped player always gets the *next* sequential
  // number, never the bumped player's old one. Feature A: this is now
  // also called directly from the tap-to-place menu (which shows its
  // own "Replace [name]?" confirm before ever calling this), so a
  // dragged and a tapped placement produce byte-identical data.
  function placePlayer(playerId: string, position: string) {
    const conflict = placements.find((p) => p.position === position && p.playerId !== playerId);
    setError(null);
    setSaved(false);
    const assignedOrder = nextBattingOrder;
    const lineupSoFar = placements
      .filter((p) => p.playerId !== playerId && p.playerId !== conflict?.playerId)
      .map((p) => ({ slot: p.battingOrder, playerId: p.playerId }));
    setPlacements((prev) => [
      ...prev.filter((p) => p.playerId !== playerId && p.playerId !== conflict?.playerId),
      { playerId, position, battingOrder: assignedOrder },
    ]);
    setNextBattingOrder((n) => n + 1);

    // Part 2: a bumped occupant's old feedback no longer describes
    // anything real -- cleared along with the fresh placement's own
    // "loading" state.
    setFeedbackByPlayerId((prev) => {
      const next = { ...prev };
      delete next[playerId];
      if (conflict) delete next[conflict.playerId];
      return { ...next, [playerId]: "loading" };
    });
    setOverrideOpenFor((cur) => (cur === conflict?.playerId ? null : cur));
    scheduleAutosave();
    getLiveLineupFeedback(gameId, playerId, assignedOrder, lineupSoFar).then((result) => {
      if (!result.ok) {
        setFeedbackByPlayerId((prev) => {
          const next = { ...prev };
          delete next[playerId];
          return next;
        });
        return;
      }
      setFeedbackByPlayerId((prev) => ({ ...prev, [playerId]: result.feedback }));
      // Part 2 (override tracking): prompts immediately when a bad
      // rating comes back -- "why are you keeping this" is asked
      // alongside the feedback itself, not gated behind a separate
      // confirm step, since keeping the placement is already the
      // default (nothing blocks the coach from just changing it instead).
      if (result.feedback.rating === "MISTAKE" || result.feedback.rating === "BLUNDER") {
        setOverrideOpenFor(playerId);
      }
    });
  }

  // Removing a placement just drops it from the array -- the
  // roster-membership filter above picks the player back up on its own.
  // nextBattingOrder is deliberately untouched: the freed number is
  // never reused, per spec.
  function removePlayer(playerId: string) {
    setError(null);
    setSaved(false);
    setPlacements((prev) => prev.filter((p) => p.playerId !== playerId));
    setFeedbackByPlayerId((prev) => {
      const next = { ...prev };
      delete next[playerId];
      return next;
    });
    setOverrideOpenFor((cur) => (cur === playerId ? null : cur));
    scheduleAutosave();
  }

  function recordOverride(playerId: string, slot: number, rating: string, reason: string) {
    setOverrideOpenFor(null);
    setOverrideLoggedFor((prev) => new Set(prev).add(playerId));
    void logLineupOverride(gameId, playerId, slot, rating, reason);
  }

  // Batting-order-card batch: placements, sorted for the card.
  const orderedPlacements = [...placements].sort((a, b) => a.battingOrder - b.battingOrder);

  function reorderBattingOrder(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    const ids = orderedPlacements.map((p) => p.playerId);
    const [movedId] = ids.splice(fromIndex, 1);
    ids.splice(toIndex, 0, movedId);
    const orderByPlayerId = new Map(ids.map((id, i) => [id, i + 1]));
    setError(null);
    setSaved(false);
    setPlacements((prev) => prev.map((p) => ({ ...p, battingOrder: orderByPlayerId.get(p.playerId) ?? p.battingOrder })));
    setNextBattingOrder(ids.length + 1);
    scheduleAutosave();
  }

  function handleDragStart(e: React.DragEvent, playerId: string) {
    e.dataTransfer.setData("text/plain", playerId);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleFieldDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(null);
    const playerId = e.dataTransfer.getData("text/plain");
    if (!playerId || !fieldPositionsCalibration) return;
    const rect = fieldRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    const position = nearestSavedPosition(x, y, fieldPositionsCalibration);
    if (!position) return; // no defensive points calibrated at all
    placePlayer(playerId, position);
  }

  function openPicker(e: React.MouseEvent, playerId: string) {
    e.preventDefault();
    e.stopPropagation();
    setPicker({ playerId, anchor: anchorFromEvent(e) });
  }

  function saveDraft() {
    setError(null);
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    startSave(async () => {
      try {
        await saveDraftSlots(gameId, activeDraftId, buildLineupPayload());
        setSaved(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save draft");
      }
    });
  }

  function handleLock() {
    setError(null);
    setShowLockPrompt(false);
    startLocking(async () => {
      const result = await lockLineup(gameId, buildLineupPayload(), umpireName);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setIsLocked(true);
    });
  }

  function handleUnlock() {
    setError(null);
    startLocking(async () => {
      await unlockLineup(gameId);
      setIsLocked(false);
    });
  }

  // Launch-audit Fix 7: the actual startGame -> redirect sequence,
  // factored out so all three paths (no conflict, "end previous game",
  // "continue anyway") run the exact same steps. Feature B: no longer
  // saves the lineup itself here -- Lock Lineup already copied the
  // chosen draft into the official `lineup` table, so Start Game just
  // flips the game's own status.
  async function proceedToStart() {
    await startGame(gameId, loggingMode);
    window.location.href = `/operator?game=${gameId}`;
  }

  function start() {
    setError(null);
    if (!isLocked) {
      setShowLockPrompt(true);
      return;
    }
    if (!umpireName.trim()) {
      setError("Umpire name is required");
      return;
    }
    startStart(async () => {
      try {
        const conflict = await checkOtherActiveGame(gameId);
        if (conflict) {
          setActiveConflict(conflict);
          return;
        }
        await proceedToStart();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start game");
      }
    });
  }

  // Feature B: the lock prompt's own shortcut -- locks the current
  // draft, then immediately re-runs start() now that isLocked is true.
  function lockThenStart() {
    setShowLockPrompt(false);
    startLocking(async () => {
      const result = await lockLineup(gameId, buildLineupPayload(), umpireName);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setIsLocked(true);
      start();
    });
  }

  function endPreviousAndStart() {
    if (!activeConflict) return;
    setError(null);
    startResolveConflict(async () => {
      try {
        await endGame(activeConflict.gameId, "");
        setActiveConflict(null);
        await proceedToStart();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to end the previous game");
      }
    });
  }

  function continueAnyway() {
    if (!activeConflict) return;
    setError(null);
    setActiveConflict(null);
    startResolveConflict(async () => {
      try {
        await proceedToStart();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start game");
      }
    });
  }

  // Lock requires 9 players placed on the field in the ACTIVE draft.
  // Starting requires the lineup to be locked, plus a non-blank umpire
  // name (also enforced server-side by startGame itself).
  const canLock = filledCount >= 9;
  const dhPlacement = placements.find((p) => p.position === DH) ?? null;
  const ehPlacement = placements.find((p) => p.position === EH) ?? null;
  const dhFieldLoc = fieldPositionsCalibration?.DH ?? null;

  return (
    <div>
      {!fieldPositionsCalibration && (
        <div className="mb-3 rounded-md border border-accent-amber/40 bg-accent-amber/10 px-4 py-3">
          <p className="text-sm text-accent-amber">
            Before you can use the visual lineup builder you need to calibrate your field image once. This takes 2
            minutes and only needs to be done once per season.
          </p>
          <a
            href="/coach/calibrate-field"
            className="mt-3 inline-block rounded-md bg-accent-amber px-4 py-2 text-sm font-bold text-background transition hover:brightness-110"
          >
            Calibrate Field Now →
          </a>
          <p className="mt-2 text-xs text-accent-amber/80">
            Don&apos;t want to stop and calibrate right now? Use the position list below instead — it builds the exact
            same lineup, just without the drag-and-drop diagram.
          </p>
        </div>
      )}

      {/* Feature B: draft switcher. */}
      <div className="mb-4">
        <DraftManager
          gameId={gameId}
          drafts={drafts}
          activeDraftId={activeDraftId}
          currentSlots={buildLineupPayload()}
          currentAnalysis={activeDraft.analysis}
          currentReliability={activeDraft.reliability}
          onSwitch={switchDraft}
          onDraftsChange={setDrafts}
        />
        <div className="mt-2">
          <DraftCompare drafts={drafts} />
        </div>
      </div>

      <p className="text-xs uppercase tracking-wide text-foreground/40">
        Drag a player onto the field (or DH/EH), or tap a player to pick their position -- batting order is assigned
        automatically, in the order players are placed.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr_240px]">
        {/* Roster */}
        <div>
          <p className="text-xs uppercase tracking-wide text-foreground/40">Roster</p>
          <ul className="mt-2 flex max-h-[300px] flex-col gap-1.5 overflow-y-auto pr-1">
            {availablePlayers.map((p) => (
              <li key={p.id} className="flex items-center gap-1.5">
                <div
                  draggable
                  onDragStart={(e) => handleDragStart(e, p.id)}
                  onDragEnd={() => setDragOver(null)}
                  onClick={(e) => openPicker(e, p.id)}
                  // Urgent mobile fixes, Fix 2: stops the browser's own
                  // touch-scroll gesture from competing with a drag that
                  // starts on this element.
                  style={{ touchAction: "none" }}
                  className="flex-1 cursor-grab rounded-md border border-border bg-background/40 px-3 py-1.5 text-sm text-white transition hover:border-accent-primary active:cursor-grabbing"
                >
                  #{p.jersey_number ?? "—"} {p.name}
                </div>
                <button
                  type="button"
                  onClick={() => markAbsent(p.id)}
                  title="Mark absent"
                  className="shrink-0 rounded-md border border-border px-1.5 py-1.5 text-[10px] text-foreground/40 hover:border-accent-red hover:text-accent-red"
                >
                  Absent
                </button>
              </li>
            ))}
            {availablePlayers.length === 0 && <li className="text-xs text-foreground/30">Everyone is placed or absent.</li>}
          </ul>

          {absentPlayers.length > 0 && (
            <>
              <p className="mt-4 text-xs uppercase tracking-wide text-foreground/40">Absent ({absentPlayers.length})</p>
              <ul className="mt-2 flex max-h-[160px] flex-col gap-1.5 overflow-y-auto pr-1">
                {absentPlayers.map((p) => (
                  <li key={p.id} className="flex items-center gap-1.5">
                    <div className="flex-1 rounded-md border border-border bg-background/20 px-3 py-1.5 text-sm text-foreground/40">
                      #{p.jersey_number ?? "—"} {p.name}
                    </div>
                    <button
                      type="button"
                      onClick={() => markAvailable(p.id)}
                      className="shrink-0 rounded-md border border-border px-1.5 py-1.5 text-[10px] text-foreground/40 hover:border-accent-green hover:text-accent-green"
                    >
                      Available
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {/* Field diagram + DH/EH drop zones */}
        <div>
          {fieldPositionsCalibration ? (
            <div
              ref={fieldRef}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver("field");
              }}
              onDragLeave={() => setDragOver((d) => (d === "field" ? null : d))}
              onDrop={handleFieldDrop}
              className={`glossy relative aspect-square w-full max-w-[420px] overflow-hidden rounded-lg border bg-background transition ${
                dragOver === "field" ? "border-accent-gold shadow-[0_0_16px_rgba(240,192,96,0.35)]" : "border-border"
              }`}
              style={{ backgroundImage: "url('/field-2d.png')", backgroundSize: "cover", backgroundPosition: "center" }}
            >
              {placements
                .filter((p) => p.position !== DH && p.position !== EH)
                .map((p) => {
                  const loc = fieldPositionsCalibration[p.position as keyof PlayerPositionCalibration];
                  if (!loc) return null;
                  return (
                    <PositionedAvatar
                      key={`${p.playerId}-${p.position}`}
                      x={loc.x}
                      y={loc.y}
                      battingOrder={p.battingOrder}
                      jersey={players.find((pl) => pl.id === p.playerId)?.jersey_number ?? null}
                      onTap={(e) => openPicker(e, p.playerId)}
                      onRemove={() => removePlayer(p.playerId)}
                    />
                  );
                })}

              {dhPlacement && dhFieldLoc && (
                <PositionedAvatar
                  key={`${dhPlacement.playerId}-dh-field`}
                  x={dhFieldLoc.x}
                  y={dhFieldLoc.y}
                  battingOrder={dhPlacement.battingOrder}
                  jersey={players.find((pl) => pl.id === dhPlacement.playerId)?.jersey_number ?? null}
                  onTap={(e) => openPicker(e, dhPlacement.playerId)}
                  onRemove={() => removePlayer(dhPlacement.playerId)}
                />
              )}
            </div>
          ) : (
            <FallbackPositionList players={players} placements={placements} onAssign={placePlayer} onRemove={removePlayer} />
          )}

          <div className="mt-3 grid w-full max-w-[420px] grid-cols-2 gap-2">
            <DropZone
              label="DH"
              hint="Designated Hitter — optional"
              active={dragOver === "dh"}
              onDragOver={() => setDragOver("dh")}
              onDragLeave={() => setDragOver((d) => (d === "dh" ? null : d))}
              onDrop={(playerId) => placePlayer(playerId, DH)}
            >
              {dhPlacement && !dhFieldLoc ? (
                <PlacedAvatarChip
                  battingOrder={dhPlacement.battingOrder}
                  jersey={players.find((pl) => pl.id === dhPlacement.playerId)?.jersey_number ?? null}
                  name={playerName(dhPlacement.playerId)}
                  onTap={(e) => openPicker(e, dhPlacement.playerId)}
                  onRemove={() => removePlayer(dhPlacement.playerId)}
                />
              ) : dhPlacement && dhFieldLoc ? (
                <p className="text-[10px] text-foreground/50">
                  {playerName(dhPlacement.playerId)} — on field ↑
                </p>
              ) : (
                <span className="text-xs text-foreground/40">Drop DH here</span>
              )}
            </DropZone>

            <DropZone
              label="EH"
              hint="Extra Hitter — optional"
              active={dragOver === "eh"}
              onDragOver={() => setDragOver("eh")}
              onDragLeave={() => setDragOver((d) => (d === "eh" ? null : d))}
              onDrop={(playerId) => placePlayer(playerId, EH)}
            >
              {ehPlacement ? (
                <PlacedAvatarChip
                  battingOrder={ehPlacement.battingOrder}
                  jersey={players.find((pl) => pl.id === ehPlacement.playerId)?.jersey_number ?? null}
                  name={playerName(ehPlacement.playerId)}
                  onTap={(e) => openPicker(e, ehPlacement.playerId)}
                  onRemove={() => removePlayer(ehPlacement.playerId)}
                />
              ) : (
                <span className="text-xs text-foreground/40">Drop EH here</span>
              )}
            </DropZone>
          </div>
        </div>

        {/* Batting-order-card batch: a live, reorderable view of the same
            placements array the field/DH/EH already render from. */}
        <div className="glossy rounded-lg border-l-4 border-l-accent-green bg-surface p-3">
          <p className="font-heading text-sm font-semibold uppercase tracking-wide text-white">Batting Order</p>
          <div className="mt-2 border-b border-border" />
          <ul className="mt-2 flex flex-col gap-1">
            {orderedPlacements.map((p, i) => (
              <li
                key={p.playerId}
                draggable
                onDragStart={(e) => {
                  setDraggedOrderIndex(i);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", p.playerId);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverOrderIndex(i);
                }}
                onDragLeave={() => setDragOverOrderIndex((d) => (d === i ? null : d))}
                onDrop={(e) => {
                  e.preventDefault();
                  if (draggedOrderIndex !== null) reorderBattingOrder(draggedOrderIndex, i);
                  setDraggedOrderIndex(null);
                  setDragOverOrderIndex(null);
                }}
                onDragEnd={() => {
                  setDraggedOrderIndex(null);
                  setDragOverOrderIndex(null);
                }}
                style={{ touchAction: "none" }}
                className={`cursor-grab rounded-md border px-2 py-1.5 text-sm transition active:cursor-grabbing ${
                  dragOverOrderIndex === i ? "border-accent-gold bg-accent-gold/10" : "border-transparent hover:border-border"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-heading w-5 shrink-0 text-right font-bold text-accent-gold">{p.battingOrder}</span>
                  <span
                    className="min-w-0 flex-1 truncate font-sans text-white"
                    onClick={(e) => openPicker(e, p.playerId)}
                  >
                    {players.find((pl) => pl.id === p.playerId)?.name ?? "Player"}
                  </span>
                  <span className="shrink-0 text-xs font-medium text-accent-green/70">{p.position}</span>
                  <button
                    type="button"
                    onClick={() => removePlayer(p.playerId)}
                    title="Remove from lineup"
                    className="shrink-0 text-xs text-foreground/30 hover:text-accent-red"
                  >
                    ✕
                  </button>
                </div>

                {/* Part 2 (live lineup feedback) */}
                <LiveFeedbackBadge
                  feedback={feedbackByPlayerId[p.playerId]}
                  showOverridePrompt={overrideOpenFor === p.playerId && !overrideLoggedFor.has(p.playerId)}
                  onOverrideReason={(reason) => {
                    const fb = feedbackByPlayerId[p.playerId];
                    if (fb && fb !== "loading") recordOverride(p.playerId, p.battingOrder, fb.rating, reason);
                  }}
                />
              </li>
            ))}
            {orderedPlacements.length === 0 && (
              <li className="px-2 py-3 text-center text-xs text-foreground/30">Drag players onto the field, or tap a roster player, to build the order.</li>
            )}
          </ul>
        </div>
      </div>

      {/* Part 3 (pre-game deep analysis): only once all 9/10 slots are
          filled. Feature B: keyed by draft so switching drafts shows
          that draft's own cached analysis instead of re-running the AI
          or leaking a stale result from the previous draft. */}
      {filledCount >= 9 && (
        <FullLineupAnalysisPanel
          key={activeDraftId}
          gameId={gameId}
          placements={placements}
          initialAnalysis={activeDraft.analysis as FullLineupAnalysis | null}
          onApplyOptimalLineup={(order) => {
            setError(null);
            setSaved(false);
            const slotByPlayerId = new Map(order.map((o) => [o.playerId, o.slot]));
            setPlacements((prev) => prev.map((p) => ({ ...p, battingOrder: slotByPlayerId.get(p.playerId) ?? p.battingOrder })));
            scheduleAutosave();
          }}
          onAnalysisSaved={(analysis) => {
            const analysisRecord = analysis as unknown as Record<string, unknown>;
            setDrafts((prev) =>
              prev.map((d) => (d.id === activeDraftId ? { ...d, analysis: analysisRecord, reliability: analysis.reliabilityPct } : d))
            );
            void saveDraftAnalysis(gameId, activeDraftId, analysisRecord, analysis.reliabilityPct);
          }}
        />
      )}

      {/* Quick Mode batch */}
      <div className="mt-6">
        <LoggingModeSelector value={loggingMode} onChange={setLoggingMode} />
      </div>

      <div className="mt-6">
        <label className="text-xs uppercase tracking-wide text-foreground/40" htmlFor="umpire-name">
          Umpire name
        </label>
        <input
          id="umpire-name"
          value={umpireName}
          onChange={(e) => {
            const value = e.target.value;
            setUmpireName(value);
            setSaved(false);
            if (umpireTimerRef.current) clearTimeout(umpireTimerRef.current);
            umpireTimerRef.current = setTimeout(() => {
              void saveUmpireName(gameId, value);
            }, 1200);
          }}
          required
          className="mt-1 w-full max-w-sm rounded-md border border-border bg-background px-3 py-2 text-sm text-white outline-none focus:border-accent-primary"
        />
      </div>

      {/* Feature B: Lock Lineup / locked badge + Unlock. */}
      <div className="mt-4 max-w-sm">
        {isLocked ? (
          <div className="flex items-center gap-3 rounded-md border border-accent-green/40 bg-accent-green/10 px-3 py-2">
            <span className="text-sm font-semibold text-accent-green">✓ Lineup locked</span>
            <button
              type="button"
              onClick={handleUnlock}
              disabled={isLocking}
              className="ml-auto text-xs font-medium text-foreground/60 underline hover:text-white disabled:opacity-50"
            >
              Unlock to edit
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleLock}
            disabled={!canLock || isLocking}
            className="w-full rounded-md border border-accent-gold/60 px-4 py-2 text-sm font-semibold text-accent-gold transition hover:bg-accent-gold/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isLocking ? "Locking…" : "Lock Lineup"}
          </button>
        )}
      </div>

      <div className="mt-4 flex max-w-sm gap-2">
        <button
          type="button"
          onClick={saveDraft}
          disabled={isSaving}
          className="flex-1 rounded-md border border-border px-4 py-2 text-sm font-medium text-white transition hover:border-accent-primary disabled:opacity-50"
        >
          {isSaving ? "Saving…" : "Save Draft"}
        </button>
        <button
          type="button"
          onClick={start}
          disabled={isStarting}
          className="flex-1 rounded-md bg-accent-green px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-green/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isStarting ? "Starting…" : "Start Game"}
        </button>
      </div>
      {saved && <p className="mt-2 text-sm text-accent-green">Draft saved ✓</p>}
      {!canLock && !isLocked && (
        <p className="mt-1 text-xs text-foreground/40">{filledCount}/9 players placed on &ldquo;{activeDraft.name}&rdquo;.</p>
      )}
      {error && <p className="mt-2 text-sm text-accent-red">{error}</p>}

      {/* Feature B: "If none is locked, prompt..." */}
      {showLockPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="glossy w-full max-w-sm rounded-lg border border-accent-amber/40 bg-surface p-5">
            <p className="font-heading text-lg font-bold text-white">Lock your lineup first</p>
            <p className="mt-2 text-sm text-foreground/70">
              Start Game uses the official, locked lineup. Lock &ldquo;{activeDraft.name}&rdquo; now?
            </p>
            {!canLock && <p className="mt-2 text-xs text-accent-amber">This draft only has {filledCount}/9 players placed.</p>}
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={lockThenStart}
                disabled={!canLock || isLocking}
                className="rounded-md bg-accent-gold px-4 py-2 text-sm font-semibold text-background disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLocking ? "Locking…" : `Lock "${activeDraft.name}" & Start`}
              </button>
              <button
                type="button"
                onClick={() => setShowLockPrompt(false)}
                className="text-center text-xs text-foreground/40 hover:text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Launch-audit Fix 7: a real choice, not a block. */}
      {activeConflict && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="glossy w-full max-w-sm rounded-lg border border-accent-amber/40 bg-surface p-5">
            <p className="font-heading text-lg font-bold text-white">Game already in progress</p>
            <p className="mt-2 text-sm text-foreground/70">
              You have another game in progress (vs {activeConflict.opponentName}). Do you want to end that game
              first or continue with this one?
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={endPreviousAndStart}
                disabled={isResolvingConflict}
                className="rounded-md bg-accent-amber px-4 py-2 text-sm font-semibold text-background disabled:opacity-50"
              >
                {isResolvingConflict ? "Working…" : "End previous game"}
              </button>
              <button
                type="button"
                onClick={continueAnyway}
                disabled={isResolvingConflict}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium text-white hover:border-accent-primary disabled:opacity-50"
              >
                Continue with new game
              </button>
              <button
                type="button"
                onClick={() => setActiveConflict(null)}
                disabled={isResolvingConflict}
                className="text-center text-xs text-foreground/40 hover:text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Print Lineup only activates once the lineup is locked -- before
          that, the official `lineup` table has nothing from this
          feature's own flow for the printout to show. */}
      <div className="mt-3 max-w-sm">
        {isLocked ? (
          <Link
            href={`/coach/games/${gameId}/lineup-print`}
            className="inline-block rounded-md border border-accent-gold/50 px-4 py-2 text-sm font-semibold text-accent-gold hover:bg-accent-gold/10"
          >
            Print Lineup
          </Link>
        ) : (
          <span
            title="Lock the lineup first"
            className="inline-block cursor-not-allowed rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground/30"
          >
            Print Lineup
          </span>
        )}
      </div>

      {picker && (
        <PositionPickerMenu
          anchor={picker.anchor}
          playerId={picker.playerId}
          playerLabel={playerName(picker.playerId)}
          placements={placements}
          playerName={playerName}
          onPick={(position) => {
            placePlayer(picker.playerId, position);
            setPicker(null);
          }}
          onRemove={() => {
            removePlayer(picker.playerId);
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

// Change 2: a generic labeled drop target, used for both DH and EH.
function DropZone({
  label,
  hint,
  active,
  onDragOver,
  onDragLeave,
  onDrop,
  children,
}: {
  label: string;
  hint: string;
  active: boolean;
  onDragOver: () => void;
  onDragLeave: () => void;
  onDrop: (playerId: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver();
      }}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault();
        onDragLeave();
        const playerId = e.dataTransfer.getData("text/plain");
        if (playerId) onDrop(playerId);
      }}
      className={`flex min-h-[72px] flex-col items-center justify-center gap-0.5 rounded-md border-2 border-dashed p-2 text-center transition ${
        active ? "border-accent-gold bg-accent-gold/10" : "border-border bg-background/40"
      }`}
    >
      <span className="text-[10px] font-semibold text-foreground/50">
        {label} <span className="font-normal text-foreground/30">({hint})</span>
      </span>
      {children}
    </div>
  );
}

// The on-field gold-circle avatar. Feature A: tapping it (not the
// remove button) opens the position picker for an already-placed
// player, per "tapping an already-placed player lets the coach move or
// remove him" -- removal stays its own dedicated button too, unchanged.
function PositionedAvatar({
  x,
  y,
  jersey,
  battingOrder,
  onTap,
  onRemove,
}: {
  x: number;
  y: number;
  jersey: number | null;
  battingOrder: number;
  onTap: (e: React.MouseEvent) => void;
  onRemove: () => void;
}) {
  return (
    <div className="avatar-snap absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${x}%`, top: `${y}%` }}>
      <div className="relative flex flex-col items-center">
        <button
          type="button"
          onClick={onTap}
          className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-background text-xs font-bold text-background shadow-lg"
          style={{ backgroundColor: "#F0C060" }}
        >
          {jersey ?? "?"}
        </button>
        <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-background bg-accent-primary text-[9px] font-bold text-white">
          {battingOrder}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="mt-1 rounded bg-background/80 px-1 text-[9px] font-semibold text-foreground/50 hover:text-accent-red"
        >
          remove
        </button>
      </div>
    </div>
  );
}

const RATING_STYLE: Record<LiveLineupFeedback["rating"], { emoji: string; color: string }> = {
  EXCELLENT: { emoji: "🌟", color: "#2ECC71" },
  GOOD: { emoji: "✅", color: "#2ECC71" },
  CONSIDER: { emoji: "❓", color: "#EF9F27" },
  MISTAKE: { emoji: "⚠️", color: "#E24B4A" },
  BLUNDER: { emoji: "💀", color: "#E24B4A" },
};

const OVERRIDE_REASONS = ["Player preference", "Matchup reason", "Team chemistry", "Injury concern", "Other"];

function LiveFeedbackBadge({
  feedback,
  showOverridePrompt,
  onOverrideReason,
}: {
  feedback: LiveLineupFeedback | "loading" | undefined;
  showOverridePrompt: boolean;
  onOverrideReason: (reason: string) => void;
}) {
  if (!feedback) return null;
  if (feedback === "loading") {
    return <p className="mt-1 pl-7 text-xs text-foreground/40">KAIROS is checking this placement…</p>;
  }
  const style = RATING_STYLE[feedback.rating];
  return (
    <div className="mt-1 pl-7">
      <p className="text-xs font-semibold" style={{ color: style.color }}>
        {style.emoji} {feedback.rating} — {feedback.message}
      </p>
      {feedback.alternative && <p className="text-xs text-foreground/60">{feedback.alternative}</p>}
      <p className="text-[10px] text-foreground/40">
        {feedback.reliabilityScore < 30 ? "🔴" : feedback.reliabilityScore < 60 ? "🟡" : feedback.reliabilityScore < 86 ? "🟢" : "💎"}{" "}
        {feedback.reliabilityScore}% reliable — {feedback.reliabilityGames} game{feedback.reliabilityGames === 1 ? "" : "s"} only
      </p>
      {showOverridePrompt && (
        <div className="mt-1 rounded-md border border-accent-amber/40 bg-accent-amber/10 p-2">
          <p className="text-xs text-accent-amber">Why are you keeping this placement?</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {OVERRIDE_REASONS.map((reason) => (
              <button
                key={reason}
                type="button"
                onClick={() => onOverrideReason(reason)}
                className="rounded border border-accent-amber/50 px-2 py-0.5 text-[10px] text-accent-amber hover:bg-accent-amber/20"
              >
                {reason}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// DH/EH's drop-zone chip -- no absolute positioning, just sits inside
// its labeled box. Feature A: tapping the avatar (not the remove
// button) opens the picker, same as PositionedAvatar.
function PlacedAvatarChip({
  name,
  jersey,
  battingOrder,
  onTap,
  onRemove,
}: {
  name: string;
  jersey: number | null;
  battingOrder: number;
  onTap: (e: React.MouseEvent) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <button
        type="button"
        onClick={onTap}
        className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-background text-[11px] font-bold text-background shadow-lg"
        style={{ backgroundColor: "#F0C060" }}
      >
        {jersey ?? "?"}
      </button>
      <span className="text-[10px] text-white">{name}</span>
      <span className="text-[9px] text-foreground/50">Order: {battingOrder}</span>
      <button type="button" onClick={onRemove} className="text-[9px] text-foreground/40 hover:text-accent-red">
        remove
      </button>
    </div>
  );
}
