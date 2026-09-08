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

export function SubstitutionPanel({
  players,
  onConfirm,
  onClose,
}: {
  players: Player[];
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
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  #{p.jersey_number ?? "—"} {p.name}
                </option>
              ))}
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
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  #{p.jersey_number ?? "—"} {p.name}
                </option>
              ))}
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
            disabled={!playerOut || !playerIn || playerOut === playerIn}
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
