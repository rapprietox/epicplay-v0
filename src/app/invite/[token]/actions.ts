"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { claimInvite, type ClaimInviteResult } from "@/lib/invites";

// feature/safe-invites: the claim used to fire automatically the instant
// auth/callback landed back on this page, with no tap in between. This
// is the server action the new confirm screen calls only after the
// player explicitly taps "Yes, that's me" -- claimInvite itself is
// unchanged, this just gates when it's allowed to run and redirects on
// success the same way the old inline call did.
export async function confirmClaimInvite(token: string): Promise<ClaimInviteResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "invalid_or_used" };

  const result = await claimInvite({ token, userId: user.id });
  if (result.ok) redirect("/player/clubhouse");
  return result;
}
