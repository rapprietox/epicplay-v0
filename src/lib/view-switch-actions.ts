"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VIEW_SWITCH_COOKIE, isViewSwitchEligible } from "./view-switch";

// "View as player" batch. Both actions re-check identity server-side
// from the signed-in session -- never from anything the client passed
// in -- so posting to this action directly (bypassing the button, which
// is never rendered for anyone but the one eligible account) still can't
// set the cookie for the wrong user. Never writes profiles.role.
export async function enableViewAsPlayer(): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role, player_id").eq("id", user.id).single();
  if (!isViewSwitchEligible(user.id, profile?.role ?? null)) {
    // Not the one eligible account -- do nothing and send them back
    // where a real user in their role actually belongs, rather than
    // erroring in a way that confirms whether the check passed.
    redirect("/");
  }
  if (!profile?.player_id) {
    redirect("/coach?view_switch=no_player_link");
  }

  cookies().set(VIEW_SWITCH_COOKIE, "player", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  redirect("/player/clubhouse");
}

// Clearing the cookie is harmless for anyone (it only ever mattered for
// the one account it could be set for in the first place), so this
// doesn't re-check identity -- there's nothing to protect.
export async function disableViewAsPlayer(): Promise<void> {
  cookies().delete(VIEW_SWITCH_COOKIE);
  redirect("/coach");
}
