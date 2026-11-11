"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { confirmClaimInvite } from "./actions";
import type { ClaimInviteResult } from "@/lib/invites";

// feature/safe-invites: shown once a session exists for this invite link,
// in place of the old automatic claim. Claiming only happens after an
// explicit "Yes, that's me" tap; "No, use another account" signs out and
// sends the browser back to this same /invite/[token] URL so a different
// Google account can be chosen on the next sign-in.
export function ConfirmClaim({
  token,
  userEmail,
  playerName,
  jerseyNumber,
  teamName,
}: {
  token: string;
  userEmail: string;
  playerName: string;
  jerseyNumber: number | null;
  teamName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [switching, setSwitching] = useState(false);
  const [result, setResult] = useState<ClaimInviteResult | null>(null);

  function handleYes() {
    startTransition(async () => {
      // On success confirmClaimInvite redirects server-side and this
      // never resolves with a value -- it only resolves here on failure.
      const r = await confirmClaimInvite(token);
      setResult(r);
    });
  }

  async function handleNo() {
    setSwitching(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push(`/invite/${token}`);
    router.refresh();
  }

  if (result && !result.ok) {
    return (
      <>
        <h1 className="text-xl font-semibold text-white">Couldn&apos;t link this account</h1>
        <p className="max-w-sm text-sm text-foreground/60">
          {result.reason === "already_linked_elsewhere"
            ? "This Google account is already linked to a different player. Sign out and try again with the right account, or ask your coach for help."
            : "This invite link is invalid or has already been used. Ask your coach for a new one."}
        </p>
        <button
          type="button"
          onClick={handleNo}
          disabled={switching}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground/70 transition hover:border-accent-primary hover:text-white disabled:opacity-50"
        >
          {switching ? "Signing out…" : "Sign out"}
        </button>
      </>
    );
  }

  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-primary">{teamName}</p>
      <h1 className="text-xl font-semibold text-white">You&apos;re signing in as {userEmail}.</h1>
      <p className="max-w-sm text-sm text-foreground/70">
        You&apos;re claiming{" "}
        <span className="font-semibold text-white">
          #{jerseyNumber ?? "—"} {playerName}
        </span>{" "}
        on {teamName}. Is that you?
      </p>
      <div className="mt-2 flex w-full flex-col gap-2">
        <button
          type="button"
          disabled={isPending || switching}
          onClick={handleYes}
          className="w-full rounded-lg bg-accent-primary px-4 py-3 text-sm font-medium text-white transition hover:bg-accent-primary/90 disabled:opacity-50"
        >
          {isPending ? "Linking…" : "Yes, that's me"}
        </button>
        <button
          type="button"
          disabled={isPending || switching}
          onClick={handleNo}
          className="w-full rounded-lg border border-border px-4 py-3 text-sm font-medium text-foreground/70 transition hover:border-accent-primary hover:text-white disabled:opacity-50"
        >
          {switching ? "Signing out…" : "No, use another account"}
        </button>
      </div>
      <p className="mt-2 max-w-sm text-[11px] text-foreground/40">
        Players under 13 need a parent or guardian to set up this account.
      </p>
    </>
  );
}
