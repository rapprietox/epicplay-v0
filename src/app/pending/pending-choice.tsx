"use client";

import { useState } from "react";
import Link from "next/link";

// Launch-audit Fix 1: replaces the old static-only /pending message
// (which told everyone "ask your coach" -- nonsensical for the very
// first coach on a brand-new team) with an explicit fork. The player
// branch is a plain text toggle, not a new flow -- a player's real
// next step is still "get an invite link from your coach" (see
// src/app/invite/[token]/page.tsx), nothing here changes that.
export function PendingChoice() {
  const [showPlayerInfo, setShowPlayerInfo] = useState(false);

  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      <Link
        href="/onboarding"
        className="rounded-lg bg-accent-primary px-4 py-3 text-sm font-semibold text-white transition hover:bg-accent-light"
      >
        I&apos;m a coach — create my team
      </Link>
      <button
        type="button"
        onClick={() => setShowPlayerInfo((s) => !s)}
        className="rounded-lg border border-border px-4 py-3 text-sm font-medium text-white transition hover:border-accent-primary"
      >
        I&apos;m a player — I have an invite link
      </button>
      {showPlayerInfo && (
        <p className="rounded-lg border border-border bg-background px-4 py-3 text-xs text-foreground/60">
          Ask your coach for your invite link — they can generate one from the Roster section of their coach
          dashboard. Opening that link while signed in to this same Google account links you to the team.
        </p>
      )}
      {/* feature/solo-signup: a third path for someone with no team at
          all yet -- a parent tracking a kid's practice at-bats, or a
          player keeping their own stats before any real team exists.
          Routes into the same /onboarding flow via a mode param rather
          than a separate page, since it's the same "create a team,
          become its coach" mechanism underneath. */}
      <Link
        href="/onboarding?mode=solo"
        className="rounded-lg border border-border px-4 py-3 text-sm font-medium text-white transition hover:border-accent-primary"
      >
        I&apos;m tracking my own player (parent or player)
      </Link>
    </div>
  );
}
