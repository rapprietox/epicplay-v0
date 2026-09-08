"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { endGame } from "./actions";

export function PostGameSummary({
  gameId,
  opponentName,
  ourScore,
  opponentScore,
  inningsPlayed,
  atBatsLogged,
  pitchesLogged,
}: {
  gameId: string;
  opponentName: string;
  ourScore: number;
  opponentScore: number;
  inningsPlayed: number;
  atBatsLogged: number;
  pitchesLogged: number;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ accuracyScore: number | null } | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await endGame(gameId, notes);
        setResult(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to submit game");
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background p-6">
      <div className="mx-auto max-w-md">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-primary">Game Complete</p>
        <h1 className="font-heading mt-1 text-3xl font-bold text-white">vs {opponentName}</h1>
        <p className="font-heading mt-2 text-4xl font-bold text-accent-gold">
          {ourScore}&ndash;{opponentScore}
        </p>

        <div className="mt-6 grid grid-cols-3 gap-3">
          <SummaryStat label="Innings" value={inningsPlayed} />
          <SummaryStat label="At-Bats Logged" value={atBatsLogged} />
          <SummaryStat label="Pitches Logged" value={pitchesLogged} />
        </div>

        {result ? (
          <div className="mt-6 rounded-md border border-accent-green/40 bg-accent-green/10 p-4 text-center">
            <p className="text-sm text-white">Game submitted.</p>
            {result.accuracyScore !== null && (
              <p className="mt-1 text-xs text-foreground/60">
                Logging accuracy score: {Math.round(result.accuracyScore * 100)}%
              </p>
            )}
            <button
              type="button"
              onClick={() => router.push("/coach")}
              className="mt-3 rounded-md bg-accent-primary px-4 py-2 text-sm font-medium text-white"
            >
              Back to dashboard
            </button>
          </div>
        ) : (
          <>
            <label className="mt-6 flex flex-col gap-1.5 text-xs text-foreground/50">
              Notes (optional)
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-white outline-none focus:border-accent-primary"
              />
            </label>
            {error && <p className="mt-2 text-sm text-accent-red">{error}</p>}
            <button
              type="button"
              onClick={submit}
              disabled={isPending}
              className="mt-4 w-full rounded-md bg-accent-green px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {isPending ? "Submitting…" : "Submit"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="glossy rounded-md border border-border bg-surface p-3 text-center">
      <p className="font-heading text-2xl font-bold text-white">{value}</p>
      <p className="mt-0.5 text-[10px] uppercase tracking-wide text-foreground/40">{label}</p>
    </div>
  );
}
