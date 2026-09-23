"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import type { Database, PlayerPositionCalibration } from "@/lib/supabase/types";
import { nearestSavedPosition } from "@/lib/field-zones";
import { saveLineupAndUmpire, startGame, type LineupSlot } from "./actions";

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

export function LineupBuilder({
  gameId,
  players,
  initialLineup,
  initialUmpireName,
  fieldPositionsCalibration,
}: {
  gameId: string;
  players: Player[];
  // Feature 1 (lineup-status batch): position/status nullable -- a
  // reserve or absent row has neither, status carries the meaning
  // instead. batting_order stays nullable in the DB shape (a reserve/
  // absent row still has none), but every row that DOES have a position
  // also has a batting_order (both are written together by
  // buildLineupPayload) -- asserted non-null below for exactly those rows.
  initialLineup: { batting_order: number | null; player_id: string; position: string | null; status: string | null }[];
  initialUmpireName: string | null;
  // Change 2 (calibrate-field-tabs batch): the "Player Positions"
  // calibration tab's saved points -- null when the coach hasn't
  // calibrated it yet, a real, expected state. Dropping a player snaps
  // to whichever saved point is closest, no math or interpolation, and
  // field placement is genuinely blocked (DH/EH and umpire name still
  // work) until this is calibrated.
  fieldPositionsCalibration: PlayerPositionCalibration | null;
}) {
  const [placements, setPlacements] = useState<Placement[]>(() =>
    initialLineup
      .filter((l) => l.position)
      .map((l) => ({ playerId: l.player_id, position: l.position!, battingOrder: l.batting_order! }))
  );
  // Auto-batting-order batch: the next number to hand out, incremented
  // every successful drop and never decremented or reused -- removing a
  // player frees their number but leaves a gap (per spec: "do NOT
  // renumber everyone else"), and re-dragging them back in assigns a
  // fresh, later number rather than restoring the old one. Seeded from
  // whatever's already saved so reopening a partially-built lineup
  // continues the sequence instead of restarting it.
  const [nextBattingOrder, setNextBattingOrder] = useState(() => {
    const existing = initialLineup
      .filter((l) => l.position)
      .map((l) => l.batting_order)
      .filter((n): n is number => n !== null);
    return existing.length > 0 ? Math.max(...existing) + 1 : 1;
  });
  const [absentPlayerIds, setAbsentPlayerIds] = useState<Set<string>>(
    () => new Set(initialLineup.filter((l) => l.status === "absent").map((l) => l.player_id))
  );
  const [umpireName, setUmpireName] = useState(initialUmpireName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Fix 1 (print-lineup batch): "Print Lineup should only be active
  // after save" -- distinct from `saved` (which flips back to false on
  // every single edit, per the existing pattern, to force a re-save
  // before Start Game trusts stale data). hasSavedLineup instead tracks
  // "has this game ever had a lineup persisted," so Print Lineup stays
  // enabled across further edits made in the same visit (those edits
  // just aren't reflected in the printed card until saved again) rather
  // than flickering disabled on every keystroke. Seeded true when the
  // page loads with existing starting rows (a previous save from an
  // earlier visit), so reopening setup doesn't force a redundant re-save
  // just to unlock printing.
  const [hasSavedLineup, setHasSavedLineup] = useState(() => initialLineup.some((l) => l.status === "starting"));
  const [isSaving, startSave] = useTransition();
  const [isStarting, startStart] = useTransition();
  const [dragOver, setDragOver] = useState<"field" | "dh" | "eh" | null>(null);
  // Batting-order-card batch: drag-reorder state for the card's own rows
  // -- separate from `dragOver` (roster -> field/DH/EH placement), since
  // this drag never touches the roster or the drop zones at all.
  const [draggedOrderIndex, setDraggedOrderIndex] = useState<number | null>(null);
  const [dragOverOrderIndex, setDragOverOrderIndex] = useState<number | null>(null);
  const fieldRef = useRef<HTMLDivElement>(null);

  const placedPlayerIds = new Set(placements.map((p) => p.playerId));
  const availablePlayers = players.filter((p) => !placedPlayerIds.has(p.id) && !absentPlayerIds.has(p.id));
  const absentPlayers = players.filter((p) => !placedPlayerIds.has(p.id) && absentPlayerIds.has(p.id));

  function markAbsent(playerId: string) {
    setError(null);
    setSaved(false);
    setAbsentPlayerIds((prev) => new Set(prev).add(playerId));
  }

  function markAvailable(playerId: string) {
    setError(null);
    setSaved(false);
    setAbsentPlayerIds((prev) => {
      const next = new Set(prev);
      next.delete(playerId);
      return next;
    });
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
  // (unplaced) rather than blocking with an error -- see the earlier
  // batch's write-up for why a full chain UI doesn't map onto pre-game
  // setup. Auto-batting-order batch: the newly dropped player always
  // gets the *next* sequential number, never the bumped player's old
  // one -- that number is simply freed, per spec ("do NOT renumber
  // everyone else"). Only a roster/absent player is ever draggable here
  // (an already-placed avatar has no `draggable` attribute -- it's
  // removed via its own "remove" button instead), so there's never an
  // existing placement on the dragged side to preserve an order from.
  function placePlayer(playerId: string, position: string) {
    const conflict = placements.find((p) => p.position === position && p.playerId !== playerId);
    setError(null);
    setSaved(false);
    const assignedOrder = nextBattingOrder;
    setPlacements((prev) => [
      ...prev.filter((p) => p.playerId !== playerId && p.playerId !== conflict?.playerId),
      { playerId, position, battingOrder: assignedOrder },
    ]);
    setNextBattingOrder((n) => n + 1);
  }

  // Removing a placement just drops it from the array -- the
  // roster-membership filter above picks the player back up on its own.
  // nextBattingOrder is deliberately untouched: the freed number is
  // never reused, per spec.
  function removePlayer(playerId: string) {
    setError(null);
    setSaved(false);
    setPlacements((prev) => prev.filter((p) => p.playerId !== playerId));
  }

  // Batting-order-card batch: placements, sorted for the card. Whatever
  // gaps field-removal left behind (deliberately not renumbered, per the
  // earlier batch) show up here as-is until the first card reorder --
  // see reorderBattingOrder below for why a reorder is the one operation
  // that does renumber everything.
  const orderedPlacements = [...placements].sort((a, b) => a.battingOrder - b.battingOrder);

  // Batting-order-card batch: dragging a row to a new spot in the card
  // is a real reorder, not a removal -- unlike field-removal (which
  // deliberately leaves a gap), every player's number is recomputed as a
  // clean, contiguous 1..N here, since that's what "drag row up/down"
  // means for a batting order (there's no such thing as batting 1st,
  // 2nd, then a gap, then 4th). Only the field/DH/EH *position* is
  // untouched -- this only ever changes battingOrder. nextBattingOrder
  // is reset to length+1 so a future field drop continues cleanly after
  // the now-contiguous numbers instead of picking up a stale, possibly
  // colliding value from before the renumber.
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

  function buildLineupPayload(): LineupSlot[] {
    // Auto-batting-order batch: every entry in `placements` already has
    // both a position and a real batting order by construction (see
    // placePlayer) -- no readiness filter needed here any more.
    const starting: LineupSlot[] = placements.map((p) => ({
      batting_order: p.battingOrder,
      player_id: p.playerId,
      position: p.position,
      status: "starting",
    }));

    // Feature 1: every other roster player also gets a row now, purely
    // to carry status -- reserve (the default) or absent.
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

  function save() {
    setError(null);
    startSave(async () => {
      try {
        await saveLineupAndUmpire(gameId, { lineup: buildLineupPayload(), umpireName });
        setSaved(true);
        setHasSavedLineup(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save");
      }
    });
  }

  function start() {
    setError(null);
    startStart(async () => {
      try {
        // Start reads the lineup/umpire name back from the database, so
        // the in-progress edits here must be persisted first -- this is
        // the "auto-save when Start Game is clicked" half of Fix 1.
        await saveLineupAndUmpire(gameId, { lineup: buildLineupPayload(), umpireName });
        setHasSavedLineup(true);
        await startGame(gameId);
        window.location.href = `/operator?game=${gameId}`;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start game");
      }
    });
  }

  // 9 players placed on the field (each already carries a position and
  // an auto-assigned batting order the instant they're dropped -- no
  // separate readiness check needed) plus a non-blank umpire name. Both
  // conditions read live off placements/umpireName every render.
  const canStart = filledCount >= 9 && umpireName.trim().length > 0;
  const dhPlacement = placements.find((p) => p.position === DH) ?? null;
  const ehPlacement = placements.find((p) => p.position === EH) ?? null;
  const dhFieldLoc = fieldPositionsCalibration?.DH ?? null;

  return (
    <div>
      {!fieldPositionsCalibration && (
        <p className="mb-3 rounded-md border border-accent-amber/40 bg-accent-amber/10 px-3 py-2 text-xs text-accent-amber">
          Calibrate player positions first —{" "}
          <a href="/coach/calibrate-field" className="underline hover:text-white">
            /coach/calibrate-field
          </a>
          . DH/EH still work in the meantime, but field positions can&apos;t be placed until then.
        </p>
      )}

      <p className="text-xs uppercase tracking-wide text-foreground/40">
        Drag a player onto the field (or DH/EH) to place them -- batting order is assigned automatically, in the order
        you drag players on.
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
          <div
            ref={fieldRef}
            onDragOver={(e) => {
              if (!fieldPositionsCalibration) return;
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
            {fieldPositionsCalibration &&
              placements
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
                onRemove={() => removePlayer(dhPlacement.playerId)}
              />
            )}

            {!fieldPositionsCalibration && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 p-4 text-center">
                <p className="text-xs text-foreground/60">Not calibrated — see the banner above.</p>
              </div>
            )}
          </div>

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
                  onRemove={() => removePlayer(ehPlacement.playerId)}
                />
              ) : (
                <span className="text-xs text-foreground/40">Drop EH here</span>
              )}
            </DropZone>
          </div>
        </div>

        {/* Batting-order-card batch: a live, reorderable view of the same
            placements array the field/DH/EH already render from -- one
            source of truth, two views. Dragging a row here only ever
            touches battingOrder (see reorderBattingOrder); it never
            changes anyone's position or removes anyone from the field. */}
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
                className={`flex cursor-grab items-center gap-2 rounded-md border px-2 py-1.5 text-sm transition active:cursor-grabbing ${
                  dragOverOrderIndex === i ? "border-accent-gold bg-accent-gold/10" : "border-transparent hover:border-border"
                }`}
              >
                <span className="font-heading w-5 shrink-0 text-right font-bold text-accent-gold">{p.battingOrder}</span>
                <span className="min-w-0 flex-1 truncate font-sans text-white">
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
              </li>
            ))}
            {orderedPlacements.length === 0 && (
              <li className="px-2 py-3 text-center text-xs text-foreground/30">Drag players onto the field to build the order.</li>
            )}
          </ul>
        </div>
      </div>

      <div className="mt-6">
        <label className="text-xs uppercase tracking-wide text-foreground/40" htmlFor="umpire-name">
          Umpire name
        </label>
        <input
          id="umpire-name"
          value={umpireName}
          onChange={(e) => {
            setUmpireName(e.target.value);
            setSaved(false);
          }}
          required
          className="mt-1 w-full max-w-sm rounded-md border border-border bg-background px-3 py-2 text-sm text-white outline-none focus:border-accent-primary"
        />
      </div>

      <div className="mt-4 flex max-w-sm gap-2">
        <button
          type="button"
          onClick={save}
          disabled={isSaving}
          className="flex-1 rounded-md border border-border px-4 py-2 text-sm font-medium text-white transition hover:border-accent-primary disabled:opacity-50"
        >
          {isSaving ? "Saving…" : "Save Lineup"}
        </button>
        <button
          type="button"
          onClick={start}
          disabled={!canStart || isStarting}
          className="flex-1 rounded-md bg-accent-green px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-green/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isStarting ? "Starting…" : "Start Game"}
        </button>
      </div>
      {/* Fix 1 (print-lineup batch): a distinct success message, separate
          from the button's own idle/loading label -- `saved` resets to
          false on the very next edit (existing behavior, so Start Game
          never trusts stale data), so this message is likewise transient
          and disappears the moment anything changes. */}
      {saved && <p className="mt-2 text-sm text-accent-green">Lineup saved ✓</p>}
      {!canStart && (
        <p className="mt-1 text-xs text-foreground/40">
          {filledCount}/9 players placed{umpireName.trim() ? "" : ", and an umpire name is needed"}.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-accent-red">{error}</p>}

      {/* Fix 1: Print Lineup only activates once this game has a
          persisted lineup -- either from an earlier visit (hasSavedLineup
          seeded true on load) or a save/Start Game click just now. Before
          that there is nothing for the print route to show, so it stayed
          silently empty; this makes the dependency visible instead. */}
      <div className="mt-3 max-w-sm">
        {hasSavedLineup ? (
          <Link
            href={`/coach/games/${gameId}/lineup-print`}
            className="inline-block rounded-md border border-accent-gold/50 px-4 py-2 text-sm font-semibold text-accent-gold hover:bg-accent-gold/10"
          >
            Print Lineup
          </Link>
        ) : (
          <span
            title="Save the lineup first"
            className="inline-block cursor-not-allowed rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground/30"
          >
            Print Lineup
          </span>
        )}
      </div>
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

// The on-field gold-circle avatar. Auto-batting-order batch: no longer a
// button (there's nothing left to tap -- order is automatic, and removal
// has its own dedicated control), and the order badge always shows a
// real number now, never a "?" placeholder, since a placement can't
// exist without one.
function PositionedAvatar({
  x,
  y,
  jersey,
  battingOrder,
  onRemove,
}: {
  x: number;
  y: number;
  jersey: number | null;
  battingOrder: number;
  onRemove: () => void;
}) {
  return (
    <div
      className="avatar-snap absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      <div className="relative flex flex-col items-center">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-background text-xs font-bold text-background shadow-lg"
          style={{ backgroundColor: "#F0C060" }}
        >
          {jersey ?? "?"}
        </div>
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

// DH/EH's drop-zone chip -- no absolute positioning, just sits inside
// its labeled box.
function PlacedAvatarChip({
  name,
  jersey,
  battingOrder,
  onRemove,
}: {
  name: string;
  jersey: number | null;
  battingOrder: number;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div
        className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-background text-[11px] font-bold text-background shadow-lg"
        style={{ backgroundColor: "#F0C060" }}
      >
        {jersey ?? "?"}
      </div>
      <span className="text-[10px] text-white">{name}</span>
      <span className="text-[9px] text-foreground/50">Order: {battingOrder}</span>
      <button type="button" onClick={onRemove} className="text-[9px] text-foreground/40 hover:text-accent-red">
        remove
      </button>
    </div>
  );
}
