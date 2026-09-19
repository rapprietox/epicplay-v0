"use client";

import { useState } from "react";
import type { Database, SubReason } from "@/lib/supabase/types";

type Player = Database["public"]["Tables"]["players"]["Row"];

const REASONS: { value: SubReason; label: string }[] = [
  { value: "tactical", label: "Tactical" },
  { value: "injury", label: "Injury" },
  { value: "ejection", label: "Ejection" },
  { value: "defensive", label: "Defensive" },
  { value: "pinch_hit", label: "Pinch hit" },
  { value: "pinch_run", label: "Pinch run" },
];

// Fix 6 (baseball-logic-fixes batch): both selects list the full roster
// (never hidden -- an "already used"/"not in game" option label plus a
// disabled state is the required UI, not a shorter list the operator
// can't make sense of) but disable whichever players aren't a legal
// choice for that slot right now:
//  - Player out: only someone currently active can be taken out.
//  - Player in: not someone already active elsewhere, and not someone
//    already substituted out earlier this game (no re-entry).
export function SubstitutionPanel({
  players,
  activePlayerIds,
  substitutedOutIds,
  onConfirm,
  onClose,
}: {
  players: Player[];
  activePlayerIds: Set<string>;
  substitutedOutIds: Set<string>;
  onConfirm: (playerOutId: string, playerInId: string, reason: SubReason) => void;
  onClose: () => void;
}) {
  const [playerOut, setPlayerOut] = useState("");
  const [playerIn, setPlayerIn] = useState("");
  const [reason, setReason] = useState<SubReason>("tactical");

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
      <div className="glossy w-full max-w-sm rounded-lg border border-border bg-surface p-5">
        <h3 className="font-heading text-lg font-semibold uppercase tracking-wide text-white">
          Substitution
        </h3>

        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-foreground/50">
            Player out
            <select
              value={playerOut}
              onChange={(e) => setPlayerOut(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-white"
            >
              <option value="">Select…</option>
              {players.map((p) => {
                const eligible = activePlayerIds.has(p.id);
                return (
                  <option key={p.id} value={p.id} disabled={!eligible}>
                    #{p.jersey_number ?? "—"} {p.name}
                    {eligible ? "" : " (not in game)"}
                  </option>
                );
              })}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-foreground/50">
            Player in
            <select
              value={playerIn}
              onChange={(e) => setPlayerIn(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-white"
            >
              <option value="">Select…</option>
              {players.map((p) => {
                const alreadyActive = activePlayerIds.has(p.id);
                const alreadyUsed = substitutedOutIds.has(p.id);
                const eligible = !alreadyActive && !alreadyUsed;
                return (
                  <option key={p.id} value={p.id} disabled={!eligible}>
                    #{p.jersey_number ?? "—"} {p.name}
                    {alreadyActive ? " (currently in game)" : alreadyUsed ? " (already used this game)" : ""}
                  </option>
                );
              })}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-foreground/50">
            Reason
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as SubReason)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-white"
            >
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            disabled={
              !playerOut ||
              !playerIn ||
              playerOut === playerIn ||
              !activePlayerIds.has(playerOut) ||
              activePlayerIds.has(playerIn) ||
              substitutedOutIds.has(playerIn)
            }
            onClick={() => onConfirm(playerOut, playerIn, reason)}
            className="flex-1 rounded-md bg-accent-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            Confirm sub
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-4 py-2.5 text-sm font-medium text-foreground/70"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
