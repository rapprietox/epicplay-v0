// Proof script for fix/vacant-slot. Runs the REAL exported server
// action (confirmChainSubstitution, src/app/operator/actions.ts) and the
// REAL exported client helper (computeVacantBattingSlots,
// src/app/operator/chain-substitution-modal.tsx) against the practice
// team's real game -- not a reimplementation, not a mock. Same
// Module._load redirect technique as scripts/test-loud-substitutions.ts,
// for the same reason: createClient() in src/lib/supabase/server.ts
// calls next/headers' cookies(), which throws outside a real Next.js
// request.
//
// Scenario, per the request ("P to C move plus new pitcher with no
// outgoing player produces a picker, never a null slot"): Marcus Webb
// (C, slot 2) is temporarily pulled to simulate "this team is playing
// without a catcher right now" (an open defensive position AND a
// vacant batting slot -- the real-world precondition the bug needed).
// Owen Delgado (currently P) moves P -> C, landing on that now-open
// spot (a position move, no one displaced -- outgoingPlayerId stays
// null, exactly the branch confirmChainSubstitution used to skip).
// Jordan Ellis (bench) enters the P slot Owen just vacated.
//
// Two cases:
//   1. computeVacantBattingSlots sees the hole (slot 2) and would show
//      the picker; confirmChainSubstitution called with NO
//      battingOrderAssignments throws instead of writing a null
//      batting_order (the bug).
//   2. The same call WITH the picker's assignment (Jordan -> slot 2)
//      succeeds, Jordan's row gets a real batting_order (never null),
//      and the vacancy is gone afterward.
//
// Usage: npx tsx scripts/test-vacant-slot.ts
//
// Resets Marcus Webb/Owen Delgado/Jordan Ellis's lineup rows before AND
// after running (the "after" reset is in a finally block, so it still
// runs on failure) -- this game is shared with several other proof
// scripts, so leaving it exactly as found matters. Two pre-existing
// substitutions rows on this game (dated 2026-11-13, from an earlier
// session) are left untouched -- they don't involve any player this
// script touches.

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

// Confirmed live (read-only) immediately before writing this script:
// Owen Delgado P/slot1, Marcus Webb C/slot2, Jordan Ellis reserve/bench.
const OWEN = "47b4d6ce-f273-40ae-a200-bdfcb28796f5";
const MARCUS = "b20990f5-0e24-4573-ab6c-68ca88002960";
const JORDAN = "29238fd9-6738-451c-a14e-3e12ec2033bb";

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
    if (process.env.DEBUG_VACANT_SLOT_TEST) console.error("DEBUG caught:", e);
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
  const originalOwen = await lineupRow(admin, OWEN);
  const originalMarcus = await lineupRow(admin, MARCUS);
  const originalJordan = await lineupRow(admin, JORDAN);
  if (originalMarcus.batting_order === null || originalOwen.batting_order === null) {
    throw new Error("Refusing: expected Marcus Webb and Owen Delgado to both currently hold real batting slots. Lineup drifted -- check manually.");
  }
  const marcusSlot = originalMarcus.batting_order;

  const { __setTestUserId } = await import("./test-db-lib/supabase-server-stub");
  __setTestUserId(COACH_USER_ID);
  const actions = await import("../src/app/operator/actions");
  const { NO_BATTING_ORDER_ERROR } = await import("../src/lib/operator/chain-substitution");
  const { computeVacantBattingSlots } = await import("../src/app/operator/chain-substitution-modal");

  async function reset() {
    await admin.from("game_events").delete().eq("game_id", GAME_ID).eq("event_type", "substitution").eq("player_id", JORDAN);
    // Order matters: lineup has `unique (game_id, batting_order)`. Case 2
    // leaves Jordan holding Marcus's original slot number, so Jordan's
    // claim on it MUST be cleared (-> null) before Marcus's row is
    // restored to that same number, or Marcus's restore silently fails
    // a unique-constraint conflict (caught the hard way: it left Marcus
    // stuck on the bench after an early version of this script ran).
    // Clearing Jordan first is always safe regardless of which case ran.
    for (const [playerId, original] of [
      [JORDAN, originalJordan],
      [OWEN, originalOwen],
      [MARCUS, originalMarcus],
    ] as const) {
      const { error } = await admin.from("lineup").update(original).eq("game_id", GAME_ID).eq("player_id", playerId);
      if (error) throw new Error(`reset() failed to restore ${playerId}: ${error.message}`);
    }
    await admin.from("games").update({ status: originalStatus }).eq("id", GAME_ID);
  }

  try {
    await admin.from("games").update({ status: "active" }).eq("id", GAME_ID);

    console.log("=== Setup: pull Marcus Webb (C) to simulate the team playing without a catcher ===");
    await admin.from("lineup").update({ position: null, batting_order: null, status: "reserve" }).eq("game_id", GAME_ID).eq("player_id", MARCUS);

    const lineupAfterPull = await admin
      .from("lineup")
      .select("status, batting_order")
      .eq("game_id", GAME_ID);
    const vacantBefore = computeVacantBattingSlots(lineupAfterPull.data ?? []);
    check(`computeVacantBattingSlots finds slot ${marcusSlot} vacant -- the picker would show`, vacantBefore.includes(marcusSlot));

    console.log("\n=== Case 1: Owen P->C, Jordan into P, no outgoing player, NO picker assignment -- must throw, not write null ===");
    {
      const err = await expectThrow(() =>
        actions.confirmChainSubstitution(GAME_ID, {
          incomingPlayerId: JORDAN,
          entryPosition: "P",
          outgoingPlayerId: null,
          positionMoves: [{ playerId: OWEN, position: "C" }],
          reason: "defensive",
          inning: 4,
          inningHalf: "top",
          chainNote: "test -- should never land",
        })
      );
      check("throws instead of silently writing a null batting order", err !== null);
      check("throws the exact shared no-batting-order error", err === NO_BATTING_ORDER_ERROR);

      const jordan = await lineupRow(admin, JORDAN);
      check("Jordan's row is untouched (nothing partially written)", jordan.status === "reserve" && jordan.position === null && jordan.batting_order === null);
      const owen = await lineupRow(admin, OWEN);
      check("Owen's row is untouched too -- the whole call is a no-op on throw", owen.position === "P" && owen.batting_order === originalOwen.batting_order);
    }

    console.log("\n=== Case 2: the same chain, now WITH the confirm panel's picker assignment (Jordan -> slot) ===");
    {
      const err = await expectThrow(() =>
        actions.confirmChainSubstitution(GAME_ID, {
          incomingPlayerId: JORDAN,
          entryPosition: "P",
          outgoingPlayerId: null,
          positionMoves: [{ playerId: OWEN, position: "C" }],
          reason: "defensive",
          inning: 4,
          inningHalf: "top",
          chainNote: "Jordan Ellis -> P position. Owen Delgado -> C. Jordan Ellis -> batting slot " + marcusSlot + ".",
          battingOrderAssignments: [{ playerId: JORDAN, battingOrder: marcusSlot }],
        })
      );
      check("confirmChainSubstitution does not throw", err === null);

      const jordan = await lineupRow(admin, JORDAN);
      check(
        `Jordan is now starting at P with a REAL batting order (slot ${marcusSlot}), never null`,
        jordan.status === "starting" && jordan.position === "P" && jordan.batting_order === marcusSlot
      );

      const owen = await lineupRow(admin, OWEN);
      check("Owen moved to C, keeping his own original batting slot (a position move, not a sub)", owen.status === "starting" && owen.position === "C" && owen.batting_order === originalOwen.batting_order);

      // No outgoing player in this chain -> no substitutions row, per the
      // modal's own documented "nobody goes to the bench" terminal case.
      const { data: subs } = await admin.from("substitutions").select("id").eq("game_id", GAME_ID).eq("player_in_id", JORDAN);
      check("no substitutions row was written (no outgoing player)", (subs ?? []).length === 0);

      const lineupAfter = await admin.from("lineup").select("status, batting_order").eq("game_id", GAME_ID);
      const vacantAfter = computeVacantBattingSlots(lineupAfter.data ?? []);
      check("no batting slot is vacant any more", vacantAfter.length === 0);
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
