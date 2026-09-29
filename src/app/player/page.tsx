import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/sign-out-button";

export default async function PlayerPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, role, player_id, team_id")
    .eq("id", user.id)
    .single();

  // Clubhouse batch: a linked player (player_id set) always lands on the
  // real Clubhouse -- this placeholder now only ever shows for the
  // narrower edge case of a profile that's team-linked (so middleware let
  // them through to /player) but not yet player-linked, e.g. hand-set via
  // SQL per supabase/README.md without a player_id, or role='player' with
  // no roster row claimed yet.
  if (profile?.player_id) redirect("/player/clubhouse");

  const team = profile?.team_id
    ? (await supabase.from("teams").select("name").eq("id", profile.team_id).single()).data
    : null;

  return (
    <main className="flex min-h-screen flex-col bg-background px-6 py-8">
      <header className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-green">
            Player
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-white">
            {team?.name ?? "Team"} &mdash; My Stats
          </h1>
        </div>
        <SignOutButton />
      </header>
      <p className="mt-6 text-sm text-foreground/60">
        Signed in as {profile?.full_name ?? profile?.email} (role: {profile?.role}).
        AVG/OBP/SLG, heat maps, and spray charts build on this route in Sprint 2.
      </p>
    </main>
  );
}
