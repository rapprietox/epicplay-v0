"use client";

import { useRef, useState, useTransition } from "react";
import { redeemPromoCode } from "../actions";

export function PromoCodeForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await redeemPromoCode(formData);
        setSuccess(true);
        formRef.current?.reset();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't redeem that code");
      }
    });
  }

  if (success) {
    return <p className="text-center text-sm font-semibold text-accent-green">Unlocked! Refreshing…</p>;
  }

  return (
    <form ref={formRef} action={handleSubmit} className="mx-auto flex w-full max-w-xs flex-col items-center gap-2">
      <p className="text-xs text-foreground/50">Have a promo code?</p>
      <div className="flex w-full gap-2">
        <input
          name="code"
          placeholder="LIONS-2026-X7K"
          required
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-center text-sm uppercase tracking-wide text-white outline-none focus:border-accent-primary"
        />
        <button
          type="submit"
          disabled={isPending}
          className="shrink-0 rounded-md border border-accent-primary px-3 py-2 text-sm font-medium text-accent-primary transition hover:bg-accent-primary/10 disabled:opacity-50"
        >
          {isPending ? "…" : "Enter"}
        </button>
      </div>
      {error && <p className="text-xs text-accent-red">{error}</p>}
    </form>
  );
}
