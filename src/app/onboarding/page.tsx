import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OnboardingForm } from "./onboarding-form";

// Launch-audit Fix 1. No middleware allowlisting needed for this path --
// src/lib/supabase/middleware.ts only actively redirects "/" and the
// three role-home prefixes (/coach, /operator, /player); any other
// path, including this one, already passes through untouched for a
// signed-in user regardless of team_id.
export default async function OnboardingPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("team_id").eq("id", user.id).single();
  if (profile?.team_id) redirect("/");

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="glossy w-full max-w-sm rounded-xl border border-border bg-surface p-8 shadow-2xl shadow-black/40">
        <div className="mb-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-primary">EpicPlay AI</p>
          <h1 className="mt-2 text-2xl font-semibold text-white">Create your team</h1>
          <p className="mt-1 text-sm text-foreground/60">Takes about a minute. You&apos;ll land on your coach dashboard right after.</p>
        </div>
        <OnboardingForm />
      </div>
    </main>
  );
}
