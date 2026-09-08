"use client";

import { useRef, useState, useTransition } from "react";
import { addPlayer } from "./actions";
import { POSITIONS } from "@/lib/baseball-positions";

interface Player {
  id: string;
  name: string;
  jersey_number: number | null;
  position: string | null;
}

export function RosterSection({ players }: { players: Player[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await addPlayer(formData);
        formRef.current?.reset();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add player");
      }
    });
  }

  return (
    <section className="glossy rounded-lg border border-border bg-surface p-5">
      <h2 className="font-heading text-xl font-semibold uppercase tracking-wide text-white">
        Roster
      </h2>
      <p className="mt-1 text-xs text-foreground/50">
        Add every player before building a lineup for a game.
      </p>

      <form ref={formRef} action={handleSubmit} className="mt-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-foreground/50" htmlFor="player-name">
            Name
          </label>
          <input
            id="player-name"
            name="name"
            required
            className="w-40 rounded-md border border-border bg-background px-3 py-2 text-sm text-white outline-none focus:border-accent-primary"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-foreground/50" htmlFor="player-jersey">
            #
          </label>
          <input
            id="player-jersey"
            name="jersey_number"
            type="number"
            className="w-16 rounded-md border border-border bg-background px-3 py-2 text-sm text-white outline-none focus:border-accent-primary"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-foreground/50" htmlFor="player-position">
            Position
          </label>
          <select
            id="player-position"
            name="position"
            defaultValue=""
            className="w-44 rounded-md border border-border bg-background px-3 py-2 text-sm text-white outline-none focus:border-accent-primary"
          >
            <option value="">—</option>
            {POSITIONS.map((pos) => (
              <option key={pos.value} value={pos.value}>
                {pos.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-accent-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-primary/90 disabled:opacity-50"
        >
          {isPending ? "Adding…" : "Add player"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-accent-red">{error}</p>}

      <ul className="mt-4 divide-y divide-border">
        {players.length === 0 && (
          <li className="py-3 text-sm text-foreground/40">No players yet.</li>
        )}
        {players.map((p) => (
          <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
            <span className="w-8 shrink-0 text-center text-foreground/50">
              {p.jersey_number ?? "—"}
            </span>
            <span className="text-white">{p.name}</span>
            <span className="text-foreground/50">{p.position ?? ""}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
