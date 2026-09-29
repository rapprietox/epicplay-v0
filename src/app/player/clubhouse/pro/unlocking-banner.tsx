"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Clubhouse Pro batch: Stripe's success_url redirect can land before the
// async webhook finishes writing clubhouse_unlocked -- this is the
// documented fallback for that race (page.tsx shows this instead of the
// full paywall when ?unlocked=1 is present but the flag isn't flipped
// yet). Polls via a single delayed router.refresh(); the webhook is the
// sole source of truth, this is just "try again shortly."
export function UnlockingBanner() {
  const router = useRouter();

  useEffect(() => {
    const t = setTimeout(() => router.refresh(), 2500);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <section className="glossy rounded-lg border border-accent-gold/40 bg-surface p-5 text-center">
      <p className="text-sm font-semibold text-accent-gold">Payment received, unlocking your Clubhouse…</p>
      <p className="mt-1 text-xs text-foreground/50">This takes a few seconds.</p>
    </section>
  );
}
