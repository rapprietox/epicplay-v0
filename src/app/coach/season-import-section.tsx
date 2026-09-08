"use client";

import { useState, useTransition } from "react";
import { confirmSeasonImport, extractSchedulePdf, type ConfirmScheduleGame } from "./actions";
import type { GameType } from "@/lib/supabase/types";
import { TIME_OPTIONS } from "@/lib/time-options";

const GAME_TYPES: GameType[] = [
  "friendly",
  "preseason",
  "season",
  "playoff",
  "tournament",
  "championship",
];

export function SeasonImportSection() {
  const [seasonName, setSeasonName] = useState(`${new Date().getFullYear()} Season`);
  const [seasonYear, setSeasonYear] = useState(new Date().getFullYear());
  const [games, setGames] = useState<ConfirmScheduleGame[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isExtracting, startExtract] = useTransition();
  const [isConfirming, startConfirm] = useTransition();

  function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setDone(false);
    const formData = new FormData();
    formData.set("pdf", file);
    startExtract(async () => {
      try {
        const extracted = await extractSchedulePdf(formData);
        if (extracted.length === 0) {
          setError("No games were found in that PDF. Try a clearer scan, or add games manually.");
          return;
        }
        setGames(extracted);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to read the schedule");
      }
    });
  }

  function updateGame(index: number, patch: Partial<ConfirmScheduleGame>) {
    setGames((prev) => prev && prev.map((g, i) => (i === index ? { ...g, ...patch } : g)));
  }

  function removeGame(index: number) {
    setGames((prev) => prev && prev.filter((_, i) => i !== index));
  }

  function confirm() {
    if (!games) return;
    setError(null);
    startConfirm(async () => {
      try {
        await confirmSeasonImport({ seasonName, seasonYear, games });
        setGames(null);
        setDone(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save the season");
      }
    });
  }

  return (
    <section className="glossy rounded-lg border border-border bg-surface p-5">
      <h2 className="font-heading text-xl font-semibold uppercase tracking-wide text-white">
        Create Season
      </h2>
      <p className="mt-1 text-xs text-foreground/50">
        Upload the official season schedule PDF and Claude will extract every game for you to
        review before it&apos;s saved.
      </p>

      {!games && (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-foreground/50" htmlFor="season-name">
              Season name
            </label>
            <input
              id="season-name"
              value={seasonName}
              onChange={(e) => setSeasonName(e.target.value)}
              className="w-48 rounded-md border border-border bg-background px-3 py-2 text-sm text-white outline-none focus:border-accent-primary"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-foreground/50" htmlFor="season-year">
              Year
            </label>
            <input
              id="season-year"
              type="number"
              value={seasonYear}
              onChange={(e) => setSeasonYear(Number(e.target.value))}
              className="w-24 rounded-md border border-border bg-background px-3 py-2 text-sm text-white outline-none focus:border-accent-primary"
            />
          </div>
          <label className="cursor-pointer rounded-md bg-accent-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-primary/90">
            {isExtracting ? "Reading PDF…" : "Upload schedule PDF"}
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              disabled={isExtracting}
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </label>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-accent-red">{error}</p>}
      {done && <p className="mt-3 text-sm text-accent-green">Season saved.</p>}

      {games && (
        <div className="mt-4">
          <p className="text-xs text-foreground/50">
            Review the {games.length} extracted game{games.length === 1 ? "" : "s"} below, then
            confirm.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-foreground/40">
                  <th className="pb-2 pr-3">Date</th>
                  <th className="pb-2 pr-3">Time</th>
                  <th className="pb-2 pr-3">Opponent</th>
                  <th className="pb-2 pr-3">Home/Away</th>
                  <th className="pb-2 pr-3">Type</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {games.map((g, i) => (
                  <tr key={i}>
                    <td className="py-1.5 pr-3">
                      <input
                        type="date"
                        value={g.date}
                        onChange={(e) => updateGame(i, { date: e.target.value })}
                        className="rounded border border-border bg-background px-2 py-1 text-white"
                      />
                    </td>
                    <td className="py-1.5 pr-3">
                      <select
                        value={g.time}
                        onChange={(e) => updateGame(i, { time: e.target.value })}
                        className="rounded border border-border bg-background px-2 py-1 text-white"
                      >
                        <option value="TBD">TBD</option>
                        {TIME_OPTIONS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1.5 pr-3">
                      <input
                        value={g.opponent_name}
                        onChange={(e) => updateGame(i, { opponent_name: e.target.value })}
                        className="rounded border border-border bg-background px-2 py-1 text-white"
                      />
                    </td>
                    <td className="py-1.5 pr-3">
                      <select
                        value={g.home_away}
                        onChange={(e) =>
                          updateGame(i, { home_away: e.target.value as "home" | "away" })
                        }
                        className="rounded border border-border bg-background px-2 py-1 text-white"
                      >
                        <option value="home">Home</option>
                        <option value="away">Away</option>
                      </select>
                    </td>
                    <td className="py-1.5 pr-3">
                      <select
                        value={g.game_type}
                        onChange={(e) => updateGame(i, { game_type: e.target.value as GameType })}
                        className="rounded border border-border bg-background px-2 py-1 text-white"
                      >
                        {GAME_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1.5">
                      <button
                        type="button"
                        onClick={() => removeGame(i)}
                        className="text-xs text-foreground/40 hover:text-accent-red"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={confirm}
              disabled={isConfirming || games.length === 0}
              className="rounded-md bg-accent-green px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-green/90 disabled:opacity-50"
            >
              {isConfirming ? "Saving…" : `Confirm ${games.length} games`}
            </button>
            <button
              type="button"
              onClick={() => setGames(null)}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground/70 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
