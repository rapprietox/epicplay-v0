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
  // Feature 1 (lineup-status batch): batting_order/position/status all
  // nullable now -- a reserve or absent row has none of the first two,
  // status carries the meaning instead.
  initialLineup: { batting_order: number | null; player_id: string; position: string | null; status: string | null }[];
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
    // Feature 1: only rows that actually have a position (field/DH/EH)
    // become a Placement -- reserve/absent rows have neither and belong
    // in absentPlayerIds/the roster instead.
    initialLineup
      .filter((l) => l.position)
      .map((l) => ({ playerId: l.player_id, position: l.position!, battingOrder: l.batting_order }))
  );
  // Feature 1 (lineup-status batch): the coach's pre-game absent toggle.
  // "reserve" is the implicit default (everyone not placed and not in
  // this set) -- no separate state needed for it.
  const [absentPlayerIds, setAbsentPlayerIds] = useState<Set<string>>(
    () => new Set(initialLineup.filter((l) => l.status === "absent").map((l) => l.player_id))
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
  // Feature 1: absent players get their own section below, not the
  // draggable roster -- a placed player is never shown as absent even if
  // somehow both (placement takes priority; the UI only ever offers the
  // absent toggle for someone not yet placed anyway).
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

  const battingOrderTaken = (order: number, exceptPlayerId?: string) =>
    placements.some((p) => p.battingOrder === order && p.playerId !== exceptPlayerId);
  // Fix 1 (lineup-builder fixes batch): explicit about both halves of
  // "ready to start" -- a placement always gets a position the instant
  // it's created (placePlayer sets both together), so checking
  // battingOrder alone was equivalent in practice, but spelling out
  // `position.trim().length > 0` here removes any doubt and guards
  // against a future placement shape where that stops being guaranteed
  // (e.g. a seeded legacy row with position null coerced to "").
  const readyPlacements = placements.filter((p) => p.position.trim().length > 0 && p.battingOrder !== null);
  const filledCount = readyPlacements.length;
  const nextAvailableOrder = () => SLOTS.find((s) => !battingOrderTaken(s)) ?? null;

  function playerName(playerId: string): string {
    const p = players.find((pl) => pl.id === playerId);
    return p ? `#${p.jersey_number ?? "—"} ${p.name}` : "Player";
  }

  // Feature 2 (lineup-status batch), pre-game scope: dragging onto an
  // occupied position used to hard-block with an error, forcing the coach
  // to remove the existing player first. This is the pre-game counterpart
  // to the live operator screen's drag-based chain substitution -- but a
  // full multi-step "sub in here / move first" chain doesn't map onto
  // pre-game setup at all (there's no inning/outs/score/reason to log,
  // no game_events row, nobody goes "to the bench" mid-game). The
  // deliberately lighter equivalent kept here: the occupant is simply
  // bumped back to the roster (unplaced, available to drag again) and
  // the dragged player takes their spot -- same "drop onto occupied ->
  // something sensible happens instead of a block" spirit, scaled down
  // for a context where nothing needs recording. Only a roster/absent
  // player is ever draggable here (an already-placed avatar has no
  // `draggable` attribute -- it's removed via its own "remove" button
  // instead), so there's never an existing placement to preserve a
  // batting order from on the dragged side.
  function placePlayer(playerId: string, position: string) {
    const conflict = placements.find((p) => p.position === position && p.playerId !== playerId);
    setError(null);
    setSaved(false);
    setPlacements((prev) => [
      ...prev.filter((p) => p.playerId !== playerId && p.playerId !== conflict?.playerId),
      { playerId, position, battingOrder: null },
    ]);
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
    // Same readiness condition as readyPlacements below -- kept as its
    // own inline filter (not a shared reference) since this function is
    // declared above that const and calling it depends only on this
    // render's own placements snapshot either way.
    const starting: LineupSlot[] = placements
      .filter((p) => p.position.trim().length > 0 && p.battingOrder !== null)
      .map((p) => ({ batting_order: p.battingOrder!, player_id: p.playerId, position: p.position, status: "starting" }));

    // Feature 1: every other roster player also gets a row now, purely
    // to carry status -- reserve (the default) or absent. This is what
    // makes the pre-game bench visible to the operator's live
    // substitution pool later; a player who's simply never mentioned
    // here wouldn't exist in `lineup` at all and couldn't be subbed in.
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

  // Fix 1: 9 is still the minimum to start (DH/EH are "bonus, not
  // required" -- using them can push filledCount to 10 but never lowers
  // what's required), and umpireName must be non-blank. Both conditions
  // read live off placements/umpireName every render, so the button
  // reacts the instant either the 9th player gets a batting order or the
  // umpire field stops being empty -- no separate "did I remember to
  // save" step in between.
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

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
        {/* Roster */}
        <div>
          <p className="text-xs uppercase tracking-wide text-foreground/40">Roster</p>
          <ul className="mt-2 flex max-h-[300px] flex-col gap-1.5 overflow-y-auto pr-1">
            {availablePlayers.map((p) => (
              <li key={p.id} className="flex items-center gap-1.5">
                <div
                  draggable
                  onDragStart={(e) => handleDragStart(e, p.id)}
                  // Defensive cleanup: a drag that ends outside any drop
                  // zone (cancelled, dropped somewhere invalid) doesn't
                  // always fire the target's own dragLeave first, which
                  // could otherwise leave a drop zone's gold highlight
                  // stuck on.
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

          {/* Feature 1 (lineup-status batch): a separate, non-draggable
              section -- absent players can't be dragged anywhere until
              the coach marks them available again (pre-game) or, once
              the game is live, checks them in via the operator's Late
              Arrival flow. */}
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
        <p className="mt-1 text-xs text-foreground/40">
          {filledCount}/9 players have both a position and batting order{umpireName.trim() ? "" : ", and an umpire name is needed"}.
        </p>
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
