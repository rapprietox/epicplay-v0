import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getInvitePreview, claimInvite } from "@/lib/invites";
import { SignOutButton } from "@/components/sign-out-button";

// Clubhouse batch: the one intentionally-public, data-bearing route in
// this app (see src/lib/supabase/middleware.ts's PUBLIC_PATHS). An
// anonymous visitor sees who the invite is for and a sign-in link; once
// authenticated, this same page immediately attempts the claim and
// redirects into the Clubhouse on success.
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
    const result = await claimInvite({ token: params.token, userId: user.id });
    if (result.ok) redirect("/player/clubhouse");

    return (
      <InviteShell>
        <h1 className="text-xl font-semibold text-white">Couldn&apos;t link this account</h1>
        <p className="max-w-sm text-sm text-foreground/60">
          {result.reason === "already_linked_elsewhere"
            ? "This Google account is already linked to a different player. Sign out and try again with the right account, or ask your coach for help."
            : "This invite link is invalid or has already been used. Ask your coach for a new one."}
        </p>
        <SignOutButton />
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
