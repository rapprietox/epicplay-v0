import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MarketingPage } from "./marketing-page";

// "/" is a public path in middleware now (see src/lib/supabase/middleware.ts)
// so this component has to do its own signed-in-user redirect -- mirrors
// ROLE_HOME there, including the team_id gate (a role-matching profile with
// no team yet still goes to /pending, same as every other route).
export default async function HomePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
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

  return <MarketingPage />;
}
