import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { MarketingPage } from "./_marketing/MarketingPage";
import { VIEW_SWITCH_COOKIE, isViewSwitchActive } from "@/lib/view-switch";

// Anonymous visitors render the marketing site (src/app/_marketing),
// built natively as React/Three.js/GSAP components. Signed-in users fall
// through to the role-based redirect (mirrors ROLE_HOME in
// src/lib/supabase/middleware.ts), including the team_id gate -- a
// role-matching profile with no team yet still goes to /pending, same as
// every other route.
export default async function HomePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <MarketingPage />;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, team_id")
    .eq("id", user.id)
    .single();

  // "View as player" batch: mirrors the same effectiveRole logic
  // middleware uses, so the home redirect agrees with it instead of
  // bouncing the one toggled coach to /coach only to have middleware
  // immediately redirect them back to /player anyway.
  const viewAsCookie = cookies().get(VIEW_SWITCH_COOKIE)?.value;
  const effectiveRole = isViewSwitchActive(user.id, profile?.role ?? null, viewAsCookie) ? "player" : profile?.role;

  if (profile?.team_id) {
    if (effectiveRole === "coach") redirect("/coach");
    if (effectiveRole === "operator") redirect("/operator");
    if (effectiveRole === "player") redirect("/player/clubhouse");
  }
  redirect("/pending");
}
