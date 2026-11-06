import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

// The one standing practice team, created for internal testing without
// touching any real team's data -- see
// supabase/data-ops/reset-practice-game.mjs, which this file's reset
// logic mirrors exactly (same guard, same five tables, same games
// update).
export const PRACTICE_TEAM_ID = "ebf554cd-e0d9-421e-9043-e31f593633fe";

export interface ResetPracticeGameResult {
  ok: boolean;
  error?: string;
}

// Deliberately not a Server Action itself (no "use server" in this
// file) -- a "use server" file may only export async functions, so the
// PRACTICE_TEAM_ID constant above couldn't live alongside one. Keeping
// the actual guard + delete logic here as a plain function also means
// it can be called directly with any Supabase client and any caller
// team_id (not just a real signed-in session), which is what lets a
// test exercise the real refusal behavior instead of a reimplementation
// of it. src/app/practice-actions.ts wraps this for the UI with the
// real session/profile lookup.
export async function resetPracticeGameCore(
  supabase: SupabaseClient<Database>,
  callerTeamId: string | null,
  gameId: string
): Promise<ResetPracticeGameResult> {
  if (callerTeamId !== PRACTICE_TEAM_ID) {
    return { ok: false, error: "This action is only available on the practice team." };
  }

  const { data: game, error: gameError } = await supabase
    .from("games")
    .select("id, team_id")
    .eq("id", gameId)
    .maybeSingle();
  if (gameError) return { ok: false, error: gameError.message };
  if (!game || game.team_id !== PRACTICE_TEAM_ID) {
    return { ok: false, error: "That game does not belong to the practice team." };
  }

  for (const [table, column] of [
    ["at_bats", "game_id"],
    ["game_events", "game_id"],
    ["stolen_bases", "game_id"],
    ["substitutions", "game_id"],
    ["game_state", "game_id"],
  ] as const) {
    const { error } = await supabase.from(table).delete().eq(column, gameId);
    if (error) return { ok: false, error: `Failed deleting ${table}: ${error.message}` };
  }

  const { error: updateError } = await supabase
    .from("games")
    .update({ status: "setup", our_score: 0, opponent_score: 0, lineup_confirmed_at: null })
    .eq("id", gameId);
  if (updateError) return { ok: false, error: `Failed resetting game: ${updateError.message}` };

  return { ok: true };
}
