"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTeamAndOnboardCoach } from "./actions";

export function OnboardingForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createTeamAndOnboardCoach(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/coach");
      router.refresh();
    });
  }

  return (
    <form ref={formRef} action={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label htmlFor="teamName" className="mb-1 block text-xs font-medium text-foreground/70">
          Team name
        </label>
        <input
          id="teamName"
          name="teamName"
          required
          placeholder="Lions"
          className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-white outline-none focus:border-accent-primary"
        />
      </div>
      <div>
        <label htmlFor="yourName" className="mb-1 block text-xs font-medium text-foreground/70">
          Your name
        </label>
        <input
          id="yourName"
          name="yourName"
          required
          placeholder="Your full name"
          className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-white outline-none focus:border-accent-primary"
        />
      </div>
      <div>
        <label htmlFor="jerseyNumber" className="mb-1 block text-xs font-medium text-foreground/70">
          Jersey number <span className="text-foreground/40">(optional -- only if you&apos;re also on the roster)</span>
        </label>
        <input
          id="jerseyNumber"
          name="jerseyNumber"
          type="number"
          placeholder="—"
          className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-white outline-none focus:border-accent-primary"
        />
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="mt-2 rounded-lg bg-accent-primary px-4 py-3 text-sm font-semibold text-white transition hover:bg-accent-light disabled:opacity-50"
      >
        {isPending ? "Creating your team…" : "Create team"}
      </button>

      {error && <p className="text-center text-sm text-accent-red">{error}</p>}
    </form>
  );
}
