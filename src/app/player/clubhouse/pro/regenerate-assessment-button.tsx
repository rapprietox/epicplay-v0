"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { regenerateInitialAssessment } from "../kairos-actions";

// Clubhouse Pro enhancement, Part 3: the manual refresh affordance
// standing in for automatic staleness detection (see
// ensureInitialAssessment's own comment on why "cache forever until
// data changes significantly" doesn't get an automatic trigger this
// batch). router.refresh() re-runs the server component so the freshly
// persisted text renders without a full reload.
export function RegenerateAssessmentButton() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            try {
              await regenerateInitialAssessment();
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Couldn't regenerate -- try again?");
            }
          })
        }
        className="rounded-full border border-accent-gold/50 px-3 py-1 text-xs text-accent-gold hover:bg-accent-gold/10 disabled:opacity-50"
      >
        {isPending ? "Regenerating…" : "Regenerate"}
      </button>
      {error && <p className="text-[10px] text-accent-red">{error}</p>}
    </div>
  );
}
