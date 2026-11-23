// One-off data fix for the EpicPlay Demo Team's (sample data, team_id
// 481b2742-3cec-49eb-8ebe-11ee222c2925 -- verified by name below, never
// hardcoded without that check) spray-chart dots that land outside the
// foul lines. Scoped to this one team on purpose: safe to re-run (a
// clean run finds nothing left to fix and exits as a no-op), but it
// refuses outright if the name lookup resolves to any other team or to
// more than one team.
//
// Root cause: the demo data's at_bats.field_x/field_y values were
// seeded before this team's field_calibration row existed (the
// calibration is dated 2026-11-18; the sample at-bats are older), so
// nothing ever checked them against the team's real foul-line geometry.
// Once calibrated, 373 of this team's 574 field-charted hitting at-bats
// (across all 10 real hitters, not 5) turned out to be outside the foul
// lines -- confirmed read-only before anything here was written.
//
// Foul-line geometry: reuses the REAL getFieldZone() from
// src/lib/field-zones.ts (the same function/convention the app's own
// field-zone-validation code already uses, keyed off the team's own
// saved field_calibration row) rather than a second, possibly-
// diverging definition.
//
// Direction model: "pull / middle / oppo" uses the SAME convention
// KAIROS's own get_spray_tendencies tool already uses (see
// executeGetSprayTendencies / fieldThird in src/app/coach/kairos-
// actions.ts) -- flat thirds of the raw field_x axis (0-33.3 / 33.3-
// 66.7 / 66.7-100), NOT an angular split of fair territory. This went
// through a wrong turn before landing here: the first version of this
// script modeled direction as three equal angular thirds between the
// foul lines (mirroring zoneForPoint's own outfield-sector shape). That
// was a defensible-looking invention, but it wasn't the convention this
// app (or a coach looking at the actual spray chart, which plots raw
// field_x with no calibration transform at all) actually uses -- caught
// only by running this script's own step 5 (asking KAIROS the pull/
// oppo question for real) and finding its answer disagreed sharply with
// this script's own angular-model numbers. Rebuilt to match
// get_spray_tendencies exactly instead, so this script's "pull/middle/
// oppo" can never again disagree with what KAIROS or the spray chart
// itself reports. Pull vs. oppo is that flat third relabeled by the
// batter's own batting_hand, same mapping get_spray_tendencies uses: a
// RHB pulls to the LEFT (low field_x) side, a LHB pulls RIGHT (high
// field_x); a switch hitter or unknown hand gets no pull/oppo label at
// all, only the raw left/middle/right split.
//
// Three real conflicts were found and resolved with the user before
// this script reached its final form, not guessed at:
//
// 1. The brief said "the 5 regenerated hitters" -- the real data has
//    ALL 10 real hitters with out-of-bounds dots, split by the user
//    into two different groups with two different rules (see
//    NEUTRAL_HITTERS / STORY_HITTERS below).
// 2. For every one of the 5 NEUTRAL hitters, 100% of their out-of-
//    bounds dots (the only ones this script is allowed to move) were
//    already classified pull or oppo -- never middle. Strictly
//    "preserving direction" on every moved dot can therefore never
//    raise any neutral hitter's middle share above whatever their
//    UNTOUCHED in-bounds dots alone already provide, which falls well
//    short of the required 30-35%. Resolved, per the user's explicit
//    instruction, by reassigning the minimum number of each neutral
//    hitter's out-of-bounds pull/oppo dots into middle needed to land
//    every one of their three shares inside its target band --
//    preferring whichever dots already sit closest to the middle
//    boundary, to minimize how much any single dot's apparent direction
//    actually changes. The 5 STORY hitters and Blake Sanders (switch
//    hitter, "keep current mix") are NEVER reassigned -- every one of
//    their moved dots keeps its already-existing direction exactly.
// 3. The direction model itself, described above -- angular thirds,
//    then corrected to flat field_x thirds once KAIROS's own answer
//    (step 5) exposed the mismatch.
//
// One more fact this fix had to work around, also found empirically
// (by scanning getFieldZone across a range of x/y, not assumed): under
// flat field_x thirds, the INFIELD zone (the home/1B/2B/3B polygon)
// never reaches the left or right third at all for this team's
// calibration -- third_base.x and first_base.x both sit inside the
// middle third. So a "pulled" or "oppo" groundball/bunt/popup
// necessarily lands in shallow OUTFIELD territory under this
// convention, not literally "infield" -- which is also the more
// realistic picture (a sharply pulled grounder that gets past the
// infielder is still scored a groundball). positionForThirdAndHitType
// below picks a concrete, pre-verified (x, y) for exactly this reason,
// rather than assuming every hit_type has an infield-shaped landing
// spot available in every third.
//
// Usage:
//   npx tsx supabase/data-ops/fix-demo-spray-bounds.ts            (dry run: reports only, writes nothing)
//   npx tsx supabase/data-ops/fix-demo-spray-bounds.ts --apply    (backs up, writes, verifies)

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAllRows } from "../../src/lib/supabase/safe-fetch";
import { getFieldZone } from "../../src/lib/field-zones";
import { zoneIndexFromCoords, computeZoneBattingLines, type AtBatWithZone } from "../../src/lib/heat-map";
import type { Database, FieldCalibrationPoints, AtBatResult, HitType } from "../../src/lib/supabase/types";

const dir = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");

const TEAM_ID = "481b2742-3cec-49eb-8ebe-11ee222c2925";

const NEUTRAL_HITTERS = new Set(["Jordan Blake", "Marcus Chen", "Noah Kim", "Eli Brooks", "Derek Foster"]);
// Target pull% for the 4 extreme story hitters -- used only to report
// against, never as a hard constraint (see the comment above: their
// current mix already roughly matches these, so no reassignment is
// needed or performed for them).
const STORY_HITTERS: Record<string, { pullPct: number }> = {
  "Ryan Castillo": { pullPct: 87 },
  "Tyler Brooks": { pullPct: 81 },
  "Aiden Foster": { pullPct: 88 },
};
const OPPO_STORY_HITTERS: Record<string, { oppoPct: number }> = {
  "Caleb Ortiz": { oppoPct: 80 },
};

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

type AtBatRow = Database["public"]["Tables"]["at_bats"]["Row"];
type PitchRow = Pick<Database["public"]["Tables"]["pitches"]["Row"], "at_bat_id" | "pitch_number" | "zone_x" | "zone_y">;

// Exactly src/app/coach/kairos-actions.ts's own FIELD_THIRD/fieldThird --
// deliberately not imported (that file is "use server"-adjacent and
// pulls in a lot more than this one constant+function), but kept
// byte-for-byte identical in shape so the two can never quietly drift
// apart. 0 = left (pull for a RHB), 1 = middle, 2 = right (pull for a LHB).
const FIELD_THIRD = 100 / 3;
function fieldThirdOf(x: number): 0 | 1 | 2 {
  if (x < FIELD_THIRD) return 0;
  if (x < 2 * FIELD_THIRD) return 1;
  return 2;
}

function isFoul(cal: FieldCalibrationPoints, x: number, y: number): boolean {
  return getFieldZone(x, y, cal) === "foul";
}

// Concrete (x, y) target per (third, hit_type), chosen empirically
// against this team's actual calibration (not assumed): scanned
// getFieldZone across a range of x/y first, and picked a point for
// each cell comfortably inside a real, non-foul zone band for that x --
// see the header comment for why the left/right thirds use "outfield"
// even for bunt/popup/groundball (no infield band exists out there for
// this calibration) while the middle third uses genuine infield depths.
// x=30/50/70 are representative points well inside each third (clear of
// both the 33.3/66.7 boundaries and of the foul lines themselves at any
// reachable depth); if this team's calibration is ever redone, run
// supabase/data-ops/fix-demo-spray-bounds.ts --apply again -- the
// isFoul check below still catches any point that no longer fits.
const POSITION_FOR: Record<0 | 1 | 2, Record<HitType, [number, number]>> = {
  0: { bunt: [30, 49], popup: [30, 46], groundball: [30, 38], linedrive: [30, 28], flyball: [30, 16], hr: [30, 8] },
  1: { bunt: [50, 72], popup: [50, 65], groundball: [50, 52], linedrive: [50, 34], flyball: [50, 20], hr: [50, 8] },
  2: { bunt: [70, 47.5], popup: [70, 44.5], groundball: [70, 36], linedrive: [70, 26], flyball: [70, 15], hr: [70, 8] },
};
const DEFAULT_POSITION_FOR: Record<0 | 1 | 2, [number, number]> = { 0: [30, 32], 1: [50, 45], 2: [70, 30] };

function positionForThirdAndHitType(third: 0 | 1 | 2, hitType: HitType | null): { x: number; y: number } {
  const [x, y] = hitType !== null ? POSITION_FOR[third][hitType] : DEFAULT_POSITION_FOR[third];
  return { x, y };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

interface OobRow {
  row: Pick<AtBatRow, "id" | "player_id" | "hit_type" | "field_x" | "field_y">;
  currentThird: 0 | 1 | 2;
  x: number; // raw field_x, used only to rank "closest to the middle boundary" (33.3 or 66.7)
}

// The minimal-disruption reassignment for ONE neutral hitter: decide how
// many of their out-of-bounds left-third and right-third dots must
// become middle so that final pull/middle/oppo (as a % of this
// player's full charted total, in-bounds included) land inside
// [35,45]/[30,35]/[20,30] -- searched directly (the input sizes here are
// at most a few dozen dots per player, so a plain nested loop is simpler
// and more obviously correct than a closed-form solve) rather than
// solved algebraically, preferring the candidate that converts the
// fewest dots overall. pullSide says which raw third (0=left, 2=right)
// is this player's pull side -- a RHB pulls left, a LHB pulls right (see
// the header comment) -- so the 35-45% target applies to whichever side
// that actually is, not to "left" unconditionally. Bug found while
// testing: the first version of this function hard-coded left=pull/
// right=oppo and threw "impossible" for Marcus Chen (a LHB, whose pull
// side is right) -- it was asking his pull share to land at 35-45% on
// the wrong side of the plate.
function planNeutralReassignment(
  inBounds: [number, number, number],
  oobLeftCount: number,
  oobRightCount: number,
  // Out-of-bounds dots that were ALREADY flat-x "middle" before any
  // reassignment -- a fixed contribution to the final middle count,
  // not something cl/cr search over. Bug found while testing: an
  // earlier version of this function omitted this entirely, so its own
  // search could accept a (cl, cr) that looked in-range by its own
  // (undercounted) math but overshot the real 30-35% ceiling once this
  // was correctly added back in (confirmed live: Jordan Blake's real
  // middle share came out at 40%, not the 30.8% this function had
  // "verified" while searching).
  oobMiddleCount: number,
  total: number,
  pullSide: 0 | 2
): { convertFromLeft: number; convertFromRight: number } {
  const inRange = (n: number, lo: number, hi: number) => {
    const pct = (100 * n) / total;
    return pct >= lo && pct <= hi;
  };
  let best: { convertFromLeft: number; convertFromRight: number } | null = null;
  let bestCost = Infinity;
  for (let cl = 0; cl <= oobLeftCount; cl++) {
    for (let cr = 0; cr <= oobRightCount; cr++) {
      const finalLeft = inBounds[0] + (oobLeftCount - cl);
      const finalRight = inBounds[2] + (oobRightCount - cr);
      const finalMiddle = inBounds[1] + oobMiddleCount + cl + cr;
      const finalPull = pullSide === 0 ? finalLeft : finalRight;
      const finalOppo = pullSide === 0 ? finalRight : finalLeft;
      if (!inRange(finalPull, 35, 45)) continue;
      if (!inRange(finalMiddle, 30, 35)) continue;
      if (!inRange(finalOppo, 20, 30)) continue;
      const cost = cl + cr;
      if (cost < bestCost) {
        bestCost = cost;
        best = { convertFromLeft: cl, convertFromRight: cr };
      }
    }
  }
  if (!best) {
    throw new Error(
      `Refusing: no reassignment of this player's ${oobLeftCount} left/${oobRightCount} right out-of-bounds dots (pull side=${pullSide}, in-bounds baseline ${JSON.stringify(
        inBounds
      )}, total ${total}) can land all three shares inside 35-45/30-35/20-30. Needs a human decision, not a guess.`
    );
  }
  return best;
}

async function main() {
  const env = loadEnv();
  const supabase: SupabaseClient<Database> = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(APPLY ? "=== APPLY MODE: will back up and write ===" : "=== DRY RUN: reporting only, nothing will be written ===");

  // Team-specific check, refuse any other team.
  const { data: teams, error: teamsError } = await supabase.from("teams").select("id, name").ilike("name", "%Demo Team%");
  if (teamsError) throw new Error(teamsError.message);
  if (!teams || teams.length !== 1 || teams[0].id !== TEAM_ID) {
    throw new Error(`Refusing: expected exactly one team matching "Demo Team" with id ${TEAM_ID}, got ${JSON.stringify(teams)}.`);
  }
  console.log("Confirmed team:", teams[0]);

  const { data: calRow, error: calError } = await supabase
    .from("field_calibration")
    .select("calibration_points")
    .eq("team_id", TEAM_ID)
    .eq("field_type", "2d")
    .maybeSingle();
  if (calError) throw new Error(calError.message);
  if (!calRow) throw new Error("Refusing: no 2d field_calibration row for this team.");
  const cal = calRow.calibration_points as FieldCalibrationPoints;

  const { data: players, error: playersError } = await supabase.from("players").select("id, name, batting_hand").eq("team_id", TEAM_ID);
  if (playersError) throw new Error(playersError.message);
  const playerById = new Map(players!.map((p) => [p.id, p]));

  const { data: games, error: gamesError } = await supabase.from("games").select("id").eq("team_id", TEAM_ID);
  if (gamesError) throw new Error(gamesError.message);
  const gameIds = (games ?? []).map((g) => g.id);

  // Full rows (every column) for every hitting-mode, field-charted
  // at-bat -- paginated per the 1000-row PostgREST cap, chunked on the
  // game-id IN-list per the same cap's input-size sibling, using this
  // repo's own fetchAllRows helper (src/lib/supabase/safe-fetch.ts) so
  // this can't silently truncate the way the dashboard/KAIROS bug this
  // app already fixed once did.
  const CHUNK = 150;
  let allHittingAtBats: AtBatRow[] = [];
  for (let i = 0; i < gameIds.length; i += CHUNK) {
    const chunk = gameIds.slice(i, i + CHUNK);
    const rows = await fetchAllRows<AtBatRow>(supabase, "at_bats", "*", (q) =>
      q.in("game_id", chunk).eq("mode", "hitting").not("field_x", "is", null).not("field_y", "is", null)
    );
    allHittingAtBats.push(...rows);
  }
  console.log(`Total hitting-mode, field-charted at_bats: ${allHittingAtBats.length}`);

  const outOfBounds = allHittingAtBats.filter((ab) => isFoul(cal, ab.field_x!, ab.field_y!));
  console.log(`Out-of-bounds (foul-territory) rows: ${outOfBounds.length}`);

  // ---- Per-player baseline (left/middle/right, hit/out/strikeout) ----
  const byPlayer = new Map<string, AtBatRow[]>();
  for (const ab of allHittingAtBats) {
    if (!ab.player_id) continue;
    const list = byPlayer.get(ab.player_id) ?? [];
    list.push(ab);
    byPlayer.set(ab.player_id, list);
  }

  const HIT_RESULTS = new Set<AtBatResult>(["single", "double", "triple", "hr", "ground_rule_double"]);
  function resultBucket(result: AtBatResult | null): "hit" | "out" | "strikeout" {
    if (result === "strikeout") return "strikeout";
    if (result && HIT_RESULTS.has(result)) return "hit";
    return "out";
  }

  console.log("\n--- Per-player baseline (before any change) ---");
  const baselineHitOutCounts = new Map<string, { hit: number; out: number; strikeout: number }>();
  for (const [playerId, rows] of Array.from(byPlayer)) {
    const name = playerById.get(playerId)?.name ?? playerId;
    const tally: [number, number, number] = [0, 0, 0];
    const counts = { hit: 0, out: 0, strikeout: 0 };
    for (const ab of rows) {
      tally[fieldThirdOf(ab.field_x!)]++;
      counts[resultBucket(ab.result)]++;
    }
    baselineHitOutCounts.set(playerId, counts);
    console.log(`  ${name}: n=${rows.length} L/M/R=${tally} hit=${counts.hit} out=${counts.out} strikeout=${counts.strikeout}`);
  }

  // ---- Decide each out-of-bounds row's FINAL third ----
  // For story hitters and anyone not in NEUTRAL_HITTERS: finalThird ===
  // currentThird, always -- "every moved dot keeps the same direction
  // category" applies with no exception.
  const finalThirdByRowId = new Map<string, 0 | 1 | 2>();
  const reassignmentReport: string[] = [];

  for (const [playerId, rows] of Array.from(byPlayer)) {
    const player = playerById.get(playerId);
    const name = player?.name ?? playerId;
    const oobForPlayer = rows.filter((ab) => isFoul(cal, ab.field_x!, ab.field_y!));
    if (oobForPlayer.length === 0) continue;

    if (!NEUTRAL_HITTERS.has(name)) {
      for (const ab of oobForPlayer) finalThirdByRowId.set(ab.id, fieldThirdOf(ab.field_x!));
      continue;
    }

    const inBoundsForPlayer = rows.filter((ab) => !isFoul(cal, ab.field_x!, ab.field_y!));
    const inBoundsTally: [number, number, number] = [0, 0, 0];
    for (const ab of inBoundsForPlayer) inBoundsTally[fieldThirdOf(ab.field_x!)]++;

    const oobRows: OobRow[] = oobForPlayer.map((row) => ({
      row,
      currentThird: fieldThirdOf(row.field_x!),
      x: row.field_x!,
    }));
    const oobLeft = oobRows.filter((r) => r.currentThird === 0);
    // Under the flat-x convention, unlike the angular one this script
    // started with, out-of-bounds dots landing in the flat middle third
    // are common, not empty -- these are a fixed addition to the final
    // middle count (see planNeutralReassignment's oobMiddleCount param).
    const oobMiddle = oobRows.filter((r) => r.currentThird === 1);
    const oobRight = oobRows.filter((r) => r.currentThird === 2);

    const pullSide: 0 | 2 = player!.batting_hand === "L" ? 2 : 0; // R (or unset) pulls left, L pulls right
    const plan = planNeutralReassignment(inBoundsTally, oobLeft.length, oobRight.length, oobMiddle.length, rows.length, pullSide);

    // Closest-to-the-middle-boundary first: left-third rows sorted by
    // descending x (nearest the 33.3 left/middle boundary), right-third
    // rows by ascending x (nearest the 66.7 middle/right boundary).
    const leftSorted = [...oobLeft].sort((a, b) => b.x - a.x);
    const rightSorted = [...oobRight].sort((a, b) => a.x - b.x);
    const convertedLeftIds = new Set(leftSorted.slice(0, plan.convertFromLeft).map((r) => r.row.id));
    const convertedRightIds = new Set(rightSorted.slice(0, plan.convertFromRight).map((r) => r.row.id));

    for (const r of oobMiddle) finalThirdByRowId.set(r.row.id, 1);
    for (const r of oobLeft) finalThirdByRowId.set(r.row.id, convertedLeftIds.has(r.row.id) ? 1 : 0);
    // Bug found and fixed while building this script: this line used to
    // read `... ? 1 : 0`, copy-pasted from the oobLeft line above --
    // which meant every non-converted "kept as right" dot got written
    // as THIRD 0 (left) instead of 2 (right). Confirmed live: it's
    // exactly what produced the "kept-as-right dots reclassified as
    // left" symptom the first two apply attempts both hit, with zero
    // connection to the position-geometry rewrite that preceded this
    // fix (that rewrite was a real, separate improvement, just not the
    // cause of this particular bug).
    for (const r of oobRight) finalThirdByRowId.set(r.row.id, convertedRightIds.has(r.row.id) ? 1 : 2);

    const finalLeft = inBoundsTally[0] + (oobLeft.length - plan.convertFromLeft);
    const finalMiddle = inBoundsTally[1] + oobMiddle.length + plan.convertFromLeft + plan.convertFromRight;
    const finalRight = inBoundsTally[2] + (oobRight.length - plan.convertFromRight);
    reassignmentReport.push(
      `  ${name}: converted ${plan.convertFromLeft} left-third + ${plan.convertFromRight} right-third dot(s) to middle -> final L/M/R = ${finalLeft}/${finalMiddle}/${finalRight} of ${rows.length} (${((100 * finalLeft) / rows.length).toFixed(1)}%/${((100 * finalMiddle) / rows.length).toFixed(1)}%/${((100 * finalRight) / rows.length).toFixed(1)}%)`
    );
  }
  console.log("\n--- Neutral-hitter reassignment plan ---");
  for (const line of reassignmentReport) console.log(line);

  // ---- Compute the new (x, y) for every out-of-bounds row ----
  const updates: { id: string; field_x: number; field_y: number }[] = [];
  for (const ab of outOfBounds) {
    const finalThird = finalThirdByRowId.get(ab.id);
    if (finalThird === undefined) throw new Error(`No final third decided for at_bats row ${ab.id} -- internal error.`);
    const p = positionForThirdAndHitType(finalThird, ab.hit_type);
    const newX = round1(p.x);
    const newY = round1(p.y);
    if (isFoul(cal, newX, newY)) {
      throw new Error(`Computed position for ${ab.id} is still foul (${newX}, ${newY}) -- refusing to write it.`);
    }
    updates.push({ id: ab.id, field_x: newX, field_y: newY });
  }
  console.log(`\nComputed ${updates.length} new in-bounds positions, all verified fair before writing.`);

  if (!APPLY) {
    console.log("\nDry run complete. Re-run with --apply to back up and write.");
    return;
  }

  // ---- Backup, before any write ----
  const backupIds = outOfBounds.map((ab) => ab.id);
  const fullBackupRows = await fetchAllRows<AtBatRow>(supabase, "at_bats", "*", (q) => q.in("id", backupIds));
  const backupDir = path.join(dir, "backups");
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `demo-team-spray-bounds-fix-${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify({ teamId: TEAM_ID, at_bats: fullBackupRows }, null, 2));
  console.log(`\nBacked up ${fullBackupRows.length} rows to ${backupPath}`);

  // ---- Pre-fix invariant: Derek Foster's Middle-Outside zone AVG/AB ----
  // (zoneIndexFromCoords/computeZoneBattingLines, the real exported
  // functions the coach's own heat map uses -- "last pitch per at-bat"
  // by pitch_number, same convention player-breakdown-client.tsx uses.)
  async function derekMiddleOutsideLine() {
    const derek = players!.find((p) => p.name === "Derek Foster");
    if (!derek) return null;
    const { data: derekAtBats, error } = await supabase
      .from("at_bats")
      .select("id, result")
      .eq("player_id", derek.id)
      .eq("mode", "hitting")
      .not("confirmed_at", "is", null);
    if (error) throw new Error(error.message);
    const atBatIds = (derekAtBats ?? []).map((ab) => ab.id);
    const pitches = await fetchAllRows<PitchRow>(supabase, "pitches", "at_bat_id, pitch_number, zone_x, zone_y", (q) => q.in("at_bat_id", atBatIds));
    const zoneByAtBat = new Map<string, number | null>();
    for (const ab of atBatIds) {
      const forThis = pitches.filter((p) => p.at_bat_id === ab);
      const last = forThis.sort((a, b) => b.pitch_number - a.pitch_number)[0];
      zoneByAtBat.set(ab, last && last.zone_x !== null && last.zone_y !== null ? zoneIndexFromCoords(last.zone_x, last.zone_y) : null);
    }
    const zoneAtBats: AtBatWithZone[] = (derekAtBats ?? [])
      .filter((ab): ab is typeof ab & { result: AtBatResult } => ab.result !== null)
      .map((ab) => ({ result: ab.result, zoneIndex: zoneByAtBat.get(ab.id) ?? null }));
    const lines = computeZoneBattingLines(zoneAtBats);
    return lines[5]; // row=Middle(2), col=Outside(3) -> zoneIndex (2-1)*3+(3-1) = 5, per zoneLabel9
  }
  const beforeLine = await derekMiddleOutsideLine();
  console.log(`\nDerek Foster Middle-Outside BEFORE: AB=${beforeLine?.ab} AVG=${beforeLine?.avg.toFixed(3)} (pitch/zone data -- untouched by this script either way)`);

  // ---- Write ----
  let failures = 0;
  for (const u of updates) {
    const { data, error } = await supabase.from("at_bats").update({ field_x: u.field_x, field_y: u.field_y }).eq("id", u.id).select("id");
    if (error) {
      console.error(`UPDATE failed for ${u.id}: ${error.message}`);
      failures++;
      continue;
    }
    if (!data || data.length === 0) {
      console.error(`UPDATE matched zero rows for ${u.id}`);
      failures++;
    }
  }
  if (failures > 0) throw new Error(`${failures} row(s) failed to update -- see above. Backup is at ${backupPath}.`);
  console.log(`Wrote ${updates.length} rows successfully.`);

  // ---- Verify ----
  console.log("\n--- Verification (re-read from the database) ---");
  let freshHittingAtBats: AtBatRow[] = [];
  for (let i = 0; i < gameIds.length; i += CHUNK) {
    const chunk = gameIds.slice(i, i + CHUNK);
    const rows = await fetchAllRows<AtBatRow>(supabase, "at_bats", "*", (q) =>
      q.in("game_id", chunk).eq("mode", "hitting").not("field_x", "is", null).not("field_y", "is", null)
    );
    freshHittingAtBats.push(...rows);
  }
  const stillFoul = freshHittingAtBats.filter((ab) => isFoul(cal, ab.field_x!, ab.field_y!));
  console.log(`Out-of-bounds rows remaining: ${stillFoul.length} (expect 0)`);
  if (stillFoul.length > 0) throw new Error(`${stillFoul.length} row(s) are still foul after the fix -- see ids: ${stillFoul.map((r) => r.id).join(", ")}`);

  const freshByPlayer = new Map<string, AtBatRow[]>();
  for (const ab of freshHittingAtBats) {
    if (!ab.player_id) continue;
    const list = freshByPlayer.get(ab.player_id) ?? [];
    list.push(ab);
    freshByPlayer.set(ab.player_id, list);
  }
  let mixMismatch = false;
  let hitOutMismatch = false;
  for (const [playerId, rows] of Array.from(freshByPlayer)) {
    const player = playerById.get(playerId)!;
    const tally: [number, number, number] = [0, 0, 0];
    const counts = { hit: 0, out: 0, strikeout: 0 };
    for (const ab of rows) {
      tally[fieldThirdOf(ab.field_x!)]++;
      counts[resultBucket(ab.result)]++;
    }
    const before = baselineHitOutCounts.get(playerId)!;
    const countsMatch = before.hit === counts.hit && before.out === counts.out && before.strikeout === counts.strikeout;
    if (!countsMatch) hitOutMismatch = true;
    const pct = tally.map((n) => (100 * n) / rows.length);
    let verdict = "";
    if (NEUTRAL_HITTERS.has(player.name)) {
      // Same pullSide logic as planNeutralReassignment -- a hand-blind
      // "pct[0] must be 35-45" check is exactly the bug that let Marcus
      // Chen's (a LHB, pull=right) correct mix get reported as "out of
      // range" the first time this verification ran.
      const pull = player.batting_hand === "L" ? pct[2] : pct[0];
      const oppo = player.batting_hand === "L" ? pct[0] : pct[2];
      const ok = pull >= 35 && pull <= 45 && pct[1] >= 30 && pct[1] <= 35 && oppo >= 20 && oppo <= 30;
      if (!ok) mixMismatch = true;
      verdict = ok ? "OK (within 35-45/30-35/20-30)" : "OUT OF TARGET RANGE";
    } else if (STORY_HITTERS[player.name]) {
      const pull = player.batting_hand === "L" ? pct[2] : pct[0];
      verdict = `pull=${pull.toFixed(1)}% (target ~${STORY_HITTERS[player.name].pullPct}%)`;
    } else if (OPPO_STORY_HITTERS[player.name]) {
      const oppo = player.batting_hand === "L" ? pct[0] : pct[2];
      verdict = `oppo=${oppo.toFixed(1)}% (target ~${OPPO_STORY_HITTERS[player.name].oppoPct}%)`;
    } else {
      verdict = "switch hitter / no pull-oppo target -- current mix preserved by construction";
    }
    console.log(
      `  ${player.name}: n=${rows.length} L/M/R=${pct.map((p) => p.toFixed(1)).join("/")}%  hit=${counts.hit} out=${counts.out} strikeout=${counts.strikeout} (counts unchanged: ${countsMatch})  ${verdict}`
    );
  }

  const afterLine = await derekMiddleOutsideLine();
  console.log(`\nDerek Foster Middle-Outside AFTER:  AB=${afterLine?.ab} AVG=${afterLine?.avg.toFixed(3)}`);
  const pitchInvariantOk = beforeLine?.ab === afterLine?.ab && beforeLine?.avg === afterLine?.avg;
  console.log(`Pitch-level invariant unchanged: ${pitchInvariantOk}`);

  if (mixMismatch || hitOutMismatch || !pitchInvariantOk) {
    throw new Error("One or more verification checks failed -- see the per-player lines above. Data has already been written; backup is at " + backupPath);
  }
  console.log("\nAll verification checks passed.");
}

main().catch((e) => {
  console.error("SCRIPT ERROR:", e);
  process.exit(1);
});
