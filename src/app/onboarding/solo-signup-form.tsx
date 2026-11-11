"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSoloPlayerAccount, type SoloSignupResult } from "./actions";

const SPORT_OPTIONS = [
  { value: "baseball", label: "Baseball" },
  { value: "softball", label: "Softball" },
  { value: "both", label: "Both" },
];

// feature/solo-signup: a parent-or-player path with no coach, no real
// team, and (for a child) no second account. "Is the player under 18?"
// has no default -- the guardian checkbox it gates is the one thing
// this form can't let slide past unanswered.
export function SoloSignupForm() {
  const [error, setError] = useState<string | null>(null);
  const [underEighteen, setUnderEighteen] = useState<"" | "yes" | "no">("");
  const [guardianConfirmed, setGuardianConfirmed] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [welcome, setWelcome] = useState<Extract<SoloSignupResult, { ok: true }> | null>(null);
  const router = useRouter();

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createSoloPlayerAccount(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setWelcome(result);
    });
  }

  if (welcome) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <p className="text-sm text-foreground/80">
          You&apos;re set up. <span className="font-semibold text-white">{welcome.teamLabel}</span> is a placeholder
          team with just {welcome.playerName} on the roster.
        </p>
        <p className="text-sm text-foreground/60">
          {welcome.isMinor
            ? `As ${welcome.playerName}'s parent or guardian, you can log their games from your coach dashboard -- ${welcome.playerName} never needs to sign in themselves.`
            : `You can log your own games from your coach dashboard, and since you're on the roster too, you'll see your own stats in the Clubhouse.`}
        </p>
        <p className="text-xs text-foreground/50">
          If &quot;{welcome.teamLabel}&quot; ever starts using EpicPlay as a real team, a coach can send{" "}
          {welcome.isMinor ? welcome.playerName : "you"} a proper invite link later -- &quot;{welcome.teamLabel}&quot;
          just becomes that team&apos;s real name, nothing is lost.
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
    <form action={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label htmlFor="playerName" className="mb-1 block text-xs font-medium text-foreground/70">
          Player&apos;s first name
        </label>
        <input
          id="playerName"
          name="playerName"
          required
          placeholder="Mike"
          className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-white outline-none focus:border-accent-primary"
        />
      </div>
      <div>
        <label htmlFor="jerseyNumber" className="mb-1 block text-xs font-medium text-foreground/70">
          Jersey number <span className="text-foreground/40">(optional)</span>
        </label>
        <input
          id="jerseyNumber"
          name="jerseyNumber"
          type="number"
          placeholder="—"
          className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-white outline-none focus:border-accent-primary"
        />
      </div>
      <div>
        <label htmlFor="teamLabel" className="mb-1 block text-xs font-medium text-foreground/70">
          Team label <span className="text-foreground/40">(just for you -- can become a real team later)</span>
        </label>
        <input
          id="teamLabel"
          name="teamLabel"
          required
          placeholder="Mike's practice"
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
        <label htmlFor="underEighteen" className="mb-1 block text-xs font-medium text-foreground/70">
          Is the player under 18?
        </label>
        <select
          id="underEighteen"
          name="underEighteen"
          required
          value={underEighteen}
          onChange={(e) => {
            const next = e.target.value as "" | "yes" | "no";
            setUnderEighteen(next);
            if (next !== "yes") setGuardianConfirmed(false);
          }}
          className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-white outline-none focus:border-accent-primary"
        >
          <option value="" disabled>
            — Select —
          </option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </div>
      {underEighteen === "yes" && (
        <label className="flex items-start gap-2 rounded-lg border border-border bg-background px-4 py-3 text-xs text-foreground/70">
          <input
            type="checkbox"
            name="guardianConfirmed"
            checked={guardianConfirmed}
            onChange={(e) => setGuardianConfirmed(e.target.checked)}
            className="mt-0.5"
          />
          I&apos;m the player&apos;s parent or legal guardian, and I&apos;ll manage this account.
        </label>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="mt-2 rounded-lg bg-accent-primary px-4 py-3 text-sm font-semibold text-white transition hover:bg-accent-light disabled:opacity-50"
      >
        {isPending ? "Setting up…" : "Start tracking"}
      </button>

      {error && <p className="text-center text-sm text-accent-red">{error}</p>}
    </form>
  );
}
