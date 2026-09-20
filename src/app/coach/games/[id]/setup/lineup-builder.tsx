"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import type { Database, FieldCalibrationPoints, FieldingPosition } from "@/lib/supabase/types";
import { FIELDER_NUMBER_TO_POSITION, standardPositionLocations, zoneForPoint } from "@/lib/field-zones";
import { saveLineupAndUmpire, startGame, type LineupSlot } from "./actions";

type Player = Database["public"]["Tables"]["players"]["Row"];

const SLOTS = Array.from({ length: 9 }, (_, i) => i + 1);
const ALL_POSITIONS: FieldingPosition[] = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];

interface Assignment {
  playerId: string;
  position: string;
}

// Feature 2 (visual lineup builder batch): one small state machine drives
// the whole tap sequence -- which prompt (if any) is currently open, and
// for what. "battingOrder" and "position" are the two steps a *fresh*
// assignment always goes through in order; "edit" is the menu opened by
// tapping an already-placed player (roster row, batting-order strip, or
// on-field avatar -- all three routes lead here), which can re-enter
// either of the first two steps pre-seeded with what that player already
// has.
type Prompt =
  | { kind: "battingOrder"; playerId: string; editingOrder: number | null }
  | { kind: "position"; playerId: string; battingOrder: number }
  | { kind: "edit"; battingOrder: number }
  | null;

export function LineupBuilder({
  gameId,
  players,
  initialLineup,
  initialUmpireName,
  fieldCalibration2d,
}: {
  gameId: string;
  players: Player[];
  initialLineup: { batting_order: number; player_id: string; position: string | null }[];
  initialUmpireName: string | null;
  // Feature 2 (visual lineup builder batch): null when the coach hasn't
  // calibrated the 2D field yet -- a real, expected state (this page can
  // be reached before /coach/calibrate-field ever has been), so the field
  // diagram degrades to a plain, unsuggested 9-button position picker
  // instead of blocking lineup-building entirely.
  fieldCalibration2d: FieldCalibrationPoints | null;
}) {
  const [assignments, setAssignments] = useState<Record<number, Assignment>>(() => {
    const map: Record<number, Assignment> = {};
    for (const l of initialLineup) map[l.batting_order] = { playerId: l.player_id, position: l.position ?? "" };
    return map;
  });
  const [umpireName, setUmpireName] = useState(initialUmpireName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isSaving, startSave] = useTransition();
  const [isStarting, startStart] = useTransition();
  const [prompt, setPrompt] = useState<Prompt>(null);
  const fieldRef = useRef<HTMLDivElement>(null);

  const positionLocations = useMemo(
    () => (fieldCalibration2d ? standardPositionLocations(fieldCalibration2d) : null),
    [fieldCalibration2d]
  );

  const filledSlots = SLOTS.filter((s) => assignments[s]?.playerId).length;
  const battingOrderFor = (playerId: string) => SLOTS.find((s) => assignments[s]?.playerId === playerId) ?? null;
  const nextAvailableSlot = () => SLOTS.find((s) => !assignments[s]?.playerId) ?? null;

  function playerName(playerId: string): string {
    const p = players.find((pl) => pl.id === playerId);
    return p ? `#${p.jersey_number ?? "—"} ${p.name}` : "Player";
  }

  // A player already in the lineup: tapping them (roster row, strip slot,
  // or on-field avatar -- all three call this) opens the edit menu
  // instead of restarting the assign-from-scratch flow.
  function tapPlayer(playerId: string) {
    setError(null);
    const order = battingOrderFor(playerId);
    if (order) {
      setPrompt({ kind: "edit", battingOrder: order });
    } else {
      setPrompt({ kind: "battingOrder", playerId, editingOrder: null });
    }
  }

  function pickBattingOrder(order: number) {
    if (!prompt || prompt.kind !== "battingOrder") return;
    setError(null);
    setSaved(false);
    // Editing an existing player's batting order (reached via "Change
    // batting order" in the edit menu) only moves them -- their position
    // stays what it already was, no need to force a redundant re-pick.
    // A fresh assignment (editingOrder null) has no position yet, so it
    // has to continue into that step.
    if (prompt.editingOrder !== null) {
      const editingOrder = prompt.editingOrder;
      const current = assignments[editingOrder];
      setAssignments((prev) => {
        const next = { ...prev };
        delete next[editingOrder];
        if (current) next[order] = current;
        return next;
      });
      setPrompt(null);
      return;
    }
    setPrompt({ kind: "position", playerId: prompt.playerId, battingOrder: order });
  }

  function assignPosition(position: FieldingPosition) {
    if (!prompt || prompt.kind !== "position") return;
    const { playerId, battingOrder } = prompt;
    const conflict = SLOTS.find((s) => s !== battingOrder && assignments[s]?.position === position);
    if (conflict) {
      setError(`${position} is already assigned to ${playerName(assignments[conflict].playerId)} — change their position first.`);
      return;
    }
    setError(null);
    setSaved(false);
    setAssignments((prev) => ({ ...prev, [battingOrder]: { playerId, position } }));
    setPrompt(null);
  }

  function handleFieldTap(x: number, y: number) {
    if (!fieldCalibration2d || !prompt || prompt.kind !== "position") return;
    assignPosition(FIELDER_NUMBER_TO_POSITION[zoneForPoint(x, y, fieldCalibration2d)]);
  }

  function removeFromLineup(battingOrder: number) {
    setError(null);
    setSaved(false);
    setAssignments((prev) => {
      const next = { ...prev };
      delete next[battingOrder];
      return next;
    });
    setPrompt(null);
  }

  function buildLineupPayload(): LineupSlot[] {
    return SLOTS.filter((s) => assignments[s]?.playerId && assignments[s]?.position).map((s) => ({
      batting_order: s,
      player_id: assignments[s].playerId,
      position: assignments[s].position,
    }));
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

  const canStart = filledSlots >= 9 && umpireName.trim().length > 0;
  const editingPlayerId = prompt?.kind === "battingOrder" || prompt?.kind === "position" ? prompt.playerId : null;

  return (
    <div>
      {!fieldCalibration2d && (
        <p className="mb-3 rounded-md border border-accent-amber/40 bg-accent-amber/10 px-3 py-2 text-xs text-accent-amber">
          The 2D field hasn&apos;t been calibrated yet, so positions are picked from a plain list instead of tapped on the
          diagram.{" "}
          <a href="/coach/calibrate-field" className="underline hover:text-white">
            Calibrate it
          </a>{" "}
          for the tap-to-place experience.
        </p>
      )}

      <p className="text-xs uppercase tracking-wide text-foreground/40">
        Tap a player, pick their batting order, then tap their position on the field.
      </p>

      {/* Batting order strip */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {SLOTS.map((slot) => {
          const a = assignments[slot];
          return (
            <button
              key={slot}
              type="button"
              onClick={() => a && tapPlayer(a.playerId)}
              disabled={!a}
              className={`flex min-h-[44px] min-w-[64px] flex-col items-center justify-center rounded-md border px-2 py-1 text-center ${
                a ? "border-accent-primary bg-surface hover:border-accent-gold" : "border-dashed border-border bg-background/40"
              }`}
            >
              <span className="text-[10px] font-semibold text-accent-primary">{slot}</span>
              {a ? (
                <>
                  <span className="truncate text-[11px] text-white">{playerName(a.playerId)}</span>
                  <span className="text-[10px] text-foreground/40">{a.position || "—"}</span>
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
            {players.map((p) => {
              const order = battingOrderFor(p.id);
              const selected = editingPlayerId === p.id;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => tapPlayer(p.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-left text-sm transition ${
                      selected
                        ? "border-accent-gold bg-accent-gold/10 text-white shadow-[0_0_12px_rgba(240,192,96,0.4)]"
                        : order
                          ? "border-accent-primary/40 bg-surface text-white"
                          : "border-border bg-background/40 text-foreground/70 hover:border-accent-primary"
                    }`}
                  >
                    <span>
                      #{p.jersey_number ?? "—"} {p.name}
                    </span>
                    {order && (
                      <span className="shrink-0 text-[10px] text-foreground/40">
                        {order} · {assignments[order]?.position || "—"}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Field diagram */}
        <div>
          <div
            ref={fieldRef}
            onClick={(e) => {
              const rect = fieldRef.current?.getBoundingClientRect();
              if (!rect) return;
              handleFieldTap(((e.clientX - rect.left) / rect.width) * 100, ((e.clientY - rect.top) / rect.height) * 100);
            }}
            className={`glossy relative aspect-square w-full max-w-[420px] overflow-hidden rounded-lg border bg-background ${
              prompt?.kind === "position" && fieldCalibration2d
                ? "cursor-crosshair border-accent-gold shadow-[0_0_16px_rgba(240,192,96,0.35)]"
                : "border-border"
            }`}
            style={{ backgroundImage: "url('/field-2d.png')", backgroundSize: "cover", backgroundPosition: "center" }}
          >
            {positionLocations &&
              SLOTS.map((slot) => {
                const a = assignments[slot];
                if (!a || !a.position) return null;
                const loc = positionLocations[a.position as FieldingPosition];
                if (!loc) return null;
                const player = players.find((p) => p.id === a.playerId);
                return (
                  <button
                    key={`${slot}-${a.position}`}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      tapPlayer(a.playerId);
                    }}
                    // Feature 2: keyed on slot+position, not just slot -- a
                    // position change is a real move, so this remounts the
                    // element and replays the CSS "avatar-snap" entrance
                    // animation (globals.css) each time, the same
                    // flashKey-remount idiom used throughout the operator
                    // screen for one-shot animations.
                    className="avatar-snap absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 flex-col items-center"
                    style={{ left: `${loc.x}%`, top: `${loc.y}%` }}
                  >
                    <span
                      className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-background text-xs font-bold text-background shadow-lg"
                      style={{ backgroundColor: "#F0C060" }}
                    >
                      {player?.jersey_number ?? "?"}
                    </span>
                    <span className="mt-0.5 rounded bg-background/80 px-1 text-[9px] font-semibold text-white">{a.position}</span>
                  </button>
                );
              })}

            {prompt?.kind === "position" && fieldCalibration2d && (
              <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
                <span className="rounded bg-background/90 px-2 py-1 text-[11px] font-semibold text-accent-gold">
                  Tap {playerName(prompt.playerId)}&apos;s position
                </span>
              </div>
            )}
          </div>

          {prompt?.kind === "position" && !fieldCalibration2d && (
            <div className="mt-3 w-full max-w-[420px] rounded-md border border-border bg-surface p-3">
              <p className="mb-2 text-xs uppercase tracking-wide text-foreground/40">
                {playerName(prompt.playerId)}&apos;s position
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                {ALL_POSITIONS.map((pos) => (
                  <button
                    key={pos}
                    type="button"
                    onClick={() => assignPosition(pos)}
                    className="min-h-[40px] rounded border border-border text-sm font-semibold text-white hover:border-accent-primary"
                  >
                    {pos}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {prompt?.kind === "battingOrder" && (
        <PromptOverlay title={`${playerName(prompt.playerId)} — batting order`} onCancel={() => setPrompt(null)}>
          <div className="grid grid-cols-3 gap-2">
            {SLOTS.map((slot) => {
              const takenBy = assignments[slot]?.playerId;
              const isOwnCurrentSlot = takenBy === prompt.playerId;
              const disabled = !!takenBy && !isOwnCurrentSlot;
              const suggested = (!takenBy || isOwnCurrentSlot) && slot === (prompt.editingOrder ?? nextAvailableSlot());
              return (
                <button
                  key={slot}
                  type="button"
                  disabled={disabled}
                  onClick={() => pickBattingOrder(slot)}
                  className={`min-h-[48px] rounded-md border text-lg font-bold disabled:cursor-not-allowed disabled:opacity-30 ${
                    suggested ? "border-accent-gold bg-accent-gold/10 text-white" : "border-border text-white hover:border-accent-primary"
                  }`}
                >
                  {slot}
                </button>
              );
            })}
          </div>
        </PromptOverlay>
      )}

      {prompt?.kind === "edit" && assignments[prompt.battingOrder] && (
        <PromptOverlay title={playerName(assignments[prompt.battingOrder].playerId)} onCancel={() => setPrompt(null)}>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() =>
                setPrompt({ kind: "battingOrder", playerId: assignments[prompt.battingOrder].playerId, editingOrder: prompt.battingOrder })
              }
              className="min-h-[44px] rounded-md border border-border px-3 text-sm font-medium text-white hover:border-accent-primary"
            >
              Change batting order
            </button>
            <button
              type="button"
              onClick={() => setPrompt({ kind: "position", playerId: assignments[prompt.battingOrder].playerId, battingOrder: prompt.battingOrder })}
              className="min-h-[44px] rounded-md border border-border px-3 text-sm font-medium text-white hover:border-accent-primary"
            >
              Change position
            </button>
            <button
              type="button"
              onClick={() => removeFromLineup(prompt.battingOrder)}
              className="min-h-[44px] rounded-md border border-accent-red/50 px-3 text-sm font-medium text-accent-red hover:bg-accent-red/10"
            >
              Remove from lineup
            </button>
          </div>
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
        <p className="mt-1 text-xs text-foreground/40">Needs 9 players placed (batting order + position) and an umpire name.</p>
      )}
      {error && <p className="mt-2 text-sm text-accent-red">{error}</p>}
    </div>
  );
}

function PromptOverlay({ title, children, onCancel }: { title: string; children: React.ReactNode; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-xs rounded-lg border border-border bg-surface p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-3 text-sm font-semibold text-white">{title}</p>
        {children}
        <button type="button" onClick={onCancel} className="mt-3 w-full text-xs text-foreground/50 hover:text-white">
          Cancel
        </button>
      </div>
    </div>
  );
}
