// Proof script for fix/loud-substitutions. Runs the REAL exported
// server actions (confirmChainSubstitution, getLineupForGame from
// src/app/operator/actions.ts) against the practice team's real game --
// not a reimplementation, not a mock. Same Module._load redirect
// technique as scripts/test-battingorder-db.ts, for the same reason:
// createClient() in src/lib/supabase/server.ts calls next/headers'
// cookies(), which throws outside a real Next.js request, so the
// stub swaps that one dependency for a service-role client with a
// fixed test user; everything else in actions.ts runs unmodified.
//
// Five cases, per the request: success, zero rows matched, a server
// error, a repeated tap, and a game that isn't active.
//
// Usage: npx tsx scripts/test-loud-substitutions.ts
//
// Resets the practice game's lineup/substitutions/status before AND
// after running (the "after" reset is in a finally block, so it still
// runs on failure) -- this game is shared with test-battingorder-db.ts
// and test-undo.ts/test-implicit-fc.ts/test-dp-fc.ts, so leaving it
// exactly as found matters.

import ModuleNS from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const dir = path.dirname(fileURLToPath(import.meta.url));

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

// From the practice lineup (confirmed read-only before writing this
// script): Jordan Ellis (slot 1, P, starting) <-> Sam Rivera (bench) is
// the success/repeated-tap pair; Marcus Webb (slot 2, C, starting) is
// the outgoing side for the zero-rows and not-active cases; Tyler
// Nguyen (slot 4, 2B, starting) is the outgoing side for the
// server-error case; Owen Delgado (bench) is the incoming side for the
// not-active case.
const JORDAN = "29238fd9-6738-451c-a14e-3e12ec2033bb";
const SAM = "82f10ef4-4541-4ded-b1d8-69d93ac21f42";
const MARCUS = "b20990f5-0e24-4573-ab6c-68ca88002960";
const TYLER = "d69d4b39-61c5-4fbf-a426-2f9e46c3f2a8";
const OWEN = "47b4d6ce-f273-40ae-a200-bdfcb28796f5";
const FAKE_PLAYER_ID = "00000000-0000-0000-0000-000000000000"; // valid UUID shape, no lineup row for this game

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
function check(label: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"} -- ${label}`);
  if (!cond) failures += 1;
}

async function expectThrow(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (process.env.DEBUG_LOUD_SUB_TEST) console.error("DEBUG caught:", e);
    return e instanceof Error ? e.message : String(e);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function lineupRow(admin: any, playerId: string) {
  const { data } = await admin.from("lineup").select("batting_order, position, status").eq("game_id", GAME_ID).eq("player_id", playerId).single();
  return data as { batting_order: number | null; position: string | null; status: string };
}

async function main() {
  const env = loadEnv();
  const admin = createServiceClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: game } = await admin.from("games").select("id, team_id, status").eq("id", GAME_ID).single();
  if (!game || game.team_id !== PRACTICE_TEAM_ID) {
    throw new Error(`Refusing: ${GAME_ID} is not the practice team's game. Nothing was touched.`);
  }
  const originalStatus: string = game.status;
  const originalJordan = await lineupRow(admin, JORDAN);
  const originalSam = await lineupRow(admin, SAM);
  const originalMarcus = await lineupRow(admin, MARCUS);
  const originalTyler = await lineupRow(admin, TYLER);
  const originalOwen = await lineupRow(admin, OWEN);
  const { data: existingSubsBefore } = await admin.from("substitutions").select("id").eq("game_id", GAME_ID);
  if ((existingSubsBefore ?? []).length > 0) {
    throw new Error(`Refusing: ${GAME_ID} already has ${existingSubsBefore!.length} substitutions row(s). Expected 0 -- another test may be mid-run.`);
  }

  const { __setTestUserId } = await import("./test-db-lib/supabase-server-stub");
  __setTestUserId(COACH_USER_ID);
  const actions = await import("../src/app/operator/actions");
  const { GAME_NOT_ACTIVE_ERROR } = await import("../src/lib/operator/chain-substitution");

  async function reset() {
    await admin.from("substitutions").delete().eq("game_id", GAME_ID);
    await admin.from("game_events").delete().eq("game_id", GAME_ID).eq("event_type", "substitution");
    for (const [playerId, original] of [
      [JORDAN, originalJordan],
      [SAM, originalSam],
      [MARCUS, originalMarcus],
      [TYLER, originalTyler],
      [OWEN, originalOwen],
    ] as const) {
      await admin.from("lineup").update(original).eq("game_id", GAME_ID).eq("player_id", playerId);
    }
    await admin.from("games").update({ status: originalStatus }).eq("id", GAME_ID);
  }

  try {
    await admin.from("games").update({ status: "active" }).eq("id", GAME_ID);

    console.log("=== Case 1: success -- Sam Rivera in for Jordan Ellis ===");
    {
      const err = await expectThrow(() =>
        actions.confirmChainSubstitution(GAME_ID, {
          incomingPlayerId: SAM,
          entryPosition: "P",
          outgoingPlayerId: JORDAN,
          positionMoves: [],
          reason: "tactical",
          inning: 1,
          inningHalf: "top",
          chainNote: "Sam Rivera -> P position. Jordan Ellis -> bench.",
        })
      );
      check("confirmChainSubstitution does not throw", err === null);

      const sam = await lineupRow(admin, SAM);
      const jordan = await lineupRow(admin, JORDAN);
      check("Sam is now starting at P, slot 1", sam.status === "starting" && sam.position === "P" && sam.batting_order === 1);
      check("Jordan is now reserve, no slot/position", jordan.status === "reserve" && jordan.position === null && jordan.batting_order === null);

      const { data: subs } = await admin.from("substitutions").select("*").eq("game_id", GAME_ID).eq("player_out_id", JORDAN).eq("player_in_id", SAM);
      check("exactly one substitutions row was written", (subs ?? []).length === 1);

      // getLineupForGame: the re-read the client now does after a
      // successful save. Confirms it reflects the database, not a
      // guess -- the whole point of this batch.
      const freshLineup = await actions.getLineupForGame(GAME_ID);
      const freshSam = freshLineup.find((l: { player_id: string }) => l.player_id === SAM);
      check("getLineupForGame reflects Sam's new row", freshSam?.status === "starting" && freshSam?.position === "P" && freshSam?.batting_order === 1);
    }

    console.log("\n=== Case 2: repeated tap -- the exact same pair again ===");
    {
      const err = await expectThrow(() =>
        actions.confirmChainSubstitution(GAME_ID, {
          incomingPlayerId: SAM,
          entryPosition: "P",
          outgoingPlayerId: JORDAN,
          positionMoves: [],
          reason: "tactical",
          inning: 1,
          inningHalf: "top",
          chainNote: "Sam Rivera -> P position. Jordan Ellis -> bench.",
        })
      );
      check("a repeated tap does not throw (skip, not an error)", err === null);

      const { data: subs } = await admin.from("substitutions").select("*").eq("game_id", GAME_ID).eq("player_out_id", JORDAN).eq("player_in_id", SAM);
      check("still exactly one substitutions row -- no duplicate", (subs ?? []).length === 1);

      const sam = await lineupRow(admin, SAM);
      check("Sam's row is unchanged by the repeat", sam.status === "starting" && sam.position === "P" && sam.batting_order === 1);
    }

    console.log("\n=== Case 3: zero rows matched -- incoming player has no lineup row for this game ===");
    {
      const err = await expectThrow(() =>
        actions.confirmChainSubstitution(GAME_ID, {
          incomingPlayerId: FAKE_PLAYER_ID,
          entryPosition: "C",
          outgoingPlayerId: MARCUS,
          positionMoves: [],
          reason: "tactical",
          inning: 2,
          inningHalf: "top",
          chainNote: "test -- should never land",
        })
      );
      check("throws instead of silently reporting success", err !== null);
      check('error names the zero-row update, not a generic failure', err === "Cannot complete this substitution: no lineup row found for the incoming player.");

      // Known, documented trade-off from the outgoing-before-incoming
      // reorder (see actions.ts's own comment): the outgoing player's
      // clear already committed by the time the incoming side fails, so
      // Marcus is left reserve/no-slot rather than untouched. A real
      // Retry can't un-fail this specific case (the incoming id is
      // simply invalid for this game), but the no-duplicate-row
      // guarantee below still holds, and the UI now re-reads the
      // lineup on failure too so this partial state is at least shown
      // accurately, not hidden behind stale data.
      const marcus = await lineupRow(admin, MARCUS);
      check("Marcus's outgoing clear still committed (documented trade-off, not silently masked)", marcus.status === "reserve" && marcus.position === null && marcus.batting_order === null);
      const { data: subs } = await admin.from("substitutions").select("id").eq("game_id", GAME_ID).eq("player_out_id", MARCUS);
      check("no substitutions row was written", (subs ?? []).length === 0);

      // Restore Marcus immediately so the next case starts clean --
      // the finally-block reset() still runs at the very end regardless.
      await admin.from("lineup").update(originalMarcus).eq("game_id", GAME_ID).eq("player_id", MARCUS);
    }

    console.log("\n=== Case 4: a server error -- malformed player id ===");
    {
      const err = await expectThrow(() =>
        actions.confirmChainSubstitution(GAME_ID, {
          incomingPlayerId: "not-a-real-uuid",
          entryPosition: "2B",
          outgoingPlayerId: TYLER,
          positionMoves: [],
          reason: "tactical",
          inning: 2,
          inningHalf: "bottom",
          chainNote: "test -- should never land",
        })
      );
      check("throws a real (not swallowed) server error", err !== null);
      check("the error is a genuine DB rejection, distinct from the zero-rows case", err !== null && !err.includes("no lineup row found"));

      const tyler = await lineupRow(admin, TYLER);
      check("Tyler's own row is untouched", tyler.status === "starting" && tyler.position === "2B" && tyler.batting_order === 4);
    }

    console.log("\n=== Case 5: a game that isn't active ===");
    {
      await admin.from("games").update({ status: "completed" }).eq("id", GAME_ID);

      const err = await expectThrow(() =>
        actions.confirmChainSubstitution(GAME_ID, {
          incomingPlayerId: OWEN,
          entryPosition: "C",
          outgoingPlayerId: MARCUS,
          positionMoves: [],
          reason: "tactical",
          inning: 3,
          inningHalf: "top",
          chainNote: "test -- should never land",
        })
      );
      check("throws exactly GAME_NOT_ACTIVE_ERROR", err === GAME_NOT_ACTIVE_ERROR);

      const marcus = await lineupRow(admin, MARCUS);
      check("Marcus's row is untouched -- the gate fired before any write", marcus.status === "starting" && marcus.position === "C" && marcus.batting_order === 2);
      const { data: subs } = await admin.from("substitutions").select("id").eq("game_id", GAME_ID).eq("player_out_id", MARCUS).eq("player_in_id", OWEN);
      check("no substitutions row was written", (subs ?? []).length === 0);

      await admin.from("games").update({ status: "active" }).eq("id", GAME_ID);
    }
  } finally {
    await reset();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("SCRIPT ERROR:", e);
  process.exit(1);
});
