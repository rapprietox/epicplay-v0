"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { endGame } from "./actions";

// Launch-audit Fix 2: endGame is the single most consequential write of
// the whole game (marks it complete, computes the accuracy score), at
// the exact moment -- right after the last play, at a real field -- a
// dropped connection is most likely. Every at-bat-logging write already
// retries through withOfflineRetry (src/lib/operator/sync-queue.ts),
// but that queue is fire-and-forget by design: it never tells the
// caller whether the write succeeded, which is wrong for this screen --
// the coach needs to SEE "Game submitted," not have it silently retry
// in the background while they've already put the tablet down. So this
// keeps the visible submit/error/success states that screen was built
// around, and adds what was actually missing: the notes text surviving
// a reload (localStorage, keyed per game) and a one-tap retry that
// doesn't require retyping anything. No automatic retry-on-reconnect
// timer -- only a manual "Try Again" tap, so a coach is never surprised
// by a resubmission firing on its own while they've moved on.
const pendingKey = (gameId: string) => `epicplay_pending_end_game_${gameId}`;

function loadPendingNotes(gameId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(pendingKey(gameId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { notes?: string };
    return parsed.notes ?? null;
  } catch {
    return null;
  }
}

function savePendingNotes(gameId: string, notes: string) {
  try {
    window.localStorage.setItem(pendingKey(gameId), JSON.stringify({ notes }));
  } catch {
    // Private browsing / storage disabled -- the retry button and
    // controlled textarea still work within this one page session,
    // just won't survive an actual reload.
  }
}

function clearPendingNotes(gameId: string) {
  try {
    window.localStorage.removeItem(pendingKey(gameId));
  } catch {
    // Nothing to clean up if it was never written.
  }
}

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

  // A reload while a submission was pending (e.g. the tab crashed right
  // after a failed attempt) restores whatever notes were typed, so the
  // operator never has to retype them to retry.
  useEffect(() => {
    const restored = loadPendingNotes(gameId);
    if (restored !== null) setNotes(restored);
  }, [gameId]);

  function submit() {
    setError(null);
    savePendingNotes(gameId, notes);
    startTransition(async () => {
      try {
        const res = await endGame(gameId, notes);
        clearPendingNotes(gameId);
        setResult(res);
      } catch {
        setError(
          "Couldn't save — check your connection and tap Try Again. Your at-bats are already saved — only the final game record needs to be submitted."
        );
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
              {isPending ? "Submitting…" : error ? "Try Again" : "Submit"}
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
