"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resetPracticeGame } from "@/app/practice-actions";

// Only ever rendered when the caller has already checked
// profile.team_id === PRACTICE_TEAM_ID (see src/lib/practice.ts) --
// this component doesn't re-check that itself, since resetPracticeGame
// re-verifies it server-side regardless and will refuse either way.
export function PracticeResetButton({
  gameId,
  className = "rounded-md border border-accent-red px-3 py-1.5 text-xs font-semibold text-accent-red transition hover:bg-accent-red hover:text-white",
}: {
  gameId: string;
  className?: string;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirmReset() {
    setError(null);
    startTransition(async () => {
      try {
        await resetPracticeGame(gameId);
        setConfirmOpen(false);
        router.push(`/coach/games/${gameId}/setup`);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Reset failed");
      }
    });
  }

  return (
    <>
      <button onClick={() => setConfirmOpen(true)} className={className}>
        Reset practice game
      </button>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-5 text-center">
            <h3 className="font-heading text-lg font-bold text-white">Reset the practice game?</h3>
            <p className="mt-2 text-sm text-foreground/70">Everything logged will be deleted.</p>
            {error && <p className="mt-2 text-xs text-accent-red">{error}</p>}
            <div className="mt-4 flex gap-3">
              <button
                onClick={confirmReset}
                disabled={pending}
                className="flex-1 rounded-md bg-accent-red px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {pending ? "Resetting…" : "Reset"}
              </button>
              <button
                onClick={() => setConfirmOpen(false)}
                disabled={pending}
                className="rounded-md border border-border px-4 py-2.5 text-sm text-foreground/70 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
