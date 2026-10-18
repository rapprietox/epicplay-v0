"use client";

import type { Database } from "@/lib/supabase/types";

type Player = Database["public"]["Tables"]["players"]["Row"];

const STANDARD_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];

interface Placement {
  playerId: string;
  position: string;
  battingOrder: number;
}

// Launch-audit Fix 6: the drag-and-drop field diagram is genuinely
// blocked until the team's "Player Positions" calibration exists (see
// lineup-builder.tsx's own banner) -- this is the promised fallback, a
// plain dropdown per position, so a coach can still build and start a
// lineup on day one without ever visiting /coach/calibrate-field. It
// writes through the exact same placePlayer/removePlayer the drag
// interface uses, so Start Game's "9 players + umpire" check and the
// Batting Order card both work identically either way -- this is just
// a second way to call the same two functions, not a parallel lineup
// concept.
export function FallbackPositionList({
  players,
  placements,
  onAssign,
  onRemove,
}: {
  players: Player[];
  placements: Placement[];
  onAssign: (playerId: string, position: string) => void;
  onRemove: (playerId: string) => void;
}) {
  const DH_EH = new Set(["DH", "EH"]);
  const unplacedOrFieldless = players.filter((p) => {
    const placement = placements.find((pl) => pl.playerId === p.id);
    return !placement || DH_EH.has(placement.position);
  });

  return (
    <div className="glossy rounded-lg border border-border bg-surface p-3">
      <p className="text-xs uppercase tracking-wide text-foreground/40">
        No calibration yet — pick each position from the list instead
      </p>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {STANDARD_POSITIONS.map((position) => {
          const current = placements.find((p) => p.position === position) ?? null;
          const currentPlayer = current ? players.find((p) => p.id === current.playerId) ?? null : null;
          const selectable = currentPlayer ? [currentPlayer, ...unplacedOrFieldless] : unplacedOrFieldless;

          return (
            <label key={position} className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-accent-green/80">{position}</span>
              <select
                value={current?.playerId ?? ""}
                onChange={(e) => {
                  const playerId = e.target.value;
                  if (!playerId) {
                    if (current) onRemove(current.playerId);
                    return;
                  }
                  onAssign(playerId, position);
                }}
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-white outline-none focus:border-accent-primary"
              >
                <option value="">— empty —</option>
                {selectable.map((p) => (
                  <option key={p.id} value={p.id}>
                    #{p.jersey_number ?? "—"} {p.name}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
    </div>
  );
}
