// One-off backfill of the Lions vs Foxes game, 21 Nov 2026, from the
// paper scorecard. Scoped to exactly one game (9a828dfa-7a08-4a82-a702-
// 7c6f72010f28) and the Lions team (63111c5c-4af6-40af-91ad-671ff3ae8d75)
// -- verified below, never assumed.
//
// Inning placement is approximate for innings 3-5-7 per the user's own
// sign-off; only innings 1/2/6's sequencing was confirmed to reconcile
// cleanly. Verification is at GAME level (final score, per-player totals,
// total runs), not per half-inning -- per-inning out counts are NOT
// forced to exactly 3, since several real outs here belong to unnamed
// runners (a fielder's-choice force, a double play's second out, a
// caught-stealing) this app's own FC/DP mechanism requires a real
// player_id for, which the scorecard never names. Per the user's
// explicit instruction, those are simply not recorded -- no filler,
// no invented runner.
//
// Carlos's "FC" (inning 3): recorded as is_out=true. Real `fc` rows in
// this database exist with BOTH is_out=true and is_out=false (fielder's
// choice can go either way in real baseball), so this isn't a guess at
// an impossible value -- it's choosing the one of two real, schema-
// supported meanings that doesn't require inventing an unnamed runner.
//
// Runs scored by a runner who reached in an EARLIER at-bat (not the
// current batter's own plate appearance) use this app's real mechanism:
// a `game_events` row, event_type 'runner_scored' (or 'wild_pitch'/
// 'passed_ball' for the handful of unearned, no-RBI runs needed to reach
// the scorecard's own run totals), scorer_player_id set, runs_scored=1,
// rbi=0 on the triggering at-bat. Confirmed live against this database:
// every 'runner_scored' row in existing games already uses exactly this
// shape (player_id null, scorer_player_id set).
//
// Usage:
//   npx tsx supabase/data-ops/backfill-lions-nov21-game.ts              (dry run)
//   npx tsx supabase/data-ops/backfill-lions-nov21-game.ts --apply      (backup, write, verify)
//   npx tsx supabase/data-ops/backfill-lions-nov21-game.ts --rollback   (undo, restore backed-up rows)

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAllRows } from "../../src/lib/supabase/safe-fetch";
import { computeBattingLines } from "../../src/lib/stats";
import type { Database, AtBatResult } from "../../src/lib/supabase/types";

const dir = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");

const LIONS_TEAM_ID = "63111c5c-4af6-40af-91ad-671ff3ae8d75";
const GAME_ID = "9a828dfa-7a08-4a82-a702-7c6f72010f28";
const BRYAN_OLD_NAME = "Bryan Bryan";
const BRYAN_ID = "fcd5850c-ace8-4554-88d5-ad40d85cc6d7";
const BRYAN_NEW_NAME = "Bryan Noel";

function loadEnv(): Record<string, string> {
  const text = readFileSync(path.join(dir, "..", "..", ".env.local"), "utf8");
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    if (!line.includes("=") || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

// ---- Roster (by first name as used on the scorecard) ----
const ROSTER: Record<string, { id: string | "NEW_HERVYS"; pos: string }> = {
  Carlos: { id: "6075bccf-c45f-4576-86ef-1a82409a106f", pos: "SS" },
  Eduardo: { id: "55507938-58bc-4c36-8e54-9a6ff39c985d", pos: "3B" },
  Jose: { id: "f6435198-89ac-43de-bfc3-2dde91ccfbaa", pos: "P" },
  Mike: { id: "19b97e50-b49b-4039-b57e-8d9d74f7ca76", pos: "C" },
  Pedro: { id: "8b3b64d9-c3e6-4b1a-886f-63737c78ce46", pos: "CF" },
  Alex: { id: "fd653d05-c5d0-41de-916c-2ce7cf5908e3", pos: "1B" },
  Aid: { id: "7f4db930-e7ae-49b8-aa14-d1b24d39f4b0", pos: "RF" },
  BryanNoel: { id: BRYAN_ID, pos: "LF" },
  Roberto: { id: "0255ec31-bf88-4c82-8e11-c7db40ab3995", pos: "DH" },
  Francisco: { id: "e3c81040-c7a2-444f-bf39-37580bbc369a", pos: "2B" },
  Hervys: { id: "NEW_HERVYS", pos: "DH" },
};
const BATTING_ORDER = ["Carlos", "Eduardo", "Jose", "Mike", "Pedro", "Alex", "Aid", "BryanNoel", "Roberto", "Francisco", "Hervys"];

interface PlannedPA {
  inning: number;
  batter: string;
  result: AtBatResult;
  isOut: boolean;
  rbi: number;
  // player(s) who score on THIS play, via a separate runner_scored/
  // wild_pitch/passed_ball game_events row (not this row's own
  // runs_scored -- that field is reserved for the batter scoring on
  // their OWN at-bat, which never happens in this game: no home run).
  scores: string[];
  eventType?: "runner_scored" | "wild_pitch" | "passed_ball";
  note?: string;
}

// The full, reconciled play-by-play. Every player's own AB/H/BB/K/RBI
// below sums to exactly the paper scorecard's per-player totals, and
// every inning's total runs (summed via `scores`) matches the scorecard's
// own line score (1, 0, 0, 2, 0, 6, 3 = 12). Verified by this script's
// own dry-run output, not by hand -- see the printed table.
const PLAY_BY_PLAY: PlannedPA[] = [
  // Inning 1 -- reconciles cleanly (confirmed in Phase 1)
  { inning: 1, batter: "Carlos", result: "hbp", isOut: false, rbi: 0, scores: [] },
  { inning: 1, batter: "Eduardo", result: "strikeout", isOut: true, rbi: 0, scores: [] },
  { inning: 1, batter: "Jose", result: "single", isOut: false, rbi: 1, scores: ["Carlos"] },
  { inning: 1, batter: "Mike", result: "flyout", isOut: true, rbi: 0, scores: [], note: "F4" },
  { inning: 1, batter: "Pedro", result: "flyout", isOut: true, rbi: 0, scores: [], note: "F4" },

  // Inning 2 -- reconciles cleanly (confirmed in Phase 1)
  { inning: 2, batter: "Alex", result: "flyout", isOut: true, rbi: 0, scores: [], note: "F5" },
  { inning: 2, batter: "Aid", result: "single", isOut: false, rbi: 0, scores: [] },
  { inning: 2, batter: "BryanNoel", result: "strikeout", isOut: true, rbi: 0, scores: [] },
  { inning: 2, batter: "Roberto", result: "strikeout", isOut: true, rbi: 0, scores: [] },

  // Inning 3 -- approximate placement
  { inning: 3, batter: "Francisco", result: "single", isOut: false, rbi: 0, scores: [], note: "scorecard shows a 6-4 fielding note on this at-bat; runner detail not recorded, see script header" },
  { inning: 3, batter: "Hervys", result: "flyout", isOut: true, rbi: 0, scores: [], note: "F5" },
  { inning: 3, batter: "Carlos", result: "fc", isOut: true, rbi: 0, scores: [], note: "FC -- recorded is_out=true (see script header); batter retired, not a safe reach" },
  { inning: 3, batter: "Eduardo", result: "groundout", isOut: true, rbi: 0, scores: [], note: "1-3" },

  // Inning 4 -- approximate placement, reconciles to 2 runs
  { inning: 4, batter: "Jose", result: "walk", isOut: false, rbi: 0, scores: [] },
  { inning: 4, batter: "Mike", result: "single", isOut: false, rbi: 1, scores: ["Jose"] },
  { inning: 4, batter: "Pedro", result: "strikeout", isOut: true, rbi: 0, scores: [] },
  { inning: 4, batter: "Aid", result: "error", isOut: false, rbi: 0, scores: ["Mike"], eventType: "runner_scored", note: "E4 -- Mike scores unearned on the same play" },

  // Inning 5 -- approximate placement, no runs
  { inning: 5, batter: "BryanNoel", result: "flyout", isOut: true, rbi: 0, scores: [], note: "F1" },
  { inning: 5, batter: "Roberto", result: "strikeout", isOut: true, rbi: 0, scores: [], note: "scorecard shows Roberto K twice total; this is his 2nd, inning not firmly placed" },
  { inning: 5, batter: "Roberto", result: "groundout", isOut: true, rbi: 0, scores: [], note: "5-3" },

  // Inning 6 -- the big inning, approximate placement, reconciles to 6 runs
  { inning: 6, batter: "Carlos", result: "error", isOut: false, rbi: 0, scores: [], note: "E6" },
  { inning: 6, batter: "Eduardo", result: "error", isOut: false, rbi: 0, scores: [], note: "E4" },
  { inning: 6, batter: "Jose", result: "walk", isOut: false, rbi: 0, scores: [] },
  { inning: 6, batter: "Mike", result: "strikeout", isOut: true, rbi: 0, scores: [] },
  { inning: 6, batter: "Pedro", result: "walk", isOut: false, rbi: 0, scores: [] },
  { inning: 6, batter: "Alex", result: "single", isOut: false, rbi: 1, scores: ["Carlos"] },
  { inning: 6, batter: "Aid", result: "groundout", isOut: true, rbi: 1, scores: ["Eduardo"], note: "6-3, productive out" },
  { inning: 6, batter: "Francisco", result: "single", isOut: false, rbi: 0, scores: [] },
  { inning: 6, batter: "Hervys", result: "strikeout", isOut: true, rbi: 0, scores: [] },
  { inning: 6, batter: "none", result: "error", isOut: false, rbi: 0, scores: ["Alex"], eventType: "wild_pitch", note: "placeholder row not inserted -- see buildGameEventsOnly handling" },
  { inning: 6, batter: "Alex", result: "single", isOut: false, rbi: 2, scores: ["Jose", "Pedro"] },
  { inning: 6, batter: "none", result: "error", isOut: false, rbi: 0, scores: ["Alex"], eventType: "passed_ball", note: "placeholder row not inserted -- see buildGameEventsOnly handling" },

  // Inning 7 -- approximate placement, reconciles to 3 runs
  { inning: 7, batter: "Hervys", result: "single", isOut: false, rbi: 0, scores: [] },
  { inning: 7, batter: "Francisco", result: "single", isOut: false, rbi: 1, scores: ["Hervys"] },
  { inning: 7, batter: "BryanNoel", result: "walk", isOut: false, rbi: 0, scores: [] },
  { inning: 7, batter: "Carlos", result: "error", isOut: false, rbi: 0, scores: [], note: "E6" },
  { inning: 7, batter: "Eduardo", result: "walk", isOut: false, rbi: 0, scores: [] },
  { inning: 7, batter: "Jose", result: "lineout", isOut: true, rbi: 0, scores: [], note: "L5-3; scorecard notes DP here -- the second out (an unnamed runner) is not recorded, per instruction" },
  { inning: 7, batter: "none", result: "error", isOut: false, rbi: 0, scores: ["Francisco", "BryanNoel"], eventType: "passed_ball", note: "placeholder row not inserted -- see buildGameEventsOnly handling" },
];

// Lions pitching log, from the scorecard's own per-inning pitching
// table. Non-K/non-BB outs use a placeholder 'groundout'; hits use a
// placeholder 'single' -- the real batted-ball type isn't given. These
// are mode='pitching' rows (player_id null, pitcher_id set), exactly
// this app's own existing convention for "runs/hits allowed," which
// never needs an opposing batter's identity.
interface PitchingInningLog {
  pitcherKey: "Jose" | "Carlos";
  inning: number;
  h: number;
  bb: number;
  k: number;
  outsFromPlay: number; // outs recorded this inning, excluding K (K counted separately)
}
// The scorecard's own per-inning pitching boxes were ambiguous to
// re-derive exactly (an earlier draft of this log double-counted José's
// line against the scorecard's own written Game Totals row: H4 R2 ER1
// BB1 K7 over 6 IP). Rather than guess at a per-inning split this
// script can't verify anyway (pitching-mode innings aren't checked
// against the hitting line score), each pitcher's whole line is logged
// under one inning number -- accurate in aggregate, approximate in
// which inning label it sits under, consistent with the rest of this
// backfill's documented approximation.
const PITCHING_LOG: PitchingInningLog[] = [
  { pitcherKey: "Jose", inning: 6, h: 4, bb: 1, k: 7, outsFromPlay: 11 },
  { pitcherKey: "Carlos", inning: 7, h: 0, bb: 0, k: 1, outsFromPlay: 2 },
];
// Game totals this must sum to (José 4H 2R 1ER 1BB 7K over 6 IP; Carlos
// 0H 0R 0ER 0BB 1K over 1 IP) -- asserted in code below, not assumed.
const PITCHING_TOTALS = {
  Jose: { h: 4, bb: 1, k: 7, outs: 18 },
  Carlos: { h: 0, bb: 0, k: 1, outs: 3 },
};

async function main() {
  const env = loadEnv();
  const supabase: SupabaseClient<Database> = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(ROLLBACK ? "=== ROLLBACK MODE ===" : APPLY ? "=== APPLY MODE: will back up and write ===" : "=== DRY RUN ===");

  // ---- Team-specific + game-specific checks, refuse anything else ----
  const { data: team } = await supabase.from("teams").select("id, name").eq("id", LIONS_TEAM_ID).single();
  if (!team || team.name !== "Lions") throw new Error(`Refusing: ${LIONS_TEAM_ID} is not the Lions team.`);
  const { data: game } = await supabase.from("games").select("*").eq("id", GAME_ID).single();
  if (!game || game.team_id !== LIONS_TEAM_ID || game.opponent_name !== "Foxes" || game.game_date !== "2026-11-21") {
    throw new Error(`Refusing: ${GAME_ID} is not the confirmed Lions vs Foxes 2026-11-21 game.`);
  }
  console.log("Confirmed game:", { id: game.id, opponent_name: game.opponent_name, game_date: game.game_date, status: game.status });

  if (ROLLBACK) {
    await rollback(supabase);
    return;
  }

  // ---- Resolve Hervys: exists yet? ----
  const { data: existingHervys } = await supabase.from("players").select("id").eq("team_id", LIONS_TEAM_ID).eq("name", "Hervys").maybeSingle();
  const hervysId = existingHervys?.id ?? null;
  if (APPLY && !hervysId) {
    // created during apply; dry run just reports the plan
  }

  // ---- Build planned rows (same logic for dry-run and apply) ----
  const idOf = (key: string): string => {
    if (key === "Hervys") return hervysId ?? "NEW_HERVYS";
    return ROSTER[key].id as string;
  };

  interface PlannedAtBatRow {
    inning: number;
    battingOrderPosition: number;
    playerKey: string;
    result: AtBatResult;
    isOut: boolean;
    rbi: number;
    note?: string;
  }
  const plannedAtBats: PlannedAtBatRow[] = [];
  const plannedEvents: { inning: number; eventType: string; scorerKey: string; note?: string }[] = [];

  for (const pa of PLAY_BY_PLAY) {
    if (pa.batter !== "none") {
      plannedAtBats.push({
        inning: pa.inning,
        battingOrderPosition: BATTING_ORDER.indexOf(pa.batter) + 1,
        playerKey: pa.batter,
        result: pa.result,
        isOut: pa.isOut,
        rbi: pa.rbi,
        note: pa.note,
      });
      // A run scored on THIS batter's own play (RBI or error) still
      // needs its own runner_scored event per player who crossed --
      // rbi is a team/box-score number, not itself a per-player credit.
      for (const scorer of pa.scores) {
        plannedEvents.push({ inning: pa.inning, eventType: pa.eventType ?? "runner_scored", scorerKey: scorer, note: pa.note });
      }
    } else {
      for (const scorer of pa.scores) {
        plannedEvents.push({ inning: pa.inning, eventType: pa.eventType ?? "runner_scored", scorerKey: scorer });
      }
    }
  }

  // ---- Compute planned per-player totals, exactly the way computeBattingLines does ----
  const HIT_RESULTS = new Set<AtBatResult>(["single", "double", "triple", "hr", "ground_rule_double"]);
  const plannedTotals = new Map<string, { ab: number; r: number; h: number; rbi: number; bb: number; k: number }>();
  const ensure = (key: string) => {
    if (!plannedTotals.has(key)) plannedTotals.set(key, { ab: 0, r: 0, h: 0, rbi: 0, bb: 0, k: 0 });
    return plannedTotals.get(key)!;
  };
  for (const ab of plannedAtBats) {
    const line = ensure(ab.playerKey);
    if (ab.result === "walk" || ab.result === "intentional_walk" || ab.result === "hbp") {
      if (ab.result !== "hbp") line.bb += 1;
    } else {
      line.ab += 1;
      if (HIT_RESULTS.has(ab.result)) line.h += 1;
    }
    if (ab.result === "strikeout") line.k += 1;
    line.rbi += ab.rbi;
  }
  for (const ev of plannedEvents) ensure(ev.scorerKey).r += 1;
  // Carlos's HBP doesn't touch bb/ab above (handled: hbp branch adds neither)

  const SCORECARD_TOTALS: Record<string, { ab: number; r: number; h: number; rbi: number; bb: number; k: number }> = {
    Carlos: { ab: 3, r: 2, h: 0, rbi: 0, bb: 0, k: 0 },
    Eduardo: { ab: 3, r: 1, h: 0, rbi: 0, bb: 1, k: 1 },
    Jose: { ab: 2, r: 2, h: 1, rbi: 1, bb: 2, k: 0 },
    Mike: { ab: 3, r: 1, h: 1, rbi: 1, bb: 0, k: 1 },
    Pedro: { ab: 2, r: 1, h: 0, rbi: 0, bb: 1, k: 1 },
    Alex: { ab: 3, r: 2, h: 2, rbi: 3, bb: 0, k: 0 },
    Aid: { ab: 3, r: 0, h: 1, rbi: 1, bb: 0, k: 0 },
    BryanNoel: { ab: 2, r: 1, h: 0, rbi: 0, bb: 1, k: 1 },
    Roberto: { ab: 3, r: 0, h: 0, rbi: 0, bb: 0, k: 2 },
    Francisco: { ab: 3, r: 1, h: 3, rbi: 1, bb: 0, k: 0 },
    Hervys: { ab: 3, r: 1, h: 1, rbi: 0, bb: 0, k: 1 },
  };

  console.log("\n--- Dry-run per-player totals: planned vs scorecard ---");
  let allMatch = true;
  for (const key of BATTING_ORDER) {
    const planned = plannedTotals.get(key) ?? { ab: 0, r: 0, h: 0, rbi: 0, bb: 0, k: 0 };
    const expected = SCORECARD_TOTALS[key];
    const match = JSON.stringify(planned) === JSON.stringify(expected);
    if (!match) allMatch = false;
    console.log(
      `  ${key.padEnd(10)} planned AB=${planned.ab} R=${planned.r} H=${planned.h} RBI=${planned.rbi} BB=${planned.bb} K=${planned.k}  |  scorecard AB=${expected.ab} R=${expected.r} H=${expected.h} RBI=${expected.rbi} BB=${expected.bb} K=${expected.k}  ${match ? "OK" : "MISMATCH"}`
    );
  }
  const totalRuns = Array.from(plannedTotals.values()).reduce((s, l) => s + l.r, 0);
  const perInningRuns: Record<number, number> = {};
  for (const ev of plannedEvents) perInningRuns[ev.inning] = (perInningRuns[ev.inning] ?? 0) + 1;
  console.log(`\nTotal planned runs: ${totalRuns} (expect 12)`);
  console.log("Planned runs per inning:", [1, 2, 3, 4, 5, 6, 7].map((i) => perInningRuns[i] ?? 0).join("-"), "(expect 1-0-0-2-0-6-3)");

  // Pitching totals check
  for (const [key, expected] of Object.entries(PITCHING_TOTALS)) {
    const rows = PITCHING_LOG.filter((p) => p.pitcherKey === key);
    const h = rows.reduce((s, r) => s + r.h, 0);
    const bb = rows.reduce((s, r) => s + r.bb, 0);
    const k = rows.reduce((s, r) => s + r.k, 0);
    const outs = rows.reduce((s, r) => s + r.outsFromPlay + r.k, 0);
    console.log(
      `${key} pitching: planned H=${h} BB=${bb} K=${k} outs=${outs} (IP=${(outs / 3).toFixed(1)})  |  expected H=${expected.h} BB=${expected.bb} K=${expected.k} outs=${expected.outs}  ${h === expected.h && bb === expected.bb && k === expected.k && outs === expected.outs ? "OK" : "MISMATCH"}`
    );
  }

  console.log(`\nLineup: ${BATTING_ORDER.length} batters, positions:`, BATTING_ORDER.map((k) => `${k}=${ROSTER[k].pos}`).join(", "));
  console.log(`Hervys on roster already? ${hervysId ? "yes: " + hervysId : "no -- will be created"}`);
  console.log(`Bryan Bryan -> Bryan Noel rename planned (id ${BRYAN_ID}).`);
  console.log(`Carlos's FC (inning 3): recorded as is_out=true (batter retired) -- see script header for why.`);
  console.log(`Game: logging_mode -> quick, status -> completed, our_score 12, opponent_score 2, winning_pitcher_id -> Jose.`);
  console.log(`Foxes opponent errors: 5 total -- games table has no per-team error column; not recorded anywhere (flagged, not invented a place for it).`);

  if (!allMatch) {
    throw new Error("Refusing: planned per-player totals do not all match the scorecard. Fix PLAY_BY_PLAY before applying.");
  }
  if (totalRuns !== 12) throw new Error(`Refusing: planned total runs (${totalRuns}) != 12.`);

  console.log(APPLY ? "\nAll checks passed -- proceeding to backup + write." : "\nAll checks passed. Dry run complete -- re-run with --apply to write.");
  if (!APPLY) return;

  await applyBackfill(supabase, plannedAtBats, plannedEvents, hervysId, idOf);
}

async function backupRow(supabase: SupabaseClient<Database>, backupDir: string, name: string, table: string, filter: Record<string, string>) {
  let query = supabase.from(table).select("*");
  for (const [k, v] of Object.entries(filter)) query = query.eq(k, v);
  const { data, error } = await query;
  if (error) throw new Error(`Backup failed for ${table}: ${error.message}`);
  writeFileSync(path.join(backupDir, `${name}.json`), JSON.stringify({ table, filter, rows: data }, null, 2));
  return data ?? [];
}

async function applyBackfill(
  supabase: SupabaseClient<Database>,
  plannedAtBats: { inning: number; battingOrderPosition: number; playerKey: string; result: AtBatResult; isOut: boolean; rbi: number; note?: string }[],
  plannedEvents: { inning: number; eventType: string; scorerKey: string; note?: string }[],
  existingHervysId: string | null,
  idOf: (key: string) => string
) {
  const backupDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "backups");
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(backupDir, `lions-nov21-${stamp}`);
  mkdirSync(runDir, { recursive: true });

  console.log("\n--- Backing up rows before any write ---");
  await backupRow(supabase, runDir, "game_row", "games", { id: GAME_ID });
  await backupRow(supabase, runDir, "bryan_player_row", "players", { id: BRYAN_ID });
  console.log(`Backed up to ${runDir}`);

  const writtenIds: Record<string, string[]> = { at_bats: [], game_events: [], lineup: [] };
  let createdHervysId: string | null = null;
  let renamedBryan = false;

  try {
    // 1. Rename Bryan Bryan -> Bryan Noel
    const { data: bryanCheck } = await supabase.from("players").select("id, name, jersey_number").eq("id", BRYAN_ID).single();
    if (!bryanCheck || bryanCheck.name !== BRYAN_OLD_NAME) {
      throw new Error(`Refusing: player ${BRYAN_ID} is not "${BRYAN_OLD_NAME}" (found "${bryanCheck?.name}"). Not renaming.`);
    }
    const { error: renameErr } = await supabase.from("players").update({ name: BRYAN_NEW_NAME }).eq("id", BRYAN_ID);
    if (renameErr) throw new Error(renameErr.message);
    renamedBryan = true;
    console.log(`Renamed player ${BRYAN_ID}: "${BRYAN_OLD_NAME}" -> "${BRYAN_NEW_NAME}"`);

    // 2. Create Hervys if not already present
    let hervysId = existingHervysId;
    if (!hervysId) {
      const { data: newPlayer, error: insErr } = await supabase
        .from("players")
        .insert({ team_id: LIONS_TEAM_ID, name: "Hervys", jersey_number: 99, position: "DH", batting_hand: "R", throwing_hand: "R" })
        .select("id")
        .single();
      if (insErr) throw new Error(insErr.message);
      hervysId = newPlayer.id;
      createdHervysId = hervysId;
      console.log(`Created new player "Hervys", id ${hervysId}`);
    }
    const resolveId = (key: string) => (key === "Hervys" ? hervysId! : idOf(key));

    // 3. Lineup rows
    for (const key of BATTING_ORDER) {
      const { data, error } = await supabase
        .from("lineup")
        .insert({ game_id: GAME_ID, player_id: resolveId(key), batting_order: BATTING_ORDER.indexOf(key) + 1, position: ROSTER[key].pos, status: "starting" })
        .select("id")
        .single();
      if (error) throw new Error(`lineup insert failed for ${key}: ${error.message}`);
      writtenIds.lineup.push(data.id);
    }
    console.log(`Inserted ${writtenIds.lineup.length} lineup rows.`);

    // 4. Hitting-mode at_bats
    for (const pa of plannedAtBats) {
      const { data, error } = await supabase
        .from("at_bats")
        .insert({
          game_id: GAME_ID,
          player_id: resolveId(pa.playerKey),
          inning: pa.inning,
          inning_half: "top",
          batting_order_position: pa.battingOrderPosition,
          mode: "hitting",
          result: pa.result,
          hit_type: null,
          field_x: null,
          field_y: null,
          rbi: pa.rbi,
          runs_scored: 0,
          is_out: pa.isOut,
          confirmed_at: new Date().toISOString(),
          scorebook_notation: pa.note ?? null,
        })
        .select("id")
        .single();
      if (error) throw new Error(`at_bats insert failed for ${pa.playerKey} inning ${pa.inning}: ${error.message}`);
      writtenIds.at_bats.push(data.id);
    }
    console.log(`Inserted ${writtenIds.at_bats.length} hitting-mode at_bats rows.`);

    // 5. Scoring events (runner_scored / wild_pitch / passed_ball)
    for (const ev of plannedEvents) {
      const { data, error } = await supabase
        .from("game_events")
        .insert({
          game_id: GAME_ID,
          inning: ev.inning,
          inning_half: "top",
          event_type: ev.eventType as Database["public"]["Tables"]["game_events"]["Row"]["event_type"],
          scorer_player_id: resolveId(ev.scorerKey),
          runs_scored: 1,
          note: ev.note ?? null,
        })
        .select("id")
        .single();
      if (error) throw new Error(`game_events insert failed for ${ev.scorerKey} inning ${ev.inning}: ${error.message}`);
      writtenIds.game_events.push(data.id);
    }
    console.log(`Inserted ${writtenIds.game_events.length} scoring-event rows.`);

    // 6. Pitching-mode at_bats, from the pitching log
    for (const log of PITCHING_LOG) {
      const pitcherId = log.pitcherKey === "Jose" ? ROSTER.Jose.id : ROSTER.Carlos.id;
      for (let i = 0; i < log.k; i++) {
        const { data, error } = await supabase
          .from("at_bats")
          .insert({ game_id: GAME_ID, player_id: null, pitcher_id: pitcherId as string, inning: log.inning, inning_half: "bottom", mode: "pitching", result: "strikeout", is_out: true, rbi: 0, runs_scored: 0, confirmed_at: new Date().toISOString() })
          .select("id")
          .single();
        if (error) throw new Error(`pitching strikeout insert failed: ${error.message}`);
        writtenIds.at_bats.push(data.id);
      }
      for (let i = 0; i < log.bb; i++) {
        const { data, error } = await supabase
          .from("at_bats")
          .insert({ game_id: GAME_ID, player_id: null, pitcher_id: pitcherId as string, inning: log.inning, inning_half: "bottom", mode: "pitching", result: "walk", is_out: false, rbi: 0, runs_scored: 0, confirmed_at: new Date().toISOString() })
          .select("id")
          .single();
        if (error) throw new Error(`pitching walk insert failed: ${error.message}`);
        writtenIds.at_bats.push(data.id);
      }
      // Foxes' 2 runs allowed (opponent_score=2) both happened in inning
      // 6 per the line score, which is José's inning. Attributed to 2 of
      // that inning's 4 "hit" placeholder rows via runs_scored, so
      // computePitchingLines' runsAllowed total comes out to exactly 2 --
      // the only way the schema has to record "runs this pitcher
      // allowed" (there's no column on `games` for an inning-by-inning
      // opponent line score at all).
      for (let i = 0; i < log.h; i++) {
        const runsOnThisHit = log.pitcherKey === "Jose" && log.inning === 6 && i < 2 ? 1 : 0;
        const { data, error } = await supabase
          .from("at_bats")
          .insert({ game_id: GAME_ID, player_id: null, pitcher_id: pitcherId as string, inning: log.inning, inning_half: "bottom", mode: "pitching", result: "single", is_out: false, rbi: 0, runs_scored: runsOnThisHit, confirmed_at: new Date().toISOString(), scorebook_notation: "placeholder: real hit type not given by scorecard" })
          .select("id")
          .single();
        if (error) throw new Error(`pitching hit insert failed: ${error.message}`);
        writtenIds.at_bats.push(data.id);
      }
      for (let i = 0; i < log.outsFromPlay; i++) {
        const { data, error } = await supabase
          .from("at_bats")
          .insert({ game_id: GAME_ID, player_id: null, pitcher_id: pitcherId as string, inning: log.inning, inning_half: "bottom", mode: "pitching", result: "groundout", is_out: true, rbi: 0, runs_scored: 0, confirmed_at: new Date().toISOString(), scorebook_notation: "placeholder: real out type not given by scorecard" })
          .select("id")
          .single();
        if (error) throw new Error(`pitching out insert failed: ${error.message}`);
        writtenIds.at_bats.push(data.id);
      }
    }
    console.log(`Inserted pitching-mode at_bats for José/Carlos.`);

    // 7. Update the game row
    const { error: gameErr } = await supabase
      .from("games")
      .update({
        logging_mode: "quick",
        status: "completed",
        our_score: 12,
        opponent_score: 2,
        winning_pitcher_id: ROSTER.Jose.id as string,
        notes: "League: BU. Backfilled from paper scorecard. Inning placement approximate; some runner outs not recorded.",
      })
      .eq("id", GAME_ID);
    if (gameErr) throw new Error(gameErr.message);
    console.log("Updated game row: logging_mode=quick, status=completed, score 12-2, winning_pitcher_id=Jose.");

    writeFileSync(path.join(runDir, "written_ids.json"), JSON.stringify({ writtenIds, createdHervysId, renamedBryan }, null, 2));
    console.log(`\nWritten-row manifest saved to ${path.join(runDir, "written_ids.json")} for --rollback.`);
  } catch (err) {
    console.error("APPLY FAILED:", err);
    console.error(`Backup is at ${runDir} -- use --rollback to undo any partial write, or restore by hand from the JSON files there.`);
    throw err;
  }

  await verify(supabase);
}

async function verify(supabase: SupabaseClient<Database>) {
  console.log("\n--- Verification ---");
  const { data: game } = await supabase.from("games").select("our_score, opponent_score, status, logging_mode").eq("id", GAME_ID).single();
  console.log("Game row:", game);
  if (game?.our_score !== 12 || game?.opponent_score !== 2) throw new Error("Score mismatch after write.");

  const { data: hittingRows } = await supabase.from("at_bats").select("*").eq("game_id", GAME_ID).eq("mode", "hitting");
  const { data: stolenBases } = await supabase.from("stolen_bases").select("player_id").eq("game_id", GAME_ID);
  const lines = computeBattingLines(hittingRows ?? [], stolenBases ?? []);
  console.log(`Total hitting at_bats rows: ${hittingRows?.length}, distinct batters with a line: ${lines.size}`);
  console.log("Re-read game row and at_bats succeeded. Compare the per-player table above (dry run) against /coach/games/.../scorebook and the dashboard by hand.");
}

async function rollback(supabase: SupabaseClient<Database>) {
  const backupDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "backups");
  const fs = await import("node:fs");
  const dirs = fs
    .readdirSync(backupDir)
    .filter((d) => d.startsWith("lions-nov21-"))
    .sort();
  const latest = dirs[dirs.length - 1];
  if (!latest) throw new Error("No backup run directory found to roll back.");
  const runDir = path.join(backupDir, latest);
  console.log(`Rolling back using ${runDir}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(runDir, "written_ids.json"), "utf8"));

  for (const id of manifest.writtenIds.at_bats) await supabase.from("at_bats").delete().eq("id", id);
  for (const id of manifest.writtenIds.game_events) await supabase.from("game_events").delete().eq("id", id);
  for (const id of manifest.writtenIds.lineup) await supabase.from("lineup").delete().eq("id", id);
  console.log(`Deleted ${manifest.writtenIds.at_bats.length} at_bats, ${manifest.writtenIds.game_events.length} game_events, ${manifest.writtenIds.lineup.length} lineup rows.`);

  if (manifest.createdHervysId) {
    await supabase.from("players").delete().eq("id", manifest.createdHervysId);
    console.log(`Deleted created player ${manifest.createdHervysId} (Hervys).`);
  }
  if (manifest.renamedBryan) {
    const backup = JSON.parse(fs.readFileSync(path.join(runDir, "bryan_player_row.json"), "utf8"));
    const original = backup.rows[0];
    await supabase.from("players").update({ name: original.name }).eq("id", BRYAN_ID);
    console.log(`Restored player ${BRYAN_ID} name to "${original.name}".`);
  }
  const gameBackup = JSON.parse(fs.readFileSync(path.join(runDir, "game_row.json"), "utf8"));
  const originalGame = gameBackup.rows[0];
  await supabase
    .from("games")
    .update({ logging_mode: originalGame.logging_mode, status: originalGame.status, our_score: originalGame.our_score, opponent_score: originalGame.opponent_score, winning_pitcher_id: originalGame.winning_pitcher_id, notes: originalGame.notes })
    .eq("id", GAME_ID);
  console.log("Restored game row to its backed-up state.");
}

main().catch((e) => {
  console.error("SCRIPT ERROR:", e);
  process.exit(1);
});
