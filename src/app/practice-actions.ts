"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { resetPracticeGameCore } from "@/lib/practice";

// Shared by the game setup page and the operator screen's menu (see
// practice-reset-button.tsx) -- both call this same action rather than
// each having their own copy of the guard logic.
export async function resetPracticeGame(gameId: string): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { data: profile } = await supabase.from("profiles").select("team_id").eq("id", user.id).single();

  const result = await resetPracticeGameCore(supabase, profile?.team_id ?? null, gameId);
  if (!result.ok) throw new Error(result.error ?? "Reset refused");

  revalidatePath(`/coach/games/${gameId}/setup`);
  revalidatePath("/operator");
  revalidatePath("/coach");
}
