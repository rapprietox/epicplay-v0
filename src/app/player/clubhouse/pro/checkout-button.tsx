"use client";

import { useState, useTransition } from "react";
import { createClubhouseCheckoutSession } from "../actions";
import { PRO_PRICE_DISPLAY, PRO_VALID_UNTIL_LABEL, PRO_NEXT_PRICE_NOTE } from "@/lib/pricing";

export function CheckoutButton() {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await createClubhouseCheckoutSession();
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
        {isPending ? "Loading…" : `Unlock Clubhouse Pro — ${PRO_PRICE_DISPLAY}`}
      </button>
      <p className="text-center text-xs text-foreground/50">One-time payment. Valid until {PRO_VALID_UNTIL_LABEL}. No subscription.</p>
      <p className="text-center text-xs text-accent-gold/70">{PRO_NEXT_PRICE_NOTE}</p>
      {error && <p className="text-center text-xs text-accent-red">{error}</p>}
    </div>
  );
}
