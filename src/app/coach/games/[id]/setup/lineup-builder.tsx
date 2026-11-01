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
const STANDARD_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];

// Position/batting-order split batch: a placement's position (where he
// plays) and battingOrder (when he bats) are now fully independent --
// moving a player on the field never touches battingOrder, and
// reordering the batting order never touches position. battingOrder is
// kept as a dense 1..N sequence at all times (see renumberDense) --
// there is no longer a separate, ever-climbing "next number" counter.
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

// Renumbers to a dense 1..N sequence, preserving relative order -- the
// one function responsible for "removing, replacing, or swapping
// players never leaves gaps." Called after every removal (a swap never
// needs it: see placePlayer's swap branch, which trades existing
// numbers between two already-placed players instead of freeing one).
function renumberDense(items: Placement[]): Placement[] {
  return [...items].sort((a, b) => a.battingOrder - b.battingOrder).map((p, i) => ({ ...p, battingOrder: i + 1 }));
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
  // Tap-to-place primary flow: selecting a player (from the roster or
  // already on the field) highlights him and turns every position into
  // a big tap target (see the field overlay below). The old one-shot
  // portal menu (position-picker-menu.tsx) stays wired up as a
  // secondary, explicit fallback via each roster row's "..." button.
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [pendingSwap, setPendingSwap] = useState<{ position: string; occupantName: string } | null>(null);
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
  // pending timer and writes immediately instead. Everything here stays
  // draft-only -- nothing in this function touches the official
  // `lineup` table or anything the operator screen reads.
  function scheduleAutosave() {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    const draftId = activeDraftId;
    autosaveTimerRef.current = setTimeout(() => {
      void saveDraftSlots(gameId, draftId, buildLineupPayloadRef.current());
    }, 1200);
  }
  const buildLineupPayloadRef = useRef(buildLineupPayload);
  buildLineupPayloadRef.current = buildLineupPayload;

  function switchDraft(newId: string) {
    if (newId === activeDraftId) return;
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
      void saveDraftSlots(gameId, activeDraftId, buildLineupPayloadRef.current());
    }
    setActiveDraftId(newId);
    setSelectedPlayerId(null);
    setPendingSwap(null);
  }

  useEffect(() => {
    const draft = drafts.find((d) => d.id === activeDraftId);
    if (!draft) return;
    setPlacements(slotsToPlacements(draft.slots));
    setAbsentPlayerIds(slotsToAbsentSet(draft.slots));
    setFeedbackByPlayerId({});
    setOverrideOpenFor(null);
    setError(null);
    setSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDraftId]);

  function playerName(playerId: string): string {
    const p = players.find((pl) => pl.id === playerId);
    return p ? `#${p.jersey_number ?? "—"} ${p.name}` : "Player";
  }

  function fetchFeedbackFor(playerId: string, assignedOrder: number, snapshot: Placement[]) {
    const lineupSoFar = snapshot
      .filter((p) => p.playerId !== playerId)
      .map((p) => ({ slot: p.battingOrder, playerId: p.playerId }));
    setFeedbackByPlayerId((prev) => ({ ...prev, [playerId]: "loading" }));
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
      // rating comes back -- keeping the placement is already the
      // default, nothing blocks the coach from just changing it instead.
      if (result.feedback.rating === "MISTAKE" || result.feedback.rating === "BLUNDER") {
        setOverrideOpenFor(playerId);
      }
    });
  }

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

  const filledCount = placements.length;

  // Position/batting-order split batch: the single function every
  // placement path (drag, tap-to-place, the old portal menu, and the
  // no-calibration dropdown fallback) calls. Position and batting order
  // are decided completely independently of each other here:
  //
  // - Empty target, player already placed elsewhere -> MOVE. Position
  //   changes, battingOrder is untouched.
  // - Empty target, player not yet placed -> NEW. Appended with the
  //   next dense number (placements.length + 1) -- always a clean
  //   append since the array never carries a gap in the first place.
  // - Occupied target, mover already placed -> SWAP. The two players
  //   trade position AND battingOrder completely -- nobody is removed,
  //   so density is never at risk here either.
  // - Occupied target, mover not yet placed (from the roster/bench) ->
  //   the mover takes the occupant's exact slot (position + batting
  //   order); the occupant goes to the bench. The vacated number is
  //   immediately reused by the mover, so this never creates a gap.
  function placePlayer(playerId: string, position: string) {
    setError(null);
    setSaved(false);
    const mover = placements.find((p) => p.playerId === playerId);
    const occupant = placements.find((p) => p.position === position && p.playerId !== playerId);

    if (!occupant) {
      if (mover) {
        setPlacements((prev) => prev.map((p) => (p.playerId === playerId ? { ...p, position } : p)));
        scheduleAutosave();
        return;
      }
      const assignedOrder = placements.length + 1;
      const snapshot = placements;
      setPlacements((prev) => [...prev, { playerId, position, battingOrder: assignedOrder }]);
      setOverrideOpenFor((cur) => cur);
      scheduleAutosave();
      fetchFeedbackFor(playerId, assignedOrder, snapshot);
      return;
    }

    if (mover) {
      const moverOldPosition = mover.position;
      const moverOldOrder = mover.battingOrder;
      const occupantOldOrder = occupant.battingOrder;
      const snapshot = placements;
      setPlacements((prev) =>
        prev.map((p) => {
          if (p.playerId === playerId) return { ...p, position, battingOrder: occupantOldOrder };
          if (p.playerId === occupant.playerId) return { ...p, position: moverOldPosition, battingOrder: moverOldOrder };
          return p;
        })
      );
      scheduleAutosave();
      fetchFeedbackFor(playerId, occupantOldOrder, snapshot);
      fetchFeedbackFor(occupant.playerId, moverOldOrder, snapshot);
      return;
    }

    const assignedOrder = occupant.battingOrder;
    const bumpedId = occupant.playerId;
    const snapshot = placements.filter((p) => p.playerId !== bumpedId);
    setPlacements((prev) => [...prev.filter((p) => p.playerId !== bumpedId), { playerId, position, battingOrder: assignedOrder }]);
    setFeedbackByPlayerId((prev) => {
      const next = { ...prev };
      delete next[bumpedId];
      return next;
    });
    setOverrideOpenFor((cur) => (cur === bumpedId ? null : cur));
    scheduleAutosave();
    fetchFeedbackFor(playerId, assignedOrder, snapshot);
  }

  // Standalone removal (the "Remove" button/action, not a swap) is the
  // one path that actually frees a number -- renumberDense immediately
  // closes the resulting gap. Every remaining player's slot can shift
  // as a result, so any cached feedback referencing a now-stale slot
  // number is cleared rather than left showing the wrong thing.
  function removePlayer(playerId: string) {
    setError(null);
    setSaved(false);
    setPlacements((prev) => renumberDense(prev.filter((p) => p.playerId !== playerId)));
    setFeedbackByPlayerId({});
    setOverrideOpenFor(null);
    scheduleAutosave();
  }

  function recordOverride(playerId: string, slot: number, rating: string, reason: string) {
    setOverrideOpenFor(null);
    setOverrideLoggedFor((prev) => new Set(prev).add(playerId));
    void logLineupOverride(gameId, playerId, slot, rating, reason);
  }

  // Batting-order-card batch: placements, sorted for the card. Always
  // already a dense 1..N by construction (placePlayer/removePlayer both
  // maintain that), so this is purely a display sort, not a renumber.
  const orderedPlacements = [...placements].sort((a, b) => a.battingOrder - b.battingOrder);

  // Drag rows, the up/down arrows, and the slot-number dropdown all
  // call this one function -- a genuine reorder (unlike field removal)
  // renumbers everyone to a clean, contiguous 1..N, since that's what
  // "move this row to position N" means for a batting order.
  function reorderBattingOrder(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    const ids = orderedPlacements.map((p) => p.playerId);
    const [movedId] = ids.splice(fromIndex, 1);
    ids.splice(toIndex, 0, movedId);
    const orderByPlayerId = new Map(ids.map((id, i) => [id, i + 1]));
    setError(null);
    setSaved(false);
    setPlacements((prev) => prev.map((p) => ({ ...p, battingOrder: orderByPlayerId.get(p.playerId) ?? p.battingOrder })));
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

  // Tap-to-place primary flow -------------------------------------------------

  function selectPlayer(playerId: string) {
    setPendingSwap(null);
    setSelectedPlayerId((cur) => (cur === playerId ? null : playerId));
  }

  function cancelSelection() {
    setSelectedPlayerId(null);
    setPendingSwap(null);
  }

  function handleFieldTargetTap(position: string) {
    if (!selectedPlayerId) return;
    const occupant = placements.find((p) => p.position === position && p.playerId !== selectedPlayerId);
    if (occupant) {
      setPendingSwap({ position, occupantName: playerName(occupant.playerId) });
      return;
    }
    placePlayer(selectedPlayerId, position);
    setSelectedPlayerId(null);
  }

  function confirmPendingSwap() {
    if (!selectedPlayerId || !pendingSwap) return;
    placePlayer(selectedPlayerId, pendingSwap.position);
    setPendingSwap(null);
    setSelectedPlayerId(null);
  }

  // The old one-shot portal menu, kept as an explicit fallback (reached
  // via each roster row's "..." button) -- unchanged, still calls the
  // exact same placePlayer/removePlayer.
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
  const selectedPlacement = selectedPlayerId ? placements.find((p) => p.playerId === selectedPlayerId) ?? null : null;

  // Backdrop trick: clicking the root div's own empty space (not any
  // child -- e.target === e.currentTarget only matches when the click
  // landed directly on this element) deselects. The explicit Cancel
  // button in the banner below is the reliable path either way.
  function handleRootClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget && selectedPlayerId) cancelSelection();
  }

  return (
    <div onClick={handleRootClick}>
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

      {/* Feature B: draft switcher. Everything here is draft-only --
          nothing below affects the operator screen or Start Game until
          Lock Lineup. */}
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

      {/* Tap-to-place banner -- the primary flow on phones. */}
      {selectedPlayerId && (
        <div className="sticky top-2 z-30 mb-3 flex flex-wrap items-center gap-3 rounded-md border-2 border-accent-gold bg-accent-gold/15 px-3 py-2 shadow-lg">
          <span className="text-sm font-semibold text-accent-gold">Placing: {playerName(selectedPlayerId)}, tap a position</span>
          <div className="ml-auto flex items-center gap-2">
            {selectedPlacement && (
              <button
                type="button"
                onClick={() => {
                  removePlayer(selectedPlayerId);
                  setSelectedPlayerId(null);
                }}
                className="min-h-[36px] rounded-md border border-accent-red/50 px-3 text-xs font-semibold text-accent-red hover:bg-accent-red/10"
              >
                Remove
              </button>
            )}
            <button
              type="button"
              onClick={cancelSelection}
              className="min-h-[36px] rounded-md border border-border px-3 text-xs font-medium text-white hover:border-accent-primary"
            >
              Cancel
            </button>
          </div>
          {pendingSwap && (
            <div className="flex w-full items-center gap-2 rounded-md border border-accent-amber/50 bg-accent-amber/10 px-2 py-1.5">
              <span className="text-xs text-white">
                Swap with <strong>{pendingSwap.occupantName}</strong>?
              </span>
              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={confirmPendingSwap}
                  className="min-h-[40px] rounded-md bg-accent-green px-3 text-xs font-semibold text-white hover:bg-accent-green/90"
                >
                  Swap
                </button>
                <button
                  type="button"
                  onClick={() => setPendingSwap(null)}
                  className="min-h-[40px] rounded-md border border-border px-3 text-xs text-white hover:border-accent-primary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <p className="text-xs uppercase tracking-wide text-foreground/40">
        Tap a player, then tap a position -- or drag a player onto the field (or DH/EH) by the ⠿ handle. Position and
        batting order are separate: moving a player never changes when he bats.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr_240px]">
        {/* Roster */}
        <div>
          <p className="text-xs uppercase tracking-wide text-foreground/40">Roster</p>
          <ul className="mt-2 flex max-h-[300px] flex-col gap-1.5 overflow-y-auto pr-1">
            {availablePlayers.map((p) => (
              <li key={p.id} className="flex items-center gap-1.5">
                <div
                  onClick={() => selectPlayer(p.id)}
                  className={`flex flex-1 items-center gap-1 rounded-md border px-2 py-1.5 text-sm text-white transition ${
                    selectedPlayerId === p.id
                      ? "border-accent-gold ring-2 ring-accent-gold"
                      : "border-border bg-background/40 hover:border-accent-primary"
                  }`}
                >
                  {/* Bigger drag handle -- touch-action: none lives only
                      here now, not on the whole row, so the roster list
                      itself still scrolls normally on a phone. */}
                  <span
                    draggable
                    onDragStart={(e) => handleDragStart(e, p.id)}
                    onDragEnd={() => setDragOver(null)}
                    style={{ touchAction: "none" }}
                    title="Drag to place"
                    className="-ml-1 flex h-8 w-6 shrink-0 cursor-grab items-center justify-center text-base text-foreground/40 active:cursor-grabbing"
                  >
                    ⠿
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    #{p.jersey_number ?? "—"} {p.name}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => openPicker(e, p.id)}
                    title="Pick from a list instead"
                    className="shrink-0 px-1 text-foreground/30 hover:text-white"
                  >
                    ⋯
                  </button>
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
                      selected={selectedPlayerId === p.playerId}
                      dimmed={Boolean(selectedPlayerId) && selectedPlayerId !== p.playerId}
                      onTap={() => selectPlayer(p.playerId)}
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
                  selected={selectedPlayerId === dhPlacement.playerId}
                  dimmed={Boolean(selectedPlayerId) && selectedPlayerId !== dhPlacement.playerId}
                  onTap={() => selectPlayer(dhPlacement.playerId)}
                  onRemove={() => removePlayer(dhPlacement.playerId)}
                />
              )}

              {/* Problem 2: while a player is selected, every calibrated
                  field position becomes a large (>=48px) tap target --
                  the primary way to place/move/swap on a phone. */}
              {selectedPlayerId &&
                STANDARD_POSITIONS.map((pos) => {
                  const loc = fieldPositionsCalibration[pos as keyof PlayerPositionCalibration];
                  if (!loc) return null;
                  const occupant = placements.find((p) => p.position === pos);
                  const isOwn = occupant?.playerId === selectedPlayerId;
                  return (
                    <button
                      key={`target-${pos}`}
                      type="button"
                      onClick={() => handleFieldTargetTap(pos)}
                      className="absolute flex min-h-[48px] min-w-[48px] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-0 rounded-full border-2 border-dashed text-[10px] font-bold text-white"
                      style={{
                        left: `${loc.x}%`,
                        top: `${loc.y}%`,
                        borderColor: isOwn ? "#2ECC71" : "#F0C060",
                        background: occupant ? "rgba(240,192,96,0.3)" : "rgba(46,204,113,0.2)",
                      }}
                    >
                      <span>{pos}</span>
                      {occupant && !isOwn && <span className="text-[8px] font-normal text-white/80">swap</span>}
                    </button>
                  );
                })}
            </div>
          ) : (
            <FallbackPositionList players={players} placements={placements} onAssign={placePlayer} onRemove={removePlayer} />
          )}

          <div className="mt-3 grid w-full max-w-[420px] grid-cols-2 gap-2">
            <DropZone
              label="DH"
              hint="Designated Hitter — optional"
              active={dragOver === "dh"}
              selecting={Boolean(selectedPlayerId)}
              onDragOver={() => setDragOver("dh")}
              onDragLeave={() => setDragOver((d) => (d === "dh" ? null : d))}
              onDrop={(playerId) => placePlayer(playerId, DH)}
              onTapTarget={() => handleFieldTargetTap(DH)}
            >
              {dhPlacement && !dhFieldLoc ? (
                <PlacedAvatarChip
                  battingOrder={dhPlacement.battingOrder}
                  jersey={players.find((pl) => pl.id === dhPlacement.playerId)?.jersey_number ?? null}
                  name={playerName(dhPlacement.playerId)}
                  onTap={() => selectPlayer(dhPlacement.playerId)}
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
              selecting={Boolean(selectedPlayerId)}
              onDragOver={() => setDragOver("eh")}
              onDragLeave={() => setDragOver((d) => (d === "eh" ? null : d))}
              onDrop={(playerId) => placePlayer(playerId, EH)}
              onTapTarget={() => handleFieldTargetTap(EH)}
            >
              {ehPlacement ? (
                <PlacedAvatarChip
                  battingOrder={ehPlacement.battingOrder}
                  jersey={players.find((pl) => pl.id === ehPlacement.playerId)?.jersey_number ?? null}
                  name={playerName(ehPlacement.playerId)}
                  onTap={() => selectPlayer(ehPlacement.playerId)}
                  onRemove={() => removePlayer(ehPlacement.playerId)}
                />
              ) : (
                <span className="text-xs text-foreground/40">Drop EH here</span>
              )}
            </DropZone>
          </div>
        </div>

        {/* Batting-order-card batch: fully independent reordering now --
            drag (by its own handle), up/down arrows, or jump straight to
            a slot number. None of this ever touches position. */}
        <div className="glossy rounded-lg border-l-4 border-l-accent-green bg-surface p-3">
          <p className="font-heading text-sm font-semibold uppercase tracking-wide text-white">Batting Order</p>
          <div className="mt-2 border-b border-border" />
          <ul className="mt-2 flex flex-col gap-1">
            {orderedPlacements.map((p, i) => (
              <li
                key={p.playerId}
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
                className={`rounded-md border px-2 py-1.5 text-sm transition ${
                  dragOverOrderIndex === i ? "border-accent-gold bg-accent-gold/10" : "border-transparent hover:border-border"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <div className="flex flex-col leading-none">
                    <button
                      type="button"
                      onClick={() => reorderBattingOrder(i, Math.max(0, i - 1))}
                      disabled={i === 0}
                      title="Move up"
                      className="px-1 text-[10px] text-foreground/50 hover:text-white disabled:opacity-20"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => reorderBattingOrder(i, Math.min(orderedPlacements.length - 1, i + 1))}
                      disabled={i === orderedPlacements.length - 1}
                      title="Move down"
                      className="px-1 text-[10px] text-foreground/50 hover:text-white disabled:opacity-20"
                    >
                      ▼
                    </button>
                  </div>
                  <select
                    value={p.battingOrder}
                    onChange={(e) => reorderBattingOrder(i, Number(e.target.value) - 1)}
                    title="Jump to slot"
                    className="w-11 shrink-0 rounded border border-border bg-background py-1 text-center font-heading text-sm font-bold text-accent-gold outline-none focus:border-accent-primary"
                  >
                    {orderedPlacements.map((_, idx) => (
                      <option key={idx} value={idx + 1}>
                        {idx + 1}
                      </option>
                    ))}
                  </select>
                  {/* Bigger drag handle, touch-action: none only here. */}
                  <span
                    draggable
                    onDragStart={(e) => {
                      setDraggedOrderIndex(i);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", p.playerId);
                    }}
                    onDragEnd={() => {
                      setDraggedOrderIndex(null);
                      setDragOverOrderIndex(null);
                    }}
                    style={{ touchAction: "none" }}
                    title="Drag to reorder"
                    className="flex h-8 w-6 shrink-0 cursor-grab items-center justify-center text-base text-foreground/30 active:cursor-grabbing"
                  >
                    ⠿
                  </span>
                  <span
                    onClick={() => selectPlayer(p.playerId)}
                    className={`min-w-0 flex-1 cursor-pointer truncate font-sans ${
                      selectedPlayerId === p.playerId ? "font-semibold text-accent-gold" : "text-white hover:underline"
                    }`}
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
              <li className="px-2 py-3 text-center text-xs text-foreground/30">Tap or drag players onto the field to build the order.</li>
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

      {/* Old one-shot portal menu -- kept as an explicit fallback,
          reachable via each roster row's "..." button. */}
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
// Problem 2: also doubles as a big tap target while a player is
// selected (onTapTarget), consistent with the field overlay's own
// occupied/empty styling.
function DropZone({
  label,
  hint,
  active,
  selecting,
  onDragOver,
  onDragLeave,
  onDrop,
  onTapTarget,
  children,
}: {
  label: string;
  hint: string;
  active: boolean;
  selecting: boolean;
  onDragOver: () => void;
  onDragLeave: () => void;
  onDrop: (playerId: string) => void;
  onTapTarget: () => void;
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
      onClick={selecting ? onTapTarget : undefined}
      className={`flex min-h-[72px] flex-col items-center justify-center gap-0.5 rounded-md border-2 border-dashed p-2 text-center transition ${
        active || selecting ? "border-accent-gold bg-accent-gold/10" : "border-border bg-background/40"
      }`}
    >
      <span className="text-[10px] font-semibold text-foreground/50">
        {label} <span className="font-normal text-foreground/30">({hint})</span>
      </span>
      {children}
    </div>
  );
}

// The on-field gold-circle avatar. Problem 2: tapping it now selects
// the player for moving/swapping (not an immediate menu) -- removal
// stays its own dedicated button. Dims slightly when a *different*
// player is selected, so the one being placed doesn't get lost among
// the rest of the field.
function PositionedAvatar({
  x,
  y,
  jersey,
  battingOrder,
  selected,
  dimmed,
  onTap,
  onRemove,
}: {
  x: number;
  y: number;
  jersey: number | null;
  battingOrder: number;
  selected: boolean;
  dimmed: boolean;
  onTap: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className="avatar-snap absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${x}%`, top: `${y}%`, opacity: dimmed ? 0.45 : 1 }}
    >
      <div className="relative flex flex-col items-center">
        <button
          type="button"
          onClick={onTap}
          className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold text-background shadow-lg ${
            selected ? "border-accent-gold ring-2 ring-accent-gold" : "border-background"
          }`}
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
// its labeled box. Problem 2: tapping the avatar selects it, same as
// PositionedAvatar.
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
  onTap: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      {/* stopPropagation: this chip sits inside DropZone, which has its
          own onClick (the big tap target for the *other* player's
          selection) -- without this, tapping an occupied DH/EH chip
          while someone else is selected would both re-select this
          occupant AND fire the DropZone's own tap-target handler for
          the stale previous selection in the same event, corrupting
          which player the pending swap is actually for. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onTap();
        }}
        className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-background text-[11px] font-bold text-background shadow-lg"
        style={{ backgroundColor: "#F0C060" }}
      >
        {jersey ?? "?"}
      </button>
      <span className="text-[10px] text-white">{name}</span>
      <span className="text-[9px] text-foreground/50">Order: {battingOrder}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="text-[9px] text-foreground/40 hover:text-accent-red"
      >
        remove
      </button>
    </div>
  );
}
