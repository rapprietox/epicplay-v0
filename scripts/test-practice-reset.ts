// Proves resetPracticeGameCore (src/lib/practice.ts) -- the guard logic
// shared by the "Reset practice game" Server Action
// (src/app/practice-actions.ts) -- refuses both ways a caller could
// reach a team that isn't the practice team:
//   1. a Lions game id, called as if the caller's own team were the
//      practice team (the "game doesn't belong to the caller's team"
//      check)
//   2. a Lions caller (profile.team_id = Lions), targeting the
//      practice team's own game (the "caller isn't the practice team"
//      check)
// This can't call the exported `resetPracticeGame` Server Action
// directly -- it reads the signed-in user's session via
// `next/headers` cookies(), which only exists inside a real Next.js
// request. Testing `resetPracticeGameCore` instead is still a real
// test of the actual guard: the Server Action does nothing to a game
// except delegate straight to this function once it has the caller's
// team_id, so a bug here is a bug there.
//
// No secrets in this file -- Supabase credentials are read from
// .env.local at runtime, the same way every other data-ops script in
// this repo does.
//
// Usage: npx tsx scripts/test-practice-reset.ts

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resetPracticeGameCore, PRACTICE_TEAM_ID } from "../src/lib/practice";
import type { Database } from "../src/lib/supabase/types";

const LIONS_TEAM_ID = "63111c5c-4af6-40af-91ad-671ff3ae8d75";
const PRACTICE_GAME_ID = "a9cbe742-ccaf-49bf-8aec-6fb170349a77";

function loadEnvLocal(): Record<string, string> {
  return Object.fromEntries(
    readFileSync(new URL("../.env.local", import.meta.url), "utf8")
      .split("\n")
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
  );
}

const env = loadEnvLocal();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  process.exit(1);
}

const admin = createClient<Database>(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

let failures = 0;
function expect(label: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"} -- ${label}`);
  if (!cond) failures++;
}

async function snapshot(gameId: string) {
  const { data } = await admin
    .from("games")
    .select("status, our_score, opponent_score, lineup_confirmed_at")
    .eq("id", gameId)
    .single();
  return data;
}

async function main() {
  const { data: lionsGame, error: lionsGameError } = await admin
    .from("games")
    .select("id")
    .eq("team_id", LIONS_TEAM_ID)
    .limit(1)
    .single();
  if (lionsGameError || !lionsGame) {
    console.error("Could not find a Lions game to test against -- nothing was run.", lionsGameError?.message);
    process.exit(1);
  }

  const lionsBefore = await snapshot(lionsGame.id);
  const practiceBefore = await snapshot(PRACTICE_GAME_ID);

  // 1. A Lions game id, caller's team_id claims to be the practice team.
  const r1 = await resetPracticeGameCore(admin, PRACTICE_TEAM_ID, lionsGame.id);
  expect("refuses a Lions game id", r1.ok === false);

  // 2. A Lions caller (profile.team_id = Lions), targeting the practice game.
  const r2 = await resetPracticeGameCore(admin, LIONS_TEAM_ID, PRACTICE_GAME_ID);
  expect("refuses a Lions caller", r2.ok === false);

  const lionsAfter = await snapshot(lionsGame.id);
  const practiceAfter = await snapshot(PRACTICE_GAME_ID);
  expect("Lions game unchanged", JSON.stringify(lionsBefore) === JSON.stringify(lionsAfter));
  expect("practice game unchanged", JSON.stringify(practiceBefore) === JSON.stringify(practiceAfter));

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED.`);
    process.exit(1);
  }
  console.log("\nAll checks passed -- the guard can't reach another team's game.");
}

void main();
