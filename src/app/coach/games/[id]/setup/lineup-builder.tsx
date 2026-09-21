"use client";

import { useRef, useState, useTransition } from "react";
import type { Database, PlayerPositionCalibration } from "@/lib/supabase/types";
import { nearestSavedPosition } from "@/lib/field-zones";
import { saveLineupAndUmpire, startGame, type LineupSlot } from "./actions";

type Player = Database["public"]["Tables"]["players"]["Row"];

// Change 2 (calibrate-field-tabs batch): 1-10, not 1-9 -- EH is
// explicitly "the 10th spot in the order" per the request, an added
// slot rather than one of the usual 9 (DH, by contrast, just occupies
// one of the normal 9 in place of the pitcher, so it never needs slot 10
// specifically).
const SLOTS = Array.from({ length: 10 }, (_, i) => i + 1);
// Fix 3 (lineup-builder-fixes batch): DH is a real batting-order slot
// (position stored as plain text, same as any other -- "DH" needs no
// schema change) but never rendered on the field diagram by default --
// see the DH-calibrated-point handling below for the one exception.
// EH (this batch) never renders on the field at all; it's purely an
// offensive role with no defensive position, calibrated or not.
const DH = "DH";
const EH = "EH";

// Fix 1 (lineup-builder-fixes batch): position and batting order are two
// independent, separately-set attributes of a placement -- dragging onto
// the field/DH/EH sets position immediately; tapping the placed avatar
// sets batting order afterward, whenever the operator gets to it. Keyed
// by playerId (not battingOrder) specifically because a placement can
// exist with position set and battingOrder still null.
interface Placement {
  playerId: string;
  position: string;
  battingOrder: number | null;
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
  initialLineup: { batting_order: number; player_id: string; position: string | null }[];
  initialUmpireName: string | null;
  // Change 2 (calibrate-field-tabs batch): the "Player Positions"
  // calibration tab's saved points -- null when the coach hasn't
  // calibrated it yet, a real, expected state. Replaces the old
  // formula-based standardPositionLocations entirely: dropping a player
  // now snaps to whichever saved point is closest, no math or
  // interpolation, and there's no fallback grid anymore -- field
  // placement is genuinely blocked (DH/EH and batting order still work)
  // until this is calibrated, per the request.
  fieldPositionsCalibration: PlayerPositionCalibration | null;
}) {
  const [placements, setPlacements] = useState<Placement[]>(() =>
    initialLineup.map((l) => ({ playerId: l.player_id, position: l.position ?? "", battingOrder: l.batting_order }))
  );
  const [umpireName, setUmpireName] = useState(initialUmpireName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isSaving, startSave] = useTransition();
  const [isStarting, startStart] = useTransition();
  // Fix 1: the only prompt left is "pick a batting order for this
  // player" -- position no longer has a tap-driven prompt at all, it's
  // set purely by where a drag lands.
  const [orderPrompt, setOrderPrompt] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<"field" | "dh" | "eh" | null>(null);
  const fieldRef = useRef<HTMLDivElement>(null);

  // Fix 2: the roster only ever lists players with no placement yet --
  // once dragged onto the field, DH, or EH, they disappear from here
  // immediately (derived, not a separate "hide" flag, so removing them
  // always brings them back with no extra bookkeeping).
  const placedPlayerIds = new Set(placements.map((p) => p.playerId));
  const availablePlayers = players.filter((p) => !placedPlayerIds.has(p.id));

  const battingOrderTaken = (order: number, exceptPlayerId?: string) =>
    placements.some((p) => p.battingOrder === order && p.playerId !== exceptPlayerId);
  const filledCount = placements.filter((p) => p.battingOrder !== null).length;
  const nextAvailableOrder = () => SLOTS.find((s) => !battingOrderTaken(s)) ?? null;

  function playerName(playerId: string): string {
    const p = players.find((pl) => pl.id === playerId);
    return p ? `#${p.jersey_number ?? "—"} ${p.name}` : "Player";
  }

  function placePlayer(playerId: string, position: string) {
    const conflict = placements.find((p) => p.position === position && p.playerId !== playerId);
    if (conflict) {
      setError(`${position} is already taken by ${playerName(conflict.playerId)} — remove them from ${position} first.`);
      return;
    }
    setError(null);
    setSaved(false);
    setPlacements((prev) => [...prev.filter((p) => p.playerId !== playerId), { playerId, position, battingOrder: null }]);
  }

  function pickBattingOrder(playerId: string, order: number) {
    if (battingOrderTaken(order, playerId)) return;
    setError(null);
    setSaved(false);
    setPlacements((prev) => prev.map((p) => (p.playerId === playerId ? { ...p, battingOrder: order } : p)));
    setOrderPrompt(null);
  }

  // Fix 2: removing a placement just drops it from the array -- the
  // roster-membership filter above picks the player back up on its own.
  function removePlayer(playerId: string) {
    setError(null);
    setSaved(false);
    setPlacements((prev) => prev.filter((p) => p.playerId !== playerId));
    setOrderPrompt(null);
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
    return placements
      .filter((p) => p.battingOrder !== null)
      .map((p) => ({ batting_order: p.battingOrder!, player_id: p.playerId, position: p.position }));
  }

  function save() {
    setError(null);
    startSave(async () => {
      try {
        await saveLineupAndUmpire(gameId, { lineup: buildLineupPayload(), umpireName });
        setSaved(true);
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
        // the in-progress edits here must be persisted first -- otherwise
        // a name typed but never explicitly "Saved" looks unset to the
        // server and Start Game fails with "Umpire name is required" even
        // though the field clearly has a value on screen.
        await saveLineupAndUmpire(gameId, { lineup: buildLineupPayload(), umpireName });
        await startGame(gameId);
        window.location.href = `/operator?game=${gameId}`;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start game");
      }
    });
  }

  // Change 2: unchanged threshold -- 9 is still the minimum to start,
  // DH/EH are "bonus, not required" in the sense that using them can
  // push filledCount to 10 but never lowers what's required.
  const canStart = filledCount >= 9 && umpireName.trim().length > 0;
  const dhPlacement = placements.find((p) => p.position === DH) ?? null;
  const ehPlacement = placements.find((p) => p.position === EH) ?? null;
  // Change 2: DH shows on the field diagram itself only when the coach
  // has actually marked a DH spot in the "Player Positions" tab --
  // otherwise (the common case) it stays in its drop zone below the
  // field, same as EH always does.
  const dhFieldLoc = fieldPositionsCalibration?.DH ?? null;

  return (
    <div>
      {!fieldPositionsCalibration && (
        <p className="mb-3 rounded-md border border-accent-amber/40 bg-accent-amber/10 px-3 py-2 text-xs text-accent-amber">
          Calibrate player positions first —{" "}
          <a href="/coach/calibrate-field" className="underline hover:text-white">
            /coach/calibrate-field
          </a>
          . Batting order and DH/EH still work in the meantime, but field positions can&apos;t be placed until then.
        </p>
      )}

      <p className="text-xs uppercase tracking-wide text-foreground/40">
        Drag a player onto the field (or DH/EH) to set their position, then tap their avatar to set batting order.
      </p>

      {/* Batting order strip */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {SLOTS.map((slot) => {
          const p = placements.find((pl) => pl.battingOrder === slot);
          return (
            <button
              key={slot}
              type="button"
              onClick={() => p && setOrderPrompt(p.playerId)}
              disabled={!p}
              className={`flex min-h-[44px] min-w-[64px] flex-col items-center justify-center rounded-md border px-2 py-1 text-center ${
                p ? "border-accent-primary bg-surface hover:border-accent-gold" : "border-dashed border-border bg-background/40"
              }`}
            >
              <span className="text-[10px] font-semibold text-accent-primary">{slot}</span>
              {p ? (
                <>
                  <span className="truncate text-[11px] text-white">{playerName(p.playerId)}</span>
                  <span className="text-[10px] text-foreground/40">{p.position}</span>
                </>
              ) : (
                <span className="text-[10px] text-foreground/30">Empty</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
        {/* Roster */}
        <div>
          <p className="text-xs uppercase tracking-wide text-foreground/40">Roster</p>
          <ul className="mt-2 flex max-h-[420px] flex-col gap-1.5 overflow-y-auto pr-1">
            {availablePlayers.map((p) => (
              <li key={p.id}>
                <div
                  draggable
                  onDragStart={(e) => handleDragStart(e, p.id)}
                  // Defensive cleanup: a drag that ends outside any drop
                  // zone (cancelled, dropped somewhere invalid) doesn't
                  // always fire the target's own dragLeave first, which
                  // could otherwise leave a drop zone's gold highlight
                  // stuck on.
                  onDragEnd={() => setDragOver(null)}
                  className="cursor-grab rounded-md border border-border bg-background/40 px-3 py-1.5 text-sm text-white transition hover:border-accent-primary active:cursor-grabbing"
                >
                  #{p.jersey_number ?? "—"} {p.name}
                </div>
              </li>
            ))}
            {availablePlayers.length === 0 && <li className="text-xs text-foreground/30">Everyone is placed.</li>}
          </ul>
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
                      playerId={p.playerId}
                      battingOrder={p.battingOrder}
                      jersey={players.find((pl) => pl.id === p.playerId)?.jersey_number ?? null}
                      onTap={() => setOrderPrompt(p.playerId)}
                      onRemove={() => removePlayer(p.playerId)}
                    />
                  );
                })}

            {/* Change 2: DH renders on the field only when a DH point was
                actually calibrated -- otherwise their avatar lives in the
                drop zone below like EH always does. */}
            {dhPlacement && dhFieldLoc && (
              <PositionedAvatar
                key={`${dhPlacement.playerId}-dh-field`}
                x={dhFieldLoc.x}
                y={dhFieldLoc.y}
                playerId={dhPlacement.playerId}
                battingOrder={dhPlacement.battingOrder}
                jersey={players.find((pl) => pl.id === dhPlacement.playerId)?.jersey_number ?? null}
                onTap={() => setOrderPrompt(dhPlacement.playerId)}
                onRemove={() => removePlayer(dhPlacement.playerId)}
              />
            )}

            {!fieldPositionsCalibration && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 p-4 text-center">
                <p className="text-xs text-foreground/60">Not calibrated — see the banner above.</p>
              </div>
            )}
          </div>

          {/* Change 2: "Below the field diagram add two optional drop
              zones side by side" -- DH and EH, exactly as specified.
              Always present regardless of calibration (batting order and
              DH/EH don't depend on the field being calibrated at all). */}
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
                  onTap={() => setOrderPrompt(dhPlacement.playerId)}
                  onRemove={() => removePlayer(dhPlacement.playerId)}
                />
              ) : dhPlacement && dhFieldLoc ? (
                // Placed and shown on the field already -- avoid a
                // confusing duplicate avatar down here too.
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
                  onTap={() => setOrderPrompt(ehPlacement.playerId)}
                  onRemove={() => removePlayer(ehPlacement.playerId)}
                />
              ) : (
                <span className="text-xs text-foreground/40">Drop EH here</span>
              )}
            </DropZone>
          </div>
        </div>
      </div>

      {orderPrompt && (
        <PromptOverlay title={`${playerName(orderPrompt)} — batting order`} onCancel={() => setOrderPrompt(null)}>
          <div className="grid grid-cols-5 gap-2">
            {SLOTS.map((slot) => {
              const isOwn = placements.find((p) => p.playerId === orderPrompt)?.battingOrder === slot;
              const disabled = battingOrderTaken(slot, orderPrompt);
              const suggested = !disabled && slot === (placements.find((p) => p.playerId === orderPrompt)?.battingOrder ?? nextAvailableOrder());
              return (
                <button
                  key={slot}
                  type="button"
                  disabled={disabled}
                  onClick={() => pickBattingOrder(orderPrompt, slot)}
                  className={`min-h-[44px] rounded-md border text-base font-bold disabled:cursor-not-allowed disabled:opacity-30 ${
                    isOwn || suggested ? "border-accent-gold bg-accent-gold/10 text-white" : "border-border text-white hover:border-accent-primary"
                  }`}
                >
                  {slot}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => removePlayer(orderPrompt)}
            className="mt-3 w-full min-h-[40px] rounded-md border border-accent-red/50 text-sm font-medium text-accent-red hover:bg-accent-red/10"
          >
            Remove from lineup
          </button>
        </PromptOverlay>
      )}

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
          {isSaving ? "Saving…" : saved ? "Saved" : "Save lineup"}
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
      {!canStart && (
        <p className="mt-1 text-xs text-foreground/40">Needs 9 players with a position and batting order, plus an umpire name.</p>
      )}
      {error && <p className="mt-2 text-sm text-accent-red">{error}</p>}
    </div>
  );
}

// Change 2: a generic labeled drop target, used for both DH and EH --
// identical interaction model (drag a roster player, drop to assign),
// just a different label/hint/handler per slot.
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

// The on-field gold-circle avatar -- Feature 2's original design (jersey
// number, "future: photo" hook point), now with a small batting-order
// badge (the "?" state is exactly what Fix 1 means by "a simple 1-9
// number badge... to assign" -- shown unset until tapped) and a remove
// "x", since removal no longer lives behind a separate edit menu. Change
// 2 renamed this from FieldAvatar to PositionedAvatar and gave it its
// own x/y props, since it's now used for both real defensive positions
// and a calibrated DH spot.
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
  playerId: string;
  jersey: number | null;
  battingOrder: number | null;
  onTap: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      // Keyed by the caller on playerId+position -- a position change
      // (including DH gaining/losing its field spot) replays the
      // "avatar-snap" entrance animation (globals.css).
      className="avatar-snap absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      <div className="relative flex flex-col items-center">
        <button
          type="button"
          onClick={onTap}
          className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-background text-xs font-bold text-background shadow-lg"
          style={{ backgroundColor: "#F0C060" }}
        >
          {jersey ?? "?"}
        </button>
        <span
          className={`absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-background text-[9px] font-bold ${
            battingOrder ? "bg-accent-primary text-white" : "bg-accent-red text-white"
          }`}
        >
          {battingOrder ?? "?"}
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
  onTap,
  onRemove,
}: {
  name: string;
  jersey: number | null;
  battingOrder: number | null;
  onTap: () => void;
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
      <span className="text-[9px] text-foreground/50">Order: {battingOrder ?? "?"}</span>
      <button type="button" onClick={onRemove} className="text-[9px] text-foreground/40 hover:text-accent-red">
        remove
      </button>
    </div>
  );
}

function PromptOverlay({ title, children, onCancel }: { title: string; children: React.ReactNode; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={onCancel}>
      <div className="w-full max-w-xs rounded-lg border border-border bg-surface p-4" onClick={(e) => e.stopPropagation()}>
        <p className="mb-3 text-sm font-semibold text-white">{title}</p>
        {children}
        <button type="button" onClick={onCancel} className="mt-3 w-full text-xs text-foreground/50 hover:text-white">
          Cancel
        </button>
      </div>
    </div>
  );
}
