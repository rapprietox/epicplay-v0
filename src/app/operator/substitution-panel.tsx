"use client";

import { useState } from "react";
import type { Database } from "@/lib/supabase/types";

type Player = Database["public"]["Tables"]["players"]["Row"];

// Feature 2 (lineup-status batch): the old dropdown-based substitution
// flow this file used to hold is gone, replaced by the drag-based
// ChainSubstitutionModal -- see that component. What's left here is just
// Feature 1's Late Arrival flow, now a standalone modal in its own right
// (it used to be a second internal view of the same component) since the
// two substitution UIs no longer share one component or one open/close
// state.
export function LateArrivalPanel({
  absentPlayers,
  onLateArrival,
  onClose,
}: {
  absentPlayers: Player[];
  onLateArrival: (playerId: string, addToReserve: boolean) => void;
  onClose: () => void;
}) {
  const [selectedArrival, setSelectedArrival] = useState<Player | null>(null);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
      <div className="glossy w-full max-w-sm rounded-lg border border-border bg-surface p-5">
        <h3 className="font-heading text-lg font-semibold uppercase tracking-wide text-white">Late Arrival</h3>

        {!selectedArrival ? (
          <>
            <p className="mt-2 text-xs text-foreground/50">Who just showed up?</p>
            <div className="mt-3 flex max-h-64 flex-col gap-1.5 overflow-y-auto">
              {absentPlayers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedArrival(p)}
                  className="rounded-md border border-border px-3 py-2 text-left text-sm text-white hover:border-accent-primary"
                >
                  #{p.jersey_number ?? "—"} {p.name}
                </button>
              ))}
              {absentPlayers.length === 0 && <p className="text-xs text-foreground/40">No one is marked absent for this game.</p>}
            </div>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-white">
              #{selectedArrival.jersey_number ?? "—"} {selectedArrival.name}
            </p>
            <p className="mt-1 text-xs text-foreground/50">Add to the substitution pool, or just record that they checked in?</p>
            <div className="mt-3 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  onLateArrival(selectedArrival.id, true);
                  setSelectedArrival(null);
                }}
                className="min-h-[44px] rounded-md bg-accent-primary px-4 text-sm font-semibold text-white"
              >
                Add to Reserve
              </button>
              <button
                type="button"
                onClick={() => {
                  onLateArrival(selectedArrival.id, false);
                  setSelectedArrival(null);
                }}
                className="min-h-[44px] rounded-md border border-border text-sm font-medium text-foreground/70"
              >
                Out of Game
              </button>
            </div>
          </>
        )}

        <button type="button" onClick={onClose} className="mt-4 w-full text-xs text-foreground/50 hover:text-white">
          Close
        </button>
      </div>
    </div>
  );
}
