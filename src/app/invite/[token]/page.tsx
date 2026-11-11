import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getInvitePreview } from "@/lib/invites";
import { ConfirmClaim } from "./confirm-claim";

// Clubhouse batch: the one intentionally-public, data-bearing route in
// this app (see src/lib/supabase/middleware.ts's PUBLIC_PATHS). An
// anonymous visitor sees who the invite is for and a sign-in link.
// feature/safe-invites: once authenticated, this no longer claims
// automatically -- it hands off to <ConfirmClaim>, which only claims
// after an explicit "Yes, that's me" tap (see confirm-claim.tsx).
export default async function InvitePage({ params }: { params: { token: string } }) {
  const invite = await getInvitePreview(params.token);

  if (!invite) {
    return (
      <InviteShell>
        <h1 className="text-xl font-semibold text-white">Invite not found</h1>
        <p className="max-w-sm text-sm text-foreground/60">
          This invite link is invalid or has already been used. Ask your coach for a new one.
        </p>
      </InviteShell>
    );
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    return (
      <InviteShell>
        <ConfirmClaim
          token={params.token}
          userEmail={user.email ?? "your Google account"}
          playerName={invite.playerName}
          jerseyNumber={invite.jerseyNumber}
          teamName={invite.teamName}
        />
      </InviteShell>
    );
  }

  return (
    <InviteShell>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-primary">{invite.teamName}</p>
      <h1 className="text-2xl font-semibold text-white">
        #{invite.jerseyNumber ?? "—"} {invite.playerName}
      </h1>
      <p className="text-sm text-foreground/60">{invite.position ?? "Player"} · Claim your Clubhouse</p>
      <Link
        href={`/login?next=${encodeURIComponent(`/invite/${params.token}`)}`}
        className="mt-2 flex items-center justify-center gap-3 rounded-lg border border-border bg-background px-4 py-3 text-sm font-medium text-white transition hover:border-accent-primary"
      >
        Sign in with Google to link this account
      </Link>
    </InviteShell>
  );
}

function InviteShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="glossy flex w-full max-w-sm flex-col items-center gap-4 rounded-xl border border-border bg-surface p-8 text-center shadow-2xl shadow-black/40">
        {children}
      </div>
    </main>
  );
}
