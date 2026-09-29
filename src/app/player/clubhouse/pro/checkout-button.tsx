"use client";

import { useState, useTransition } from "react";
import { createClubhouseCheckoutSession } from "../actions";

export function CheckoutButton() {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        const { url } = await createClubhouseCheckoutSession();
        window.location.href = url;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't start checkout -- try again?");
      }
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
        {isPending ? "Loading…" : "Unlock Clubhouse Pro — $10"}
      </button>
      <p className="text-center text-xs text-foreground/50">One-time payment. Yours forever. No subscription.</p>
      {error && <p className="text-center text-xs text-accent-red">{error}</p>}
    </div>
  );
}
