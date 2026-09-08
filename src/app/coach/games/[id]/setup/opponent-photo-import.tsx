"use client";

import { useState, useTransition } from "react";
import { confirmOpponentRoster, extractOpponentPhoto } from "./actions";

interface OpponentPlayer {
  name: string;
  jersey_number: string;
  position: string | null;
}

export function OpponentPhotoImport({
  gameId,
  opponentName,
  hasOpponent,
  existingPlayers,
}: {
  gameId: string;
  opponentName: string;
  hasOpponent: boolean;
  existingPlayers: { id: string; name: string; jersey_number: string; position: string | null }[];
}) {
  const [extracted, setExtracted] = useState<OpponentPlayer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isExtracting, startExtract] = useTransition();
  const [isConfirming, startConfirm] = useTransition();

  function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setDone(false);
    const formData = new FormData();
    formData.set("photo", file);
    formData.set("gameId", gameId);
    startExtract(async () => {
      try {
        const players = await extractOpponentPhoto(formData);
        if (players.length === 0) {
          setError("No players were recognized in that photo. Try a clearer shot.");
          return;
        }
        setExtracted(players);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to read the photo");
      }
    });
  }

  function updatePlayer(index: number, patch: Partial<OpponentPlayer>) {
    setExtracted((prev) => prev && prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  function removePlayer(index: number) {
    setExtracted((prev) => prev && prev.filter((_, i) => i !== index));
  }

  function confirm() {
    if (!extracted) return;
    setError(null);
    startConfirm(async () => {
      try {
        await confirmOpponentRoster(gameId, extracted);
        setExtracted(null);
        setDone(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save roster");
      }
    });
  }

  return (
    <section className="glossy rounded-lg border border-border bg-surface p-5">
      <h2 className="font-heading text-lg font-semibold uppercase tracking-wide text-white">
        {opponentName} Lineup Card
      </h2>
      <p className="mt-1 text-xs text-foreground/50">
        Photograph their lineup card or roster and Claude will read off names, numbers, and
        positions for you to confirm.
      </p>

      {!hasOpponent && (
        <p className="mt-3 text-sm text-accent-amber">
          This game has no linked opponent record (likely a free-text friendly game), so an
          imported roster can&apos;t be attached to it.
        </p>
      )}

      {existingPlayers.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {existingPlayers.map((p) => (
            <li
              key={p.id}
              className="rounded-full border border-border px-3 py-1 text-xs text-foreground/70"
            >
              #{p.jersey_number} {p.name}
              {p.position ? ` · ${p.position}` : ""}
            </li>
          ))}
        </ul>
      )}

      {hasOpponent && !extracted && (
        <label className="mt-4 inline-block cursor-pointer rounded-md bg-accent-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-primary/90">
          {isExtracting ? "Reading photo…" : "Upload lineup photo"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            className="hidden"
            disabled={isExtracting}
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </label>
      )}

      {error && <p className="mt-3 text-sm text-accent-red">{error}</p>}
      {done && <p className="mt-3 text-sm text-accent-green">Opponent roster saved.</p>}

      {extracted && (
        <div className="mt-4">
          <p className="text-xs text-foreground/50">
            Review the {extracted.length} player{extracted.length === 1 ? "" : "s"} found, then
            confirm.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {extracted.map((p, i) => (
              <li key={i} className="flex items-center gap-2">
                <input
                  value={p.jersey_number}
                  onChange={(e) => updatePlayer(i, { jersey_number: e.target.value })}
                  className="w-14 rounded border border-border bg-background px-2 py-1 text-sm text-white"
                />
                <input
                  value={p.name}
                  onChange={(e) => updatePlayer(i, { name: e.target.value })}
                  className="flex-1 rounded border border-border bg-background px-2 py-1 text-sm text-white"
                />
                <input
                  value={p.position ?? ""}
                  onChange={(e) => updatePlayer(i, { position: e.target.value || null })}
                  placeholder="Pos"
                  className="w-16 rounded border border-border bg-background px-2 py-1 text-sm text-white"
                />
                <button
                  type="button"
                  onClick={() => removePlayer(i)}
                  className="text-xs text-foreground/40 hover:text-accent-red"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={confirm}
              disabled={isConfirming || extracted.length === 0}
              className="rounded-md bg-accent-green px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {isConfirming ? "Saving…" : `Confirm ${extracted.length} players`}
            </button>
            <button
              type="button"
              onClick={() => setExtracted(null)}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground/70"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
