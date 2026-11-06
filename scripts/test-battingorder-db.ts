// DB-integration reproduction + regression test for the batting-order
// bug reported on fix/dp-fc (commit dbc5e4d): "Walk, then Ground Out,
// answer 'Safe', mark the runner Out" (an implicit fielder's choice) "...
// I tap Undo, and the outs and runner are restored, but the current
// batter is now batter 3, not batter 2. Doing it again makes it batter 4."
//
// This calls the REAL "use server" actions (logQuickAtBat, logExtraOut,
// undoAtBat, syncGameState, getOrCreateGameState) against the real
// practice game in the database -- not the reducer in isolation, which
// is exactly why the previous round of proof scripts (test-undo.ts,
// test-implicit-fc.ts) passed without ever seeing this bug: they never
// called the server actions at all, only the reducer. Everything in
// scripts/test-db-lib/ exists solely to make that possible outside a
// real Next.js request (see each stub file's own comment for why).
//
// Two parts:
//  - Part A replays the exact reported sequence (walk, fielder's choice,
//    Undo, twice in a row) end to end, sequentially, against the real
//    actions. This passes both before and after the fix -- a fully
//    sequential, fully-awaited replay never gives the old
//    read-current-then-subtract-one undoAtBat a reason to see a
//    battingOrderPosition it didn't expect, so it can't show the bug by
//    itself. It's kept here because it IS the literal reported steps,
//    and because Part B only makes sense once Part A has established the
//    normal, uncorrupted case already works.
//  - Part B is the actual regression test. It reproduces the *class* of
//    bug the old undoAtBat/reverseBattingOrder was vulnerable to --
//    anything changing game_state.batting_order_position between a
//    play's forward advance and its Undo (a race between two
//    overlapping fire-and-forget requests, a retried write, or anything
//    else) -- deterministically, by writing an arbitrary value into
//    game_state.batting_order_position in between (standing in for
//    whatever actually perturbed it live; the old code's bug was that it
//    couldn't tell the difference between "untouched since the play" and
//    "touched by something else," since it never captured what the
//    position was supposed to be in the first place). The OLD undoAtBat
//    (reverseBattingOrder: read the current, possibly-corrupted value,
//    subtract one slot) necessarily restores the WRONG batter here --
//    confirmed by git-stashing this fix and re-running this file, which
//    fails Part B (previousBattingOrderPosition(slots, 99) falls back to
//    the *last* occupied slot, not anything close to the snapshotted
//    value). The NEW undoAtBat (restoreBattingOrderPosition: an explicit
//    value the client snapshotted before the play ever advanced
//    anything, written back verbatim) is immune to the corruption by
//    construction -- it never reads the column to decide what to write.
//
// Usage: npx tsx scripts/test-battingorder-db.ts
//
// Resets the practice game's game_state/at_bats before AND after running
// (the "after" reset is in a finally block, so it still runs on failure).

import ModuleNS from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const dir = path.dirname(fileURLToPath(import.meta.url));

// Same CJS Module._load monkeypatch as the stub loader -- tsx loads
// actions.ts (and its own dependency graph) through Node's CJS
// require() path, not the ESM resolve/load hooks, so an ESM loader
// registered via node:module's register() never sees these specifiers.
const REDIRECTS: Record<string, string> = {
  "@/lib/supabase/server": path.join(dir, "test-db-lib", "supabase-server-stub.ts"),
  "@/lib/anthropic": path.join(dir, "test-db-lib", "anthropic-stub.ts"),
  "@/lib/post-game-analysis": path.join(dir, "test-db-lib", "post-game-analysis-stub.ts"),
  "next/cache": path.join(dir, "test-db-lib", "next-cache-stub.ts"),
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AnyModule = ModuleNS as any;
const originalLoad = AnyModule._load;
AnyModule._load = function (request: string, parent: unknown, isMain: boolean) {
  if (REDIRECTS[request]) return originalLoad.call(this, REDIRECTS[request], parent, isMain);
  return originalLoad.call(this, request, parent, isMain);
};

const PRACTICE_TEAM_ID = "ebf554cd-e0d9-421e-9043-e31f593633fe";
const GAME_ID = "a9cbe742-ccaf-49bf-8aec-6fb170349a77";
const COACH_USER_ID = "dd7fb44e-c0f8-475b-be10-c453e0fba916";

function loadEnv(): Record<string, string> {
  const text = readFileSync(path.join(dir, "..", ".env.local"), "utf8");
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    if (!line.includes("=") || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

let failures = 0;
function expect(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} -- ${label}: got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const resetGameState = async (admin: any) => {
  await admin.from("at_bats").delete().eq("game_id", GAME_ID);
  await admin.from("game_state").delete().eq("game_id", GAME_ID);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const gameStatePosition = async (admin: any): Promise<number | null> => {
  const { data } = await admin.from("game_state").select("batting_order_position").eq("game_id", GAME_ID).single();
  return data?.batting_order_position ?? null;
};

async function main() {
  const env = loadEnv();
  const admin = createServiceClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: game } = await admin.from("games").select("id, team_id").eq("id", GAME_ID).single();
  if (!game || game.team_id !== PRACTICE_TEAM_ID) {
    throw new Error(`Refusing: ${GAME_ID} is not the practice team's game. Nothing was touched.`);
  }

  const { data: lineup } = await admin
    .from("lineup")
    .select("player_id, batting_order")
    .eq("game_id", GAME_ID)
    .not("batting_order", "is", null)
    .order("batting_order");
  const slots = (lineup ?? []).map((l) => l.batting_order as number);
  const batter1 = (lineup ?? []).find((l) => l.batting_order === 1)!.player_id as string;
  const batter2 = (lineup ?? []).find((l) => l.batting_order === 2)!.player_id as string;
  console.log("occupied batting-order slots:", slots, "| batter1:", batter1, "| batter2:", batter2);

  await resetGameState(admin);

  const { __setTestUserId } = await import("./test-db-lib/supabase-server-stub");
  __setTestUserId(COACH_USER_ID);
  const actions = await import("../src/app/operator/actions");
  const { nextBattingOrderPosition } = await import("../src/lib/operator/batting-order");

  try {
    await actions.getOrCreateGameState(GAME_ID);
    await actions.syncGameState(GAME_ID, { mode: "hitting", outs: 0, batting_order_position: 1, runners: {} });

    console.log("\n=== Part A: the exact reported sequence -- Walk, fielder's choice, Undo, twice in a row ===");

    // Local reducer's own idea of "the on-screen batter," tracked in
    // parallel so every step below can compare it against game_state.
    let local = 1;
    expect("game_state starts at 1", await gameStatePosition(admin), 1);

    console.log("\n--- Walk (batter 1) ---");
    await actions.logQuickAtBat({
      gameId: GAME_ID,
      mode: "hitting",
      playerId: batter1,
      pitcherId: null,
      inning: 1,
      inningHalf: "top",
      battingOrderPosition: 1,
      result: "walk",
      hitType: null,
      rbi: 0,
      runsScored: 0,
      opponentPitcherId: null,
      outsBefore: 0,
      rispBefore: false,
      fieldX: null,
      fieldY: null,
    });
    local = nextBattingOrderPosition(slots, local);
    const afterWalkServer = await gameStatePosition(admin);
    console.log(`after Walk -- local: ${local} | game_state: ${afterWalkServer}`);
    expect("after Walk: local and game_state agree", local, afterWalkServer);
    const postWalkPosition = local; // what Undo-ing the FC play should restore to

    const runFieldersChoiceThenUndo = async (cycle: number) => {
      console.log(`\n--- Cycle ${cycle}: Ground Out, batter safe, runner (batter 1) out -- a fielder's choice ---`);

      // beginImplicitFcFlow/finalizeImplicitFc's snapshot: taken BEFORE
      // the fc row's own forward advance, exactly like
      // QUICK_CONFIRM_LOCAL's lastConfirmed.battingOrderPosition does.
      const snapshotBeforePlay = local;

      // finalizeImplicitFc's Quick Mode branch: the batter's own
      // (never-out) fc row first (this IS the play's one real plate
      // appearance -- advances the order once), then logExtraOut for the
      // runner marked "Out" (must NOT advance the order again).
      const fc = await actions.logQuickAtBat({
        gameId: GAME_ID,
        mode: "hitting",
        playerId: batter2,
        pitcherId: null,
        inning: 1,
        inningHalf: "top",
        battingOrderPosition: postWalkPosition,
        result: "fc",
        hitType: "groundball",
        rbi: 0,
        runsScored: 0,
        opponentPitcherId: null,
        outsBefore: 0,
        rispBefore: false,
        fieldX: null,
        fieldY: null,
      });
      local = nextBattingOrderPosition(slots, local);
      console.log(`  after fc batter row -- local: ${local} | game_state: ${await gameStatePosition(admin)}`);
      expect(`cycle ${cycle}: after fc row, local and game_state agree`, local, await gameStatePosition(admin));

      const extra = await actions.logExtraOut({
        gameId: GAME_ID,
        mode: "hitting",
        playerId: batter1,
        pitcherId: null,
        inning: 1,
        inningHalf: "top",
        result: "fc",
      });
      console.log(`  after logExtraOut (runner's own out row) -- local: ${local} | game_state: ${await gameStatePosition(admin)}`);
      expect(`cycle ${cycle}: logExtraOut must not advance the order`, await gameStatePosition(admin), local);
      await actions.syncGameState(GAME_ID, { outs: 1 });

      console.log(`  -- Undo --`);
      local = snapshotBeforePlay; // the new, non-arithmetic restore
      await actions.undoAtBat({
        gameId: GAME_ID,
        atBatId: fc.atBatId,
        secondAtBatId: extra.atBatId,
        mode: "hitting",
        runsScoredToReverse: 0,
        restoreBattingOrderPosition: snapshotBeforePlay,
      });
      await actions.syncGameState(GAME_ID, { outs: 0 });

      const afterUndoServer = await gameStatePosition(admin);
      console.log(`  after Undo -- local: ${local} | game_state: ${afterUndoServer}`);
      expect(`cycle ${cycle}: after Undo, local is back to batter 2`, local, postWalkPosition);
      expect(`cycle ${cycle}: after Undo, game_state is back to batter 2`, afterUndoServer, postWalkPosition);
      expect(`cycle ${cycle}: after Undo, local and game_state agree`, local, afterUndoServer);
    }

    await runFieldersChoiceThenUndo(1);
    await runFieldersChoiceThenUndo(2);

    console.log("\n=== Part B: Undo must restore the snapshot, not recompute from whatever the column currently holds ===");
    {
      await resetGameState(admin);
      await actions.getOrCreateGameState(GAME_ID);
      await actions.syncGameState(GAME_ID, { mode: "hitting", outs: 0, batting_order_position: 1, runners: {} });

      await actions.logQuickAtBat({
        gameId: GAME_ID,
        mode: "hitting",
        playerId: batter1,
        pitcherId: null,
        inning: 1,
        inningHalf: "top",
        battingOrderPosition: 1,
        result: "walk",
        hitType: null,
        rbi: 0,
        runsScored: 0,
        opponentPitcherId: null,
        outsBefore: 0,
        rispBefore: false,
        fieldX: null,
        fieldY: null,
      });
      const snapshotBeforePlay = 2; // batter 2, same as Part A

      const fc = await actions.logQuickAtBat({
        gameId: GAME_ID,
        mode: "hitting",
        playerId: batter2,
        pitcherId: null,
        inning: 1,
        inningHalf: "top",
        battingOrderPosition: 2,
        result: "fc",
        hitType: "groundball",
        rbi: 0,
        runsScored: 0,
        opponentPitcherId: null,
        outsBefore: 0,
        rispBefore: false,
        fieldX: null,
        fieldY: null,
      });
      const extra = await actions.logExtraOut({
        gameId: GAME_ID,
        mode: "hitting",
        playerId: batter1,
        pitcherId: null,
        inning: 1,
        inningHalf: "top",
        result: "fc",
      });
      expect("game_state at 3 right after the fc play", await gameStatePosition(admin), 3);

      // Stand in for whatever actually perturbs the column live (a race
      // between two overlapping fire-and-forget requests, a retried
      // write, anything) -- the old undoAtBat had no way to tell "this
      // is still what the play left it at" apart from "something else
      // changed it," because it never captured what it *should* restore
      // to; it just read whatever was there.
      await admin.from("game_state").update({ batting_order_position: 99 }).eq("game_id", GAME_ID);
      console.log("  (simulated an intervening write: game_state.batting_order_position forced to 99)");

      await actions.undoAtBat({
        gameId: GAME_ID,
        atBatId: fc.atBatId,
        secondAtBatId: extra.atBatId,
        mode: "hitting",
        runsScoredToReverse: 0,
        restoreBattingOrderPosition: snapshotBeforePlay,
      });

      const restored = await gameStatePosition(admin);
      console.log(`  after Undo despite the intervening corruption -- game_state: ${restored}`);
      expect("Undo restores the snapshotted value, ignoring the corrupted current one", restored, snapshotBeforePlay);
    }

    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  } finally {
    await resetGameState(admin);
    console.log("\n(practice game at_bats/game_state reset after the test)");
  }

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("TEST SCRIPT ERROR:", e);
  process.exit(1);
});
