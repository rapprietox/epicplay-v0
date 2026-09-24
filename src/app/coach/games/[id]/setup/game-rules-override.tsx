"use client";

import { useState, useTransition } from "react";
import { saveGameRulesOverride } from "./actions";

// Feature 2 (game-rules batch): the per-game override toggle -- see
// actions.ts's saveGameRulesOverride for why this lives on the setup
// page rather than a "game creation form" that doesn't exist as a
// single screen in this app. Only rendered when the game actually has a
// season to override (a manual/friendly game with no season_id has
// nothing to inherit from, so the toggle would be meaningless there).
export function GameRulesOverride({
  gameId,
  seasonName,
  initialOverride,
  initialMaxInnings,
  initialTimeLimitMinutes,
  initialNewInningThreshold,
}: {
  gameId: string;
  seasonName: string;
  initialOverride: boolean;
  initialMaxInnings: number | null;
  initialTimeLimitMinutes: number | null;
  initialNewInningThreshold: number | null;
}) {
  const [override, setOverride] = useState(initialOverride);
  const [maxInnings, setMaxInnings] = useState(initialMaxInnings?.toString() ?? "");
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(initialTimeLimitMinutes?.toString() ?? "");
  const [newInningThreshold, setNewInningThreshold] = useState(initialNewInningThreshold?.toString() ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSave] = useTransition();

  function save(nextOverride: boolean) {
    setError(null);
    setSaved(false);
    startSave(async () => {
      try {
        await saveGameRulesOverride(gameId, {
          override: nextOverride,
          maxInnings: maxInnings.trim() ? Number(maxInnings) : null,
          timeLimitMinutes: timeLimitMinutes.trim() ? Number(timeLimitMinutes) : null,
          newInningThresholdMinutes: newInningThreshold.trim() ? Number(newInningThreshold) : null,
        });
        setSaved(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save");
      }
    });
  }

  return (
    <section className="glossy rounded-lg border border-border bg-surface p-5">
      <label className="flex items-center gap-2 text-sm text-white">
        <input
          type="checkbox"
          checked={override}
          onChange={(e) => {
            const next = e.target.checked;
            setOverride(next);
            save(next);
          }}
          className="h-4 w-4 accent-accent-primary"
        />
        Override season rules for this game
      </label>
      <p className="mt-1 text-xs text-foreground/40">
        {override ? "These values apply to this game only." : `Currently inheriting ${seasonName}'s game rules.`}
      </p>

      {override && (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-foreground/50" htmlFor="game-max-innings">
              Maximum innings
            </label>
            <input
              id="game-max-innings"
              type="number"
              min={1}
              value={maxInnings}
              onChange={(e) => setMaxInnings(e.target.value)}
              placeholder="e.g. 7 (leave blank for no limit)"
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-white outline-none focus:border-accent-primary"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-foreground/50" htmlFor="game-time-limit">
              Time limit
            </label>
            <input
              id="game-time-limit"
              type="number"
              min={1}
              value={timeLimitMinutes}
              onChange={(e) => setTimeLimitMinutes(e.target.value)}
              placeholder="e.g. 150 for 2h30m (leave blank for no limit)"
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-white outline-none focus:border-accent-primary"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-foreground/50" htmlFor="game-new-inning-threshold">
              New inning threshold
            </label>
            <input
              id="game-new-inning-threshold"
              type="number"
              min={0}
              value={newInningThreshold}
              onChange={(e) => setNewInningThreshold(e.target.value)}
              placeholder="e.g. 10 (default: 10 minutes)"
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-white outline-none focus:border-accent-primary"
            />
          </div>
          <div className="sm:col-span-3">
            <button
              type="button"
              onClick={() => save(true)}
              disabled={isSaving}
              className="rounded-md bg-accent-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-primary/90 disabled:opacity-50"
            >
              {isSaving ? "Saving…" : "Save overrides"}
            </button>
          </div>
        </div>
      )}

      {saved && <p className="mt-2 text-xs text-accent-green">Saved.</p>}
      {error && <p className="mt-2 text-xs text-accent-red">{error}</p>}
    </section>
  );
}
