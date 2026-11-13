"use client";

import { useState, useTransition } from "react";
import { createTeamPassCheckoutSession } from "./team-pass-actions";

// Team Pass batch: mirrors src/app/player/clubhouse/pro/checkout-button.tsx's
// shape exactly (same pending/error state machine, same plain redirect
// to the returned Stripe URL) -- a second, separate component rather
// than a shared one, since that one's copy/styling is specific to the
// individual player paywall and this one to the coach dashboard card.
export function TeamPassCheckoutButton({ priceDisplay }: { priceDisplay: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await createTeamPassCheckoutSession();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      window.location.href = result.url;
    });
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="glossy min-h-[52px] w-full max-w-xs rounded-lg px-6 text-base font-bold uppercase tracking-wide text-background transition disabled:opacity-50"
        style={{ backgroundColor: "#F0C060" }}
      >
        {isPending ? "Loading…" : `Buy Team Pass — ${priceDisplay}`}
      </button>
      {error && <p className="text-center text-xs text-accent-red">{error}</p>}
    </div>
  );
}
