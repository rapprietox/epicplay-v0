// Resets the practice team's standing practice game back to a clean,
// pre-start state -- same shape as a normal "reset the dummy game"
// data op, just permanently guarded to the practice team so it can
// never be pointed at a real team's game by mistake (a typo'd id, a
// copy-pasted command, etc).
//
// What it does, for the target game only:
//   - deletes at_bats (pitches cascade automatically -- see
//     pitches.at_bat_id's "on delete cascade" in
//     supabase/migrations/20260907120008_pitches.sql, no separate
//     delete needed), game_events, stolen_bases, substitutions, and the
//     game_state row
//   - sets games.status = 'setup', our_score = 0, opponent_score = 0,
//     lineup_confirmed_at = null
// What it leaves untouched: the game's own lineup rows (the 10
// starters + 2 reserve) and every other games column (opponent,
// home/away, logging_mode, the max-innings override, etc) -- only the
// *live play* state resets, not the setup.
//
// Refuses to run against any game whose team_id isn't PRACTICE_TEAM_ID
// below, checked by querying the game itself before touching anything
// -- this is the one thing that makes this script safe to keep around
// and safe to re-run, not a one-off.
//
// No secrets in this file: it reads NEXT_PUBLIC_SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY from the environment it's run in (e.g. via
// `node --env-file=.env.local` on Node 20.6+, or any other way you
// already load .env.local into the shell) and never hardcodes either.
//
// Usage:
//   node --env-file=.env.local supabase/data-ops/reset-practice-game.mjs [gameId]
// With no argument, resets DEFAULT_GAME_ID (the practice team's
// standing game, created alongside the team itself).

import { createClient } from "@supabase/supabase-js";

const PRACTICE_TEAM_ID = "ebf554cd-e0d9-421e-9043-e31f593633fe"; // PRACTICE TEAM
const DEFAULT_GAME_ID = "a9cbe742-ccaf-49bf-8aec-6fb170349a77"; // practice team's standing practice game

const gameId = process.argv[2] ?? DEFAULT_GAME_ID;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in the environment. " +
      "Load .env.local first (e.g. `node --env-file=.env.local supabase/data-ops/reset-practice-game.mjs`) -- " +
      "this script never reads or hardcodes either value itself."
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const { data: game, error: gameError } = await supabase
  .from("games")
  .select("id, team_id, opponent_name, status")
  .eq("id", gameId)
  .maybeSingle();
if (gameError) {
  console.error(gameError.message);
  process.exit(1);
}
if (!game) {
  console.error(`No game found with id ${gameId}. Nothing was changed.`);
  process.exit(1);
}
if (game.team_id !== PRACTICE_TEAM_ID) {
  console.error(
    `Refusing to reset game ${gameId}: it belongs to team ${game.team_id}, not the practice team (${PRACTICE_TEAM_ID}). Nothing was changed.`
  );
  process.exit(1);
}

console.log(`Resetting practice game ${gameId} (vs ${game.opponent_name}, currently status="${game.status}")...`);

for (const [table, column] of [
  ["at_bats", "game_id"],
  ["game_events", "game_id"],
  ["stolen_bases", "game_id"],
  ["substitutions", "game_id"],
  ["game_state", "game_id"],
]) {
  const { error } = await supabase.from(table).delete().eq(column, gameId);
  if (error) throw new Error(`Failed deleting ${table}: ${error.message}`);
}

const { error: updateError } = await supabase
  .from("games")
  .update({ status: "setup", our_score: 0, opponent_score: 0, lineup_confirmed_at: null })
  .eq("id", gameId);
if (updateError) throw new Error(`Failed resetting games row: ${updateError.message}`);

console.log("Done. Lineup rows were left untouched.");
