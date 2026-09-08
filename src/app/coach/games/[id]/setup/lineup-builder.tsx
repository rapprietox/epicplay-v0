"use client";

import { useMemo, useState, useTransition } from "react";
import type { Database } from "@/lib/supabase/types";
import { saveLineupAndUmpire, startGame, type LineupSlot } from "./actions";

type Player = Database["public"]["Tables"]["players"]["Row"];

const SLOTS = Array.from({ length: 9 }, (_, i) => i + 1);

export function LineupBuilder({
  gameId,
  players,
  initialLineup,
  initialUmpireName,
}: {
  gameId: string;
  players: Player[];
  initialLineup: { batting_order: number; player_id: string; position: string | null }[];
  initialUmpireName: string | null;
}) {
  const [assignments, setAssignments] = useState<Record<number, { playerId: string; position: string }>>(() => {
    const map: Record<number, { playerId: string; position: string }> = {};
    for (const l of initialLineup) map[l.batting_order] = { playerId: l.player_id, position: l.position ?? "" };
    return map;
  });
  const [umpireName, setUmpireName] = useState(initialUmpireName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isSaving, startSave] = useTransition();
  const [isStarting, startStart] = useTransition();

  const bench = useMemo(() => {
    const assignedPlayerIds = new Set(Object.values(assignments).map((a) => a.playerId));
    return players.filter((p) => !assignedPlayerIds.has(p.id));
  }, [players, assignments]);
  const filledSlots = SLOTS.filter((s) => assignments[s]?.playerId).length;

  function assignSlot(slot: number, playerId: string) {
    setSaved(false);
    setAssignments((prev) => {
      const next = { ...prev };
      // A player can only occupy one slot -- clear their old slot first.
      for (const key of Object.keys(next)) {
        if (next[Number(key)]?.playerId === playerId) delete next[Number(key)];
      }
      next[slot] = { playerId, position: prev[slot]?.position ?? "" };
      return next;
    });
  }

  function clearSlot(slot: number) {
    setSaved(false);
    setAssignments((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
  }

  function setPosition(slot: number, position: string) {
    setAssignments((prev) => ({ ...prev, [slot]: { ...prev[slot], position } }));
  }

  function buildLineupPayload(): LineupSlot[] {
    return SLOTS.filter((s) => assignments[s]?.playerId).map((s) => ({
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

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_260px]">
      <div>
        <p className="text-xs uppercase tracking-wide text-foreground/40">
          Drag players from the roster into batting order slots 1-9.
        </p>
        <ol className="mt-3 flex flex-col gap-1.5">
          {SLOTS.map((slot) => {
            const assignment = assignments[slot];
            const player = players.find((p) => p.id === assignment?.playerId);
            return (
              <li
                key={slot}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const playerId = e.dataTransfer.getData("text/plain");
                  if (playerId) assignSlot(slot, playerId);
                }}
                className="flex items-center gap-3 rounded-md border border-dashed border-border bg-background/40 px-3 py-2"
              >
                <span className="font-heading w-6 text-lg font-bold text-accent-primary">{slot}</span>
                {player ? (
                  <div
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", player.id)}
                    className="flex flex-1 cursor-grab items-center justify-between gap-2 rounded bg-surface px-3 py-1.5"
                  >
                    <span className="text-sm text-white">
                      #{player.jersey_number ?? "—"} {player.name}
                    </span>
                    <input
                      value={assignment.position}
                      onChange={(e) => setPosition(slot, e.target.value)}
                      placeholder="Pos"
                      className="w-14 rounded border border-border bg-background px-1.5 py-0.5 text-xs text-white"
                    />
                    <button
                      type="button"
                      onClick={() => clearSlot(slot)}
                      className="text-xs text-foreground/40 hover:text-accent-red"
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <span className="flex-1 text-sm text-foreground/30">Drop player here</span>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <div>
        <p className="text-xs uppercase tracking-wide text-foreground/40">Roster (bench)</p>
        <ul className="mt-3 flex flex-col gap-1.5">
          {bench.map((p) => (
            <li
              key={p.id}
              draggable
              onDragStart={(e) => e.dataTransfer.setData("text/plain", p.id)}
              className="cursor-grab rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-white"
            >
              #{p.jersey_number ?? "—"} {p.name}
            </li>
          ))}
          {bench.length === 0 && <li className="text-sm text-foreground/30">Everyone is in the lineup.</li>}
        </ul>

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
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-white outline-none focus:border-accent-primary"
          />
        </div>

        <button
          type="button"
          onClick={save}
          disabled={isSaving}
          className="mt-4 w-full rounded-md border border-border px-4 py-2 text-sm font-medium text-white transition hover:border-accent-primary disabled:opacity-50"
        >
          {isSaving ? "Saving…" : saved ? "Saved" : "Save lineup"}
        </button>

        <button
          type="button"
          onClick={start}
          disabled={!canStart || isStarting}
          className="mt-2 w-full rounded-md bg-accent-green px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-green/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isStarting ? "Starting…" : "Start Game"}
        </button>
        {!canStart && (
          <p className="mt-1 text-xs text-foreground/40">
            Needs 9 players in the lineup and an umpire name.
          </p>
        )}
        {error && <p className="mt-2 text-sm text-accent-red">{error}</p>}
      </div>
    </div>
  );
}
