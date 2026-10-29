import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MarketingPage } from "./_marketing/MarketingPage";

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

  if (profile?.team_id) {
    if (profile.role === "coach") redirect("/coach");
    if (profile.role === "operator") redirect("/operator");
    if (profile.role === "player") redirect("/player/clubhouse");
  }
  redirect("/pending");
}
