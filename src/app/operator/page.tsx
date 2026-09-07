import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/sign-out-button";

export default async function OperatorPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, role, team_id")
    .eq("id", user.id)
    .single();

  const team = profile?.team_id
    ? (await supabase.from("teams").select("name").eq("id", profile.team_id).single()).data
    : null;

  return (
    <main className="flex min-h-screen flex-col bg-background px-6 py-8">
      <header className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-amber">
            Operator
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-white">
            {team?.name ?? "Team"} &mdash; Game Console
          </h1>
        </div>
        <SignOutButton />
      </header>
      <p className="mt-6 text-sm text-foreground/60">
        Signed in as {profile?.full_name ?? profile?.email} (role: {profile?.role}).
        Live game logging screens build on this route in Sprint 2.
      </p>
    </main>
  );
}
