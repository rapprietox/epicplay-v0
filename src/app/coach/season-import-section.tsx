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

const CURRENT_YEAR = new Date().getFullYear();

// Fix 5: a PDF for next season is often typeset with last year's date
// (or the schedule was simply printed early) -- if every extracted game
// falls in the same year and that year isn't the current one, ask before
// the coach reviews a table full of games that read as already past.
function detectStaleYear(games: ConfirmScheduleGame[]): number | null {
  const years = new Set(
    games.map((g) => Number(g.date.slice(0, 4))).filter((y) => Number.isInteger(y) && y > 0)
  );
  if (years.size !== 1) return null;
  const year = Array.from(years)[0];
  return year !== CURRENT_YEAR ? year : null;
}

export function SeasonImportSection() {
  const [seasonName, setSeasonName] = useState(`${CURRENT_YEAR} Season`);
  const [seasonYear, setSeasonYear] = useState(CURRENT_YEAR);
  // Feature 2 (game-rules batch): all three optional, kept as raw string
  // input state (not number) so an empty field reads unambiguously as
  // "blank" rather than coercing to 0 -- parsed to number|null only when
  // building the confirmSeasonImport payload.
  const [maxInnings, setMaxInnings] = useState("");
  const [timeLimitMinutes, setTimeLimitMinutes] = useState("");
  const [newInningThreshold, setNewInningThreshold] = useState("");
  const [games, setGames] = useState<ConfirmScheduleGame[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isExtracting, startExtract] = useTransition();
  const [isConfirming, startConfirm] = useTransition();
  const [yearPrompt, setYearPrompt] = useState<{ detectedYear: number; selectedYear: number } | null>(null);

  function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setDone(false);
    setYearPrompt(null);
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
        const staleYear = detectStaleYear(extracted);
        if (staleYear) setYearPrompt({ detectedYear: staleYear, selectedYear: CURRENT_YEAR });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to read the schedule");
      }
    });
  }

  function applyYear(newYear: number) {
    setGames((prev) => prev && prev.map((g) => ({ ...g, date: `${newYear}${g.date.slice(4)}` })));
    setSeasonName((prev) => (yearPrompt ? prev.replace(String(yearPrompt.detectedYear), String(newYear)) : prev));
    setSeasonYear(newYear);
    setYearPrompt(null);
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
        await confirmSeasonImport({
          seasonName,
          seasonYear,
          games,
          maxInnings: maxInnings.trim() ? Number(maxInnings) : null,
          timeLimitMinutes: timeLimitMinutes.trim() ? Number(timeLimitMinutes) : null,
          newInningThresholdMinutes: newInningThreshold.trim() ? Number(newInningThreshold) : null,
        });
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

      {/* Feature 2 (game-rules batch): "Create/Edit Season form" -- this
          app doesn't actually have a separate season CRUD screen (seasons
          are only ever created here, through the PDF import flow; there's
          no standalone edit UI for an existing season at all), so these
          fields live in the one place a season actually gets created.
          Set once at creation and applied to every game in the season
          unless that game's own override is used. */}
      {!games && (
        <div className="mt-4 grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-white">Game Rules</p>
            <p className="mt-1 text-[11px] text-foreground/40">Applied to every game in this season, unless a game overrides them.</p>
          </div>
          <div className="flex flex-col gap-1 sm:col-start-1">
            <label className="text-xs text-foreground/50" htmlFor="max-innings">
              Maximum innings
            </label>
            <input
              id="max-innings"
              type="number"
              min={1}
              value={maxInnings}
              onChange={(e) => setMaxInnings(e.target.value)}
              placeholder="e.g. 7 (leave blank for no limit)"
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-white outline-none focus:border-accent-primary"
            />
            <p className="text-[10px] text-foreground/40">
              The End Inning banner flags the final inning once this many are completed. Never blocks the operator.
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-foreground/50" htmlFor="time-limit">
              Time limit
            </label>
            <input
              id="time-limit"
              type="number"
              min={1}
              value={timeLimitMinutes}
              onChange={(e) => setTimeLimitMinutes(e.target.value)}
              placeholder="e.g. 150 for 2h30m (leave blank for no limit)"
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-white outline-none focus:border-accent-primary"
            />
            <p className="text-[10px] text-foreground/40">
              Minutes from Start Game. The operator screen shows a running countdown once this is set.
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-foreground/50" htmlFor="new-inning-threshold">
              New inning threshold
            </label>
            <input
              id="new-inning-threshold"
              type="number"
              min={0}
              value={newInningThreshold}
              onChange={(e) => setNewInningThreshold(e.target.value)}
              placeholder="e.g. 10 (default: 10 minutes)"
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-white outline-none focus:border-accent-primary"
            />
            <p className="text-[10px] text-foreground/40">
              If time remaining drops to this many minutes or fewer at End Inning, the banner warns against starting another.
            </p>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-accent-red">{error}</p>}
      {done && <p className="mt-3 text-sm text-accent-green">Season saved.</p>}

      {yearPrompt && (
        <div className="mt-4 rounded-md border border-accent-amber/50 bg-accent-amber/10 p-3">
          <p className="text-sm text-white">
            These games appear to be from <strong>{yearPrompt.detectedYear}</strong>. Is that correct, or should we
            update the dates to <strong>{CURRENT_YEAR}</strong>?
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              value={yearPrompt.selectedYear}
              onChange={(e) => setYearPrompt((p) => (p ? { ...p, selectedYear: Number(e.target.value) } : p))}
              className="rounded border border-border bg-background px-2 py-1.5 text-sm text-white"
            >
              {Array.from({ length: 5 }, (_, i) => yearPrompt.detectedYear - 1 + i).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => applyYear(yearPrompt.selectedYear)}
              className="rounded-md bg-accent-amber px-3 py-1.5 text-xs font-semibold text-background"
            >
              Update to {yearPrompt.selectedYear}
            </button>
            <button
              type="button"
              onClick={() => setYearPrompt(null)}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground/70 hover:text-white"
            >
              Keep {yearPrompt.detectedYear}
            </button>
          </div>
        </div>
      )}

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
