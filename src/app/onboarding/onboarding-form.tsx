"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTeamAndOnboardCoach } from "./actions";

const SPORT_OPTIONS = [
  { value: "baseball", label: "Baseball" },
  { value: "softball", label: "Softball" },
  { value: "both", label: "Both" },
];

export function OnboardingForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Sport-choice batch: a 'softball'/'both' pick doesn't redirect
  // immediately -- it shows the "coming soon" notice first (the team
  // is already created at that point; this is just deferring the
  // navigation, not blocking anything). 'baseball' keeps the original
  // immediate-redirect behavior exactly as before.
  const [softballNotice, setSoftballNotice] = useState(false);
  const router = useRouter();

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createTeamAndOnboardCoach(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (String(formData.get("sport") ?? "") === "softball") {
        setSoftballNotice(true);
        return;
      }
      router.push("/coach");
      router.refresh();
    });
  }

  if (softballNotice) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <p className="text-sm text-foreground/80">
          Softball support is coming soon. We&apos;ll let you know when it&apos;s ready. Until then, stats use baseball
          rules.
        </p>
        <button
          type="button"
          onClick={() => {
            router.push("/coach");
            router.refresh();
          }}
          className="rounded-lg bg-accent-primary px-4 py-3 text-sm font-semibold text-white transition hover:bg-accent-light"
        >
          Continue to your dashboard →
        </button>
      </div>
    );
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
        <label htmlFor="sport" className="mb-1 block text-xs font-medium text-foreground/70">
          Sport
        </label>
        <select
          id="sport"
          name="sport"
          required
          defaultValue="baseball"
          className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-white outline-none focus:border-accent-primary"
        >
          {SPORT_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
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
