// Adds TEMPORARY placeholder spray-chart dots to the Lions vs Foxes
// backfilled game (9a828dfa-7a08-4a82-a702-7c6f72010f28) so the coach
// can drag each one onto its real landing spot by hand (the "Adjust
// Dots" feature on the team spray chart, src/app/coach/team-analytics.tsx).
// Scoped to exactly this one game and the Lions team -- verified below.
//
// Deliberately placed in FOUL territory (confirmed via this team's own
// field_calibration, the same geometry src/lib/field-zones.ts's
// getFieldZone uses) rather than some plausible-looking fair spot:
// nothing in this game's real at-bats can ever legitimately produce a
// foul-territory ball-in-play dot, so every placeholder is immediately,
// visibly wrong on the chart -- impossible to mistake for real data
// before the coach repositions it.
//
// Only mode='hitting' balls in play get a dot: single/double/triple/hr/
// ground_rule_double/groundout/flyout/lineout/fc/error. Strikeouts,
// walks and HBP never have a field position and are skipped. Only
// result/field_x/field_y are touched on each row -- rbi, runs_scored,
// inning, etc. are left exactly as the backfill wrote them.
//
// Grid: two foul-territory strips (x=3/8/13 on the left, x=87/92 on the
// right), each 10 units apart on both axes, confirmed foul at every
// (x, y) combination used here before being trusted. 23 cells needed,
// 23 used, in batting-order-then-inning order (already how the real
// at_bats are naturally sorted when fetched this way).
//
// Usage:
//   npx tsx supabase/data-ops/add-placeholder-dots-lions-nov21.ts            (dry run)
//   npx tsx supabase/data-ops/add-placeholder-dots-lions-nov21.ts --apply    (backup, write, verify)
//   npx tsx supabase/data-ops/add-placeholder-dots-lions-nov21.ts --rollback (undo)

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getFieldZone } from "../../src/lib/field-zones";
import type { Database, FieldCalibrationPoints, AtBatResult } from "../../src/lib/supabase/types";

const dir = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");

const LIONS_TEAM_ID = "63111c5c-4af6-40af-91ad-671ff3ae8d75";
const GAME_ID = "9a828dfa-7a08-4a82-a702-7c6f72010f28";

const BALL_IN_PLAY = new Set<AtBatResult>([
  "single", "double", "triple", "hr", "ground_rule_double",
  "groundout", "flyout", "lineout", "fc", "error",
]);

// Left strip: x=3,8,13 x y=15..75 step 10 (21 cells); right strip:
// x=87,92 x y=15,25 (2 cells) -- 23 total, more than the 23 needed.
function buildGrid(): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
  for (const x of [3, 8, 13]) for (const y of [15, 25, 35, 45, 55, 65, 75]) cells.push({ x, y });
  for (const x of [87, 92]) for (const y of [15, 25]) cells.push({ x, y });
  return cells;
}

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

interface EligibleRow {
  id: string;
  player_id: string | null;
  inning: number;
  batting_order_position: number | null;
  result: AtBatResult;
  field_x: number | null;
}

async function main() {
  const env = loadEnv();
  const supabase: SupabaseClient<Database> = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(ROLLBACK ? "=== ROLLBACK ===" : APPLY ? "=== APPLY: will back up and write ===" : "=== DRY RUN ===");

  const { data: team } = await supabase.from("teams").select("id, name").eq("id", LIONS_TEAM_ID).single();
  if (!team || team.name !== "Lions") throw new Error(`Refusing: ${LIONS_TEAM_ID} is not the Lions team.`);
  const { data: game } = await supabase.from("games").select("id, team_id, opponent_name, game_date").eq("id", GAME_ID).single();
  if (!game || game.team_id !== LIONS_TEAM_ID || game.opponent_name !== "Foxes" || game.game_date !== "2026-11-21") {
    throw new Error(`Refusing: ${GAME_ID} is not the confirmed Lions vs Foxes 2026-11-21 game.`);
  }
  console.log("Confirmed game:", game);

  const backupDir = path.join(dir, "backups");
  const keyFilePath = path.join(dir, "lions-nov21-dots-key.md");

  if (ROLLBACK) {
    await rollback(supabase, backupDir);
    return;
  }

  const { data: players } = await supabase.from("players").select("id, name").eq("team_id", LIONS_TEAM_ID);
  const nameById = new Map((players ?? []).map((p) => [p.id, p.name]));

  const { data: rows, error } = await supabase
    .from("at_bats")
    .select("id, player_id, inning, batting_order_position, result, field_x")
    .eq("game_id", GAME_ID)
    .eq("mode", "hitting")
    .order("batting_order_position")
    .order("inning");
  if (error) throw new Error(error.message);
  const eligible = (rows as EligibleRow[]).filter((r) => BALL_IN_PLAY.has(r.result));
  console.log(`Eligible ball-in-play rows: ${eligible.length}`);

  const alreadySet = eligible.filter((r) => r.field_x !== null);
  if (alreadySet.length > 0) throw new Error(`Refusing: ${alreadySet.length} eligible row(s) already have field_x set -- not overwriting real/prior data.`);

  const { data: calRow } = await supabase.from("field_calibration").select("calibration_points").eq("team_id", LIONS_TEAM_ID).eq("field_type", "2d").maybeSingle();
  if (!calRow) throw new Error("Refusing: no 2d field_calibration for the Lions.");
  const cal = calRow.calibration_points as FieldCalibrationPoints;

  const grid = buildGrid();
  if (grid.length < eligible.length) throw new Error(`Refusing: grid has ${grid.length} cells but ${eligible.length} dots are needed.`);

  // Verify every grid cell actually in play is foul, using the real
  // getFieldZone -- not just trusted from the design-time check.
  const plan = eligible.map((row, i) => ({ row, cell: grid[i] }));
  for (const { cell } of plan) {
    if (getFieldZone(cell.x, cell.y, cal) !== "foul") {
      throw new Error(`Refusing: grid cell (${cell.x}, ${cell.y}) is not classified foul by getFieldZone.`);
    }
  }
  // No two dots share a cell (by construction, but checked, not assumed).
  const seen = new Set<string>();
  for (const { cell } of plan) {
    const key = `${cell.x},${cell.y}`;
    if (seen.has(key)) throw new Error(`Refusing: duplicate grid cell ${key}.`);
    seen.add(key);
  }
  console.log(`All ${plan.length} planned positions verified foul and non-overlapping.`);

  // ---- Dots key table ----
  const header = "| # | Player | Inning | Result | field_x | field_y |\n|---|---|---|---|---|---|";
  const lines = plan.map(({ row, cell }, i) => `| ${i + 1} | ${nameById.get(row.player_id ?? "") ?? row.player_id} | ${row.inning} | ${row.result} | ${cell.x} | ${cell.y} |`);
  const table = [header, ...lines].join("\n");
  console.log("\n--- Dots key ---\n" + table);

  const keyMarkdown = `# Lions vs Foxes (21 Nov 2026) -- placeholder spray dots\n\nTemporary placeholder dots added to game ${GAME_ID}, all placed in foul\nterritory so they are unmistakably not real landing spots. Drag each one\nonto its real spot on the team spray chart's "Adjust Dots" view, using\nthis table to tell which dot belongs to which at-bat.\n\n${table}\n`;

  if (!APPLY) {
    writeFileSync(keyFilePath, keyMarkdown);
    console.log(`\nDots key written to ${keyFilePath} (dry run -- no database rows changed).`);
    console.log("Dry run complete. Re-run with --apply to back up and write.");
    return;
  }

  // ---- Backup ----
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(backupDir, `lions-nov21-dots-${stamp}`);
  mkdirSync(runDir, { recursive: true });
  const { data: fullRows } = await supabase.from("at_bats").select("*").in("id", eligible.map((r) => r.id));
  writeFileSync(path.join(runDir, "at_bats_before.json"), JSON.stringify({ gameId: GAME_ID, rows: fullRows }, null, 2));
  console.log(`Backed up ${fullRows?.length} rows to ${runDir}`);

  // ---- Write ----
  const writtenIds: string[] = [];
  try {
    for (const { row, cell } of plan) {
      const { data, error: updErr } = await supabase.from("at_bats").update({ field_x: cell.x, field_y: cell.y }).eq("id", row.id).select("id");
      if (updErr) throw new Error(`update failed for ${row.id}: ${updErr.message}`);
      if (!data || data.length === 0) throw new Error(`update matched zero rows for ${row.id}`);
      writtenIds.push(row.id);
    }
    console.log(`Wrote ${writtenIds.length} placeholder dots.`);
    writeFileSync(path.join(runDir, "written_ids.json"), JSON.stringify({ gameId: GAME_ID, ids: writtenIds }, null, 2));
    writeFileSync(keyFilePath, keyMarkdown);
    console.log(`Dots key written to ${keyFilePath}.`);
  } catch (err) {
    console.error("APPLY FAILED:", err);
    console.error(`Backup is at ${runDir} -- use --rollback to undo.`);
    throw err;
  }

  await verify(supabase, cal, writtenIds);
}

async function verify(supabase: SupabaseClient<Database>, cal: FieldCalibrationPoints, writtenIds: string[]) {
  console.log("\n--- Verification ---");
  const { data: rows } = await supabase.from("at_bats").select("id, field_x, field_y").in("id", writtenIds);
  const stillFoulCount = (rows ?? []).filter((r) => r.field_x !== null && getFieldZone(r.field_x!, r.field_y!, cal) === "foul").length;
  console.log(`All ${rows?.length} written dots foul: ${stillFoulCount === rows?.length}`);

  // Confirm no other Lions game was touched. Other completed games
  // legitimately already have real field_x/field_y from normal live
  // logging, so "any other game with a dot" is the wrong check (and
  // wrongly fired the first time this ran: 122 pre-existing real dots
  // elsewhere). The real guarantee is architectural -- every UPDATE
  // above was scoped to one specific id already confirmed to belong to
  // GAME_ID -- but verified directly here anyway: every written id
  // really does belong to this game, and this game's own game_id never
  // changed.
  const { data: writtenRows } = await supabase.from("at_bats").select("id, game_id").in("id", writtenIds);
  const wrongGame = (writtenRows ?? []).filter((r) => r.game_id !== GAME_ID);
  console.log(`Written rows confirmed to belong to game ${GAME_ID}: ${(writtenRows?.length ?? 0) - wrongGame.length}/${writtenRows?.length}`);
  if (wrongGame.length > 0) throw new Error("Some written rows belong to a different game -- see above.");
  if (stillFoulCount !== rows?.length) throw new Error("Not every written dot verified foul.");
  console.log("All verification checks passed.");
}

async function rollback(supabase: SupabaseClient<Database>, backupDir: string) {
  const dirs = readdirSync(backupDir).filter((d) => d.startsWith("lions-nov21-dots-")).sort();
  const latest = dirs[dirs.length - 1];
  if (!latest) throw new Error("No backup run directory found.");
  const runDir = path.join(backupDir, latest);
  console.log(`Rolling back using ${runDir}`);
  const before = JSON.parse(readFileSync(path.join(runDir, "at_bats_before.json"), "utf8"));
  for (const row of before.rows) {
    await supabase.from("at_bats").update({ field_x: row.field_x, field_y: row.field_y }).eq("id", row.id);
  }
  console.log(`Restored field_x/field_y to null on ${before.rows.length} rows.`);
}

main().catch((e) => {
  console.error("SCRIPT ERROR:", e);
  process.exit(1);
});
