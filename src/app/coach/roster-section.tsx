"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { addPlayer } from "./actions";
import { POSITIONS } from "@/lib/baseball-positions";

interface Player {
  id: string;
  name: string;
  jersey_number: number | null;
  position: string | null;
  batting_hand?: string | null;
  throwing_hand?: string | null;
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
        <div className="flex flex-col gap-1">
          <label className="text-xs text-foreground/50" htmlFor="player-batting-hand">
            Bats
          </label>
          <select
            id="player-batting-hand"
            name="batting_hand"
            defaultValue="R"
            className="w-20 rounded-md border border-border bg-background px-3 py-2 text-sm text-white outline-none focus:border-accent-primary"
          >
            <option value="R">R</option>
            <option value="L">L</option>
            <option value="S">S</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-foreground/50" htmlFor="player-throwing-hand">
            Throws
          </label>
          <select
            id="player-throwing-hand"
            name="throwing_hand"
            defaultValue="R"
            className="w-20 rounded-md border border-border bg-background px-3 py-2 text-sm text-white outline-none focus:border-accent-primary"
          >
            <option value="R">R</option>
            <option value="L">L</option>
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

      <p className="mt-5 text-xs uppercase tracking-wide text-foreground/40">
        Tap a player for their full breakdown -- heat maps, spray chart, and splits
      </p>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {players.length === 0 && <p className="py-3 text-sm text-foreground/40">No players yet.</p>}
        {players.map((p) => (
          <Link
            key={p.id}
            href={`/coach/players/${p.id}`}
            className="flex items-center gap-3 rounded-md border border-border bg-background/40 px-3 py-2 text-sm transition hover:border-accent-primary hover:bg-background/70"
          >
            <span className="w-8 shrink-0 text-center text-foreground/50">{p.jersey_number ?? "—"}</span>
            <span className="flex-1 truncate text-white">{p.name}</span>
            <span className="text-foreground/50">{p.position ?? ""}</span>
            <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-foreground/50">
              {p.batting_hand ?? "R"}/{p.throwing_hand ?? "R"}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
