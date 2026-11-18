// Creates (or --reset deletes) a fully self-contained demo team with a
// season of realistic, story-driven stats for sales/demo purposes.
//
// Data only -- this script never touches application code. It writes
// through the service-role client (bypasses RLS, same as every other
// supabase/data-ops/*.mjs script), and is permanently guarded to the
// one demo team it creates: every delete is scoped by team_id/game_id
// to rows this script itself created, and the hardcoded
// EXISTING_TEAM_IDS exclusion list below is a second, independent
// safety net against ever touching the Lions, Liubitos, or Practice
// Team even if the name-based lookup somehow matched something else.
//
// No secrets in this file: it reads NEXT_PUBLIC_SUPABASE_URL,
// NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY from the
// environment it's run in (e.g. `node --env-file=.env.local`) and never
// hardcodes any of them. The demo coach's password is generated at
// runtime, printed once to stdout, and never written to a file.
//
// Every player's season average/HR count/EPS tier is built
// DETERMINISTICALLY (an exact count of hits/walks/strikeouts/outs is
// decided up front, then shuffled into order), not left to chance --
// a purely probabilistic generator was tried first and produced an
// unintended .071 outlier and a power hitter with zero home runs on
// one real run, which this replaces.
//
// Usage:
//   node --env-file=.env.local supabase/data-ops/seed-demo-team.mjs            (create the demo team)
//   node --env-file=.env.local supabase/data-ops/seed-demo-team.mjs --reset    (delete the demo team entirely; does not reseed)

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";

const DEMO_TEAM_NAME = "EpicPlay Demo Team (sample data)";
const DEMO_EMAIL = "demo@epicplayai.com";
// Real teams this script must never be able to touch, independent of
// the name-based lookup below -- a second, hardcoded guard.
const EXISTING_TEAM_IDS = new Set([
  "63111c5c-4af6-40af-91ad-671ff3ae8d75", // Lions
  "93072e5a-6dd4-464e-ae80-da7d85a6bb2d", // Liubitos
  "2054386f-de3e-46bc-b4ee-7fc9abdc126b", // Liubitos
  "ebf554cd-e0d9-421e-9043-e31f593633fe", // PRACTICE TEAM
]);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in the environment.");
  process.exit(1);
}
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

function rnd() {
  return Math.random();
}
function randInt(min, max) {
  return Math.floor(rnd() * (max - min + 1)) + min;
}
function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function round1(v) {
  return Math.round(v * 10) / 10;
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------------------------------------------------------------------------
// Reset path
// ---------------------------------------------------------------------------
async function findDemoTeam() {
  const { data, error } = await admin.from("teams").select("id, name, created_by").eq("name", DEMO_TEAM_NAME).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function resetDemoTeam() {
  const team = await findDemoTeam();
  if (!team) {
    console.log("No demo team found -- nothing to reset.");
    return;
  }
  if (EXISTING_TEAM_IDS.has(team.id)) {
    throw new Error(`Refusing: team ${team.id} is in the hardcoded exclusion list. Nothing was touched.`);
  }
  console.log(`Deleting demo team ${team.id} (${team.name})...`);

  const { data: games } = await admin.from("games").select("id").eq("team_id", team.id);
  const gameIds = (games ?? []).map((g) => g.id);
  const { data: atBats } = gameIds.length ? await admin.from("at_bats").select("id").in("game_id", gameIds) : { data: [] };
  const atBatIds = (atBats ?? []).map((r) => r.id);
  const { data: opponents } = await admin.from("opponents").select("id").eq("team_id", team.id);
  const opponentIds = (opponents ?? []).map((o) => o.id);

  if (atBatIds.length) await admin.from("pitches").delete().in("at_bat_id", atBatIds);
  if (gameIds.length) {
    await admin.from("at_bats").delete().in("game_id", gameIds);
    await admin.from("stolen_bases").delete().in("game_id", gameIds);
    await admin.from("game_events").delete().in("game_id", gameIds);
    await admin.from("substitutions").delete().in("game_id", gameIds);
    await admin.from("game_state").delete().in("game_id", gameIds);
    await admin.from("lineup").delete().in("game_id", gameIds);
  }
  await admin.from("games").delete().eq("team_id", team.id);
  if (opponentIds.length) await admin.from("opponent_players").delete().in("opponent_id", opponentIds);
  await admin.from("opponents").delete().eq("team_id", team.id);
  await admin.from("seasons").delete().eq("team_id", team.id);
  await admin.from("field_calibration").delete().eq("team_id", team.id);
  await admin.from("players").delete().eq("team_id", team.id);
  await admin.from("profiles").delete().eq("team_id", team.id);
  await admin.from("teams").delete().eq("id", team.id);

  if (team.created_by) {
    const { error: delUserError } = await admin.auth.admin.deleteUser(team.created_by);
    if (delUserError) console.error(`Warning: failed to delete auth user ${team.created_by}: ${delUserError.message}`);
    else console.log(`Deleted auth user ${team.created_by} (${DEMO_EMAIL}).`);
  }
  console.log("Demo team fully deleted.");
}

if (process.argv.includes("--reset")) {
  await resetDemoTeam();
  process.exit(0);
}

const existing = await findDemoTeam();
if (existing) {
  console.error(`Refusing: a team named "${DEMO_TEAM_NAME}" already exists (${existing.id}). Run with --reset first.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Deterministic season-outcome builder
// ---------------------------------------------------------------------------
// Builds an EXACT-count, then-shuffled, array of `paCount` plate
// appearances hitting `avg` (batting average) and (optionally) an
// exact home-run count -- eliminates the sample-size variance a purely
// random generator would otherwise leave to chance.
function buildSegmentOutcomes(paCount, avg, { bbRate = 0.09, hbpRate = 0.012, kRate = 0.18, hrCount = null, power = 1 } = {}) {
  const bb = Math.round(paCount * bbRate);
  const hbp = Math.round(paCount * hbpRate);
  const ab = Math.max(0, paCount - bb - hbp);
  const k = clamp(Math.round(ab * kRate), 0, ab);
  let hits = clamp(Math.round(avg * ab), 0, ab - k);
  const outsNonK = ab - k - hits;

  const hr = hrCount !== null ? Math.min(hrCount, hits) : Math.round(hits * 0.03 * power);
  const remaining = hits - hr;
  const triples = Math.round(remaining * 0.02);
  const doubles = Math.round((remaining - triples) * 0.18);
  const singles = Math.max(0, remaining - triples - doubles);

  const groundouts = Math.round(outsNonK * 0.42);
  const flyouts = Math.round(outsNonK * 0.38);
  const lineouts = Math.max(0, outsNonK - groundouts - flyouts);

  const outcomes = [
    ...Array(bb).fill("walk"),
    ...Array(hbp).fill("hbp"),
    ...Array(k).fill("strikeout"),
    ...Array(hr).fill("hr"),
    ...Array(triples).fill("triple"),
    ...Array(doubles).fill("double"),
    ...Array(singles).fill("single"),
    ...Array(groundouts).fill("groundout"),
    ...Array(flyouts).fill("flyout"),
    ...Array(lineouts).fill("lineout"),
  ];
  while (outcomes.length < paCount) outcomes.push("groundout");
  while (outcomes.length > paCount) outcomes.pop();
  return shuffle(outcomes);
}

// Derek Foster's weak-zone PAs: forced to a near-zero average (mostly
// strikeout, a few weak groundouts -- neither is a hit) so the heat
// map's "Middle-Outside" cell reads unmistakably badly, with enough
// swings concentrated there for a clearly elevated whiff rate too.
function buildWeakZoneOutcomes(count) {
  const k = Math.round(count * 0.8);
  const go = count - k;
  return shuffle([...Array(k).fill("strikeout"), ...Array(go).fill("groundout")]);
}

function hitTypeFor(result) {
  if (result === "hr") return "hr";
  if (result === "groundout") return "groundball";
  if (result === "flyout") return rnd() < 0.2 ? "popup" : "flyball";
  if (result === "lineout") return "linedrive";
  const r = rnd();
  if (r < 0.4) return "groundball";
  if (r < 0.75) return "linedrive";
  if (r < 0.95) return "flyball";
  return "bunt";
}

// field_x: 0 = left-field side of the image, 100 = right-field side
// (field-2d.png's own 0-100 convention, see src/app/operator/field-diagram.tsx).
function fieldCoordsFor(result, pullBiasX) {
  if (result === "walk" || result === "hbp" || result === "strikeout") return { x: null, y: null };
  const centerX = pullBiasX ?? 50;
  const x = clamp(centerX + (rnd() - 0.5) * 30, 2, 98);
  const y = result === "hr" ? clamp(5 + rnd() * 15, 2, 25) : clamp(15 + rnd() * 65, 10, 90);
  return { x: round1(x), y: round1(y) };
}

const PITCH_TYPES = ["fastball", "curveball", "changeup", "slider", "2seam"];

// Builds a full confirmed pitch sequence for one at-bat. forcedZone (if
// given) pins every pitch's zone near that spot, forces pitch_type ===
// "fastball", and (for a strikeout specifically) biases every pitch
// toward a SWINGING strike -- used only for Derek Foster's deliberate
// weak-zone at-bats, so both the batting-average heat map AND the
// swing-and-miss rate there read as a clear, unmistakable weak spot.
function buildPitches(result, forcedZone) {
  const pitches = [];
  let n = 0;
  function push(outcome, swing) {
    n += 1;
    const useForcedZone = forcedZone && rnd() < 0.75;
    const zx = useForcedZone ? clamp(forcedZone.x + (rnd() - 0.5) * 10, 0, 100) : round1(rnd() * 100);
    const zy = useForcedZone ? clamp(forcedZone.y + (rnd() - 0.5) * 10, 0, 100) : round1(rnd() * 100);
    pitches.push({ pitch_number: n, pitch_type: forcedZone ? "fastball" : pick(PITCH_TYPES), zone_x: round1(zx), zone_y: round1(zy), outcome, swing });
  }

  if (result === "walk") {
    for (let i = 0; i < randInt(4, 6); i++) push("ball", false);
    return pitches;
  }
  if (result === "hbp") {
    for (let i = 0; i < randInt(0, 3); i++) push(rnd() < 0.5 ? "ball" : "foul", rnd() < 0.5 ? false : true);
    push("hbp", false);
    return pitches;
  }
  if (result === "strikeout") {
    const lead = randInt(1, 4);
    for (let i = 0; i < lead; i++) {
      if (forcedZone) {
        // Concentrate heavily on swinging strikes in the story zone --
        // the whole point is a clearly elevated whiff rate there, not
        // a slightly higher one.
        const r = rnd();
        if (r < 0.15) push("ball", false);
        else push("strike", true);
      } else {
        const r = rnd();
        if (r < 0.4) push("ball", false);
        else if (r < 0.7) push("foul", true);
        else push("strike", rnd() < 0.6);
      }
    }
    push("strike", forcedZone ? true : rnd() < 0.5);
    return pitches;
  }
  // Ball in play (hit or out).
  const lead = randInt(0, 4);
  for (let i = 0; i < lead; i++) {
    if (forcedZone) {
      push(rnd() < 0.25 ? "ball" : "foul", rnd() < 0.3 ? false : true);
    } else {
      const r = rnd();
      if (r < 0.45) push("ball", false);
      else if (r < 0.8) push("foul", true);
      else push("strike", rnd() < 0.6);
    }
  }
  push("inplay", true);
  return pitches;
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------
// Story roles: Jordan Blake = SB leader + hot streak + an extremely
// patient approach (deliberately high walk rate -- see the EPS note in
// the final report for why that's what it takes to reach the "Elite"
// tier under this app's own EPS formula); Ryan Castillo = slump; Derek
// Foster = weak vs. fastballs on the outside corner; Tyler Brooks =
// power/pull, forced to a fixed HR count rather than left to chance;
// Caleb Ortiz = opposite field; Aiden Foster = pull (LHB, opposite
// side from Tyler/Ryan); Eli Brooks = the ace (weak hitter, anchors
// the low end of the AVG range); Sam Rivera = second pitcher (bench).
// Every starter bats PA_PER_GAME (4) times per game across all 20
// games = 80 real plate appearances each this season -- every
// segments list below must sum to exactly that (Derek Foster's
// weakZonePA counts separately, on top of his own 58+22=80), or
// nextOutcomeFor's queue would run dry before the season ends and
// silently fall back to forced groundouts for the remainder.
const TOTAL_PA = 80;
const ROSTER = [
  { jersey: 1, name: "Jordan Blake", position: "SS", battingOrder: 1, batting_hand: "R", throwing_hand: "R", player_type: "table_setter", speed_rating: 5,
    segments: [{ pa: 40, avg: 0.3 }, { pa: 40, avg: 0.58 }], bbRate: 0.55, kRate: 0.03, pullBiasX: null, sbRate: 0.35 },
  { jersey: 2, name: "Marcus Chen", position: "2B", battingOrder: 2, batting_hand: "L", throwing_hand: "R", player_type: "contact", speed_rating: 3,
    segments: [{ pa: TOTAL_PA, avg: 0.31 }], bbRate: 0.08, kRate: 0.14, pullBiasX: null, sbRate: 0.04 },
  { jersey: 3, name: "Tyler Brooks", position: "1B", battingOrder: 3, batting_hand: "R", throwing_hand: "R", player_type: "power", speed_rating: 2,
    segments: [{ pa: TOTAL_PA, avg: 0.3, hrCount: 5 }], bbRate: 0.35, kRate: 0.18, power: 2.6, pullBiasX: 22, sbRate: 0.01 },
  { jersey: 4, name: "Derek Foster", position: "C", battingOrder: 4, batting_hand: "R", throwing_hand: "R", player_type: "all_rounder", speed_rating: 2,
    segments: [{ pa: 58, avg: 0.31 }], bbRate: 0.08, kRate: 0.14, pullBiasX: null, sbRate: 0.01, weakZoneStory: true, weakZonePA: 22 },
  { jersey: 5, name: "Ryan Castillo", position: "3B", battingOrder: 5, batting_hand: "R", throwing_hand: "R", player_type: "contact", speed_rating: 3,
    segments: [{ pa: 40, avg: 0.3 }, { pa: 40, avg: 0.08 }], bbRate: 0.07, kRate: 0.2, pullBiasX: 24, sbRate: 0.02 },
  { jersey: 6, name: "Caleb Ortiz", position: "LF", battingOrder: 6, batting_hand: "R", throwing_hand: "L", player_type: "all_rounder", speed_rating: 3,
    segments: [{ pa: TOTAL_PA, avg: 0.3 }], bbRate: 0.08, kRate: 0.16, pullBiasX: 76, sbRate: 0.03 },
  { jersey: 7, name: "Blake Sanders", position: "CF", battingOrder: 7, batting_hand: "S", throwing_hand: "R", player_type: "speedster", speed_rating: 5,
    segments: [{ pa: TOTAL_PA, avg: 0.28 }], bbRate: 0.08, kRate: 0.16, pullBiasX: null, sbRate: 0.18 },
  { jersey: 8, name: "Aiden Foster", position: "RF", battingOrder: 8, batting_hand: "L", throwing_hand: "L", player_type: "all_rounder", speed_rating: 3,
    segments: [{ pa: TOTAL_PA, avg: 0.3, hrCount: 2 }], bbRate: 0.09, kRate: 0.17, pullBiasX: 78, sbRate: 0.02 },
  { jersey: 9, name: "Noah Kim", position: "DH", battingOrder: 9, batting_hand: "R", throwing_hand: "R", player_type: "all_rounder", speed_rating: 2,
    segments: [{ pa: TOTAL_PA, avg: 0.26 }], bbRate: 0.07, kRate: 0.18, pullBiasX: null, sbRate: 0.01 },
  { jersey: 10, name: "Eli Brooks", position: "P", battingOrder: 10, batting_hand: "R", throwing_hand: "R", player_type: "pitcher_only", speed_rating: 2,
    segments: [{ pa: TOTAL_PA, avg: 0.165 }], bbRate: 0.05, kRate: 0.3, pullBiasX: null, sbRate: 0, pitcherQuality: 0.17 },
  { jersey: 11, name: "Sam Rivera", position: "P", battingOrder: null, batting_hand: "L", throwing_hand: "L", player_type: "pitcher_only", speed_rating: 2,
    segments: [{ pa: 10, avg: 0.17 }], bbRate: 0.05, kRate: 0.3, pullBiasX: null, sbRate: 0, pitcherQuality: 0.3, reserve: true },
  { jersey: 12, name: "Owen Delgado", position: "C", battingOrder: null, batting_hand: "R", throwing_hand: "R", player_type: "all_rounder", speed_rating: 3,
    segments: [{ pa: 4, avg: 0.3 }], bbRate: 0.08, kRate: 0.16, pullBiasX: null, sbRate: 0.02, reserve: true },
  { jersey: 13, name: "Devon Price", position: "OF", battingOrder: null, batting_hand: "R", throwing_hand: "R", player_type: "all_rounder", speed_rating: 3,
    segments: [{ pa: 4, avg: 0.28 }], bbRate: 0.08, kRate: 0.16, pullBiasX: null, sbRate: 0.03, reserve: true },
  { jersey: 14, name: "Carlos Mendez", position: "IF", battingOrder: null, batting_hand: "S", throwing_hand: "R", player_type: "all_rounder", speed_rating: 3,
    segments: [{ pa: 4, avg: 0.27 }], bbRate: 0.08, kRate: 0.16, pullBiasX: null, sbRate: 0.02, reserve: true },
];

const OPPONENT_NAMES = ["River City Raptors", "Hilltop Hornets", "Northgate Nighthawks", "Cedar Falls Comets", "Ironwood Ironclads", "Bayview Barracudas"];
const UPCOMING_OPPONENT_NAME = "Summit Stingers";
const WEAK_ZONE = { x: 80, y: 50 }; // "Middle-Outside" in both the 9-zone and 25-zone grids

console.log(`Creating demo team "${DEMO_TEAM_NAME}"...`);

// ---------------------------------------------------------------------------
// Auth user + profile + team
// ---------------------------------------------------------------------------
const password = randomBytes(12).toString("base64url"); // printed once at the end, never written to a file
const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({ email: DEMO_EMAIL, password, email_confirm: true });
if (createUserError) throw new Error(`Failed to create auth user: ${createUserError.message}`);
const coachUserId = createdUser.user.id;

const { data: team, error: teamError } = await admin.from("teams").insert({ name: DEMO_TEAM_NAME, created_by: coachUserId }).select("id").single();
if (teamError) throw new Error(`Failed to create team: ${teamError.message}`);
const teamId = team.id;

const { error: profileError } = await admin
  .from("profiles")
  .update({ role: "coach", team_id: teamId, full_name: "Demo Coach (Sample Data Team)", email: DEMO_EMAIL })
  .eq("id", coachUserId);
if (profileError) throw new Error(`Failed to update profile: ${profileError.message}`);

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------
const playerInsertRows = ROSTER.map((r) => ({
  team_id: teamId,
  name: r.name,
  jersey_number: r.jersey,
  position: r.position,
  batting_hand: r.batting_hand,
  throwing_hand: r.throwing_hand,
  player_type: r.player_type,
  speed_rating: r.speed_rating,
}));
const { data: insertedPlayers, error: playersError } = await admin.from("players").insert(playerInsertRows).select("id, name");
if (playersError) throw new Error(`Failed to insert players: ${playersError.message}`);
if (insertedPlayers.length !== ROSTER.length) throw new Error("Player insert count mismatch.");
const idByName = new Map(insertedPlayers.map((p) => [p.name, p.id]));
const playerRows = ROSTER.map((r) => ({ ...r, id: idByName.get(r.name) }));
const byName = new Map(playerRows.map((p) => [p.name, p]));
const starters = playerRows.filter((p) => !p.reserve);
const reserves = playerRows.filter((p) => p.reserve);
console.log(`Created ${playerRows.length} players.`);

// Pre-build every starter's full-season outcome queue (and Derek
// Foster's separate weak-zone queue) ONCE, up front -- pure JS, no DB
// calls -- so the per-game loop below just pulls the next outcome off
// each player's queue in order.
const seasonQueues = new Map();
for (const p of starters) {
  const outcomes = [];
  for (const seg of p.segments) {
    outcomes.push(...buildSegmentOutcomes(seg.pa, seg.avg, { bbRate: p.bbRate, kRate: p.kRate, hrCount: seg.hrCount ?? null, power: p.power ?? 1 }));
  }
  seasonQueues.set(p.id, { cursor: 0, outcomes });
}
const weakZoneQueue = byName.get("Derek Foster").weakZoneStory ? { cursor: 0, outcomes: buildWeakZoneOutcomes(byName.get("Derek Foster").weakZonePA) } : null;

function nextOutcomeFor(player, isFullModeGame) {
  if (player.weakZoneStory && isFullModeGame && weakZoneQueue.cursor < weakZoneQueue.outcomes.length && rnd() < 0.55) {
    const result = weakZoneQueue.outcomes[weakZoneQueue.cursor];
    weakZoneQueue.cursor += 1;
    return { result, weak: true };
  }
  const q = seasonQueues.get(player.id);
  if (q.cursor >= q.outcomes.length) return { result: "groundout", weak: false }; // queue exhausted (shouldn't happen at these PA counts)
  const result = q.outcomes[q.cursor];
  q.cursor += 1;
  return { result, weak: false };
}

const HIT_RESULTS = new Set(["single", "double", "triple", "hr"]);
const OUT_RESULTS = new Set(["strikeout", "groundout", "flyout", "lineout"]);

// ---------------------------------------------------------------------------
// Opponents + opponent_players
// ---------------------------------------------------------------------------
const opponents = [];
const POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
for (const name of OPPONENT_NAMES) {
  const { data: opp, error } = await admin.from("opponents").insert({ team_id: teamId, name }).select("id").single();
  if (error) throw new Error(`Failed to insert opponent ${name}: ${error.message}`);
  const oppPlayerRows = POSITIONS.map((pos, i) => ({ opponent_id: opp.id, name: `${name.split(" ")[1]} #${i + 1}`, jersey_number: String(i + 1), position: pos }));
  const { data: oppPlayers, error: opError } = await admin.from("opponent_players").insert(oppPlayerRows).select("id");
  if (opError) throw new Error(opError.message);
  opponents.push({ id: opp.id, name, players: oppPlayers });
}
const { data: upcomingOpponent } = await admin.from("opponents").insert({ team_id: teamId, name: UPCOMING_OPPONENT_NAME }).select("id").single();
console.log(`Created ${opponents.length} opponents + 1 upcoming-game opponent, with rosters.`);

// ---------------------------------------------------------------------------
// Games: 20 completed (10 full mode, 10 quick mode), ~4 losses, + 1 upcoming
// ---------------------------------------------------------------------------
const TOTAL_GAMES = 20;
const LOSS_GAME_INDEXES = new Set([3, 8, 13, 17]);
const FULL_MODE_INDEXES = new Set([0, 1, 3, 5, 7, 9, 11, 13, 15, 17]);
const PA_PER_GAME = 4; // every starter bats 4 times/game -> 80 PA/season (segments above sum to 70-80 as designed)

const gameDates = [];
let d = new Date("2026-03-07T00:00:00Z");
for (let i = 0; i < TOTAL_GAMES; i++) {
  gameDates.push(d.toISOString().slice(0, 10));
  d = new Date(d.getTime() + 7 * 24 * 60 * 60 * 1000);
}

const { data: season, error: seasonError } = await admin
  .from("seasons")
  .insert({ team_id: teamId, name: "2026 Demo Season", year: 2026, start_date: gameDates[0], end_date: gameDates[gameDates.length - 1] })
  .select("id")
  .single();
if (seasonError) throw new Error(seasonError.message);

const eli = byName.get("Eli Brooks");
const sam = byName.get("Sam Rivera");

let totalAtBatRows = 0;
let totalPitchRows = 0;
let totalStolenBaseRows = 0;
let totalGameEventRows = 0;
let totalSubstitutionRows = 0;
let weakZoneAB = 0;
let weakZoneHits = 0;
let weakZoneSwings = 0;
let weakZoneMisses = 0;

for (let gi = 0; gi < TOTAL_GAMES; gi++) {
  const opponent = opponents[gi % opponents.length];
  const isFullMode = FULL_MODE_INDEXES.has(gi);
  const isLoss = LOSS_GAME_INDEXES.has(gi);
  const homeAway = gi % 2 === 0 ? "home" : "away";
  const pitcherForGame = gi % 3 === 2 ? sam : eli;
  const confirmedAt = new Date(gameDates[gi] + "T19:00:00Z");

  const { data: game, error: gameError } = await admin
    .from("games")
    .insert({
      team_id: teamId,
      season_id: season.id,
      opponent_id: opponent.id,
      opponent_name: opponent.name,
      game_date: gameDates[gi],
      game_time: "18:00",
      game_type: "season",
      home_away: homeAway,
      status: "completed",
      umpire_name: "Umpire " + pick(["Rodriguez", "Jensen", "Patel", "O'Malley"]),
      logging_mode: isFullMode ? "full" : "quick",
      lineup_confirmed_at: new Date(gameDates[gi]).toISOString(),
    })
    .select("id")
    .single();
  if (gameError) throw new Error(gameError.message);
  const gameId = game.id;

  // Lineup: the same 10 starters every game (protects the Lineup
  // Analysis reliability score, which needs a consistent "current
  // lineup" to accumulate at-bats against), reserves on the bench.
  const lineupRows = [
    ...starters.map((p) => ({ game_id: gameId, player_id: p.id, batting_order: p.battingOrder, position: p.position, status: "starting" })),
    ...reserves.map((p) => ({ game_id: gameId, player_id: p.id, batting_order: null, position: null, status: "reserve" })),
  ];
  const { error: lineupError } = await admin.from("lineup").insert(lineupRows);
  if (lineupError) throw new Error(lineupError.message);

  let ourRuns = 0;
  const atBatRows = [];
  const pitchesByIndex = [];

  // Hitting-mode: each starter bats PA_PER_GAME times, cycling the
  // batting order across innings 1-7.
  let inning = 1;
  for (let round = 0; round < PA_PER_GAME; round++) {
    for (const slot of starters) {
      const { result, weak } = nextOutcomeFor(slot, isFullMode);
      const isOut = OUT_RESULTS.has(result);
      const isHit = HIT_RESULTS.has(result);
      const isAB = result !== "walk" && result !== "hbp";
      const rbi = isHit && rnd() < 0.3 ? 1 : 0;
      const runsScored = isHit && rnd() < 0.18 ? 1 : 0;
      if (runsScored) ourRuns += 1;
      const hitType = isAB ? hitTypeFor(result) : null;
      const coords = isAB ? fieldCoordsFor(result, slot.pullBiasX) : { x: null, y: null };

      atBatRows.push({
        game_id: gameId,
        player_id: slot.id,
        pitcher_id: null,
        mode: "hitting",
        inning,
        inning_half: homeAway === "home" ? "bottom" : "top",
        batting_order_position: slot.battingOrder,
        result,
        hit_type: hitType,
        field_x: coords.x,
        field_y: coords.y,
        rbi,
        runs_scored: runsScored,
        is_out: isOut,
        confirmed_at: confirmedAt.toISOString(),
      });

      if (isFullMode) {
        const pitches = weak ? buildPitches(result, WEAK_ZONE) : buildPitches(result, null);
        pitchesByIndex.push(pitches);
        if (weak) {
          weakZoneAB += isAB ? 1 : 0;
          if (isHit) weakZoneHits += 1;
          for (const pt of pitches) {
            if (pt.swing) {
              weakZoneSwings += 1;
              if (pt.outcome === "strike" || pt.outcome === "foul_tip") weakZoneMisses += 1;
            }
          }
        }
      } else {
        pitchesByIndex.push([]);
      }

      if ((result === "single" || result === "walk" || result === "hbp") && rnd() < slot.sbRate) {
        const { error } = await admin.from("stolen_bases").insert({ game_id: gameId, player_id: slot.id, inning });
        if (error) throw new Error(error.message);
        totalStolenBaseRows += 1;
      }
    }
    inning = Math.min(7, inning + 1);
  }

  // Pitching-mode: opponent batters vs. our pitcher for this game --
  // kept probabilistic (realism here doesn't need the deterministic
  // guarantees the hitting side needed).
  const pitchQuality = pitcherForGame.pitcherQuality;
  let runsAllowed = 0;
  for (let pa = 0; pa < 30; pa++) {
    const r = rnd();
    const kP = clamp(0.3 - pitchQuality * 0.2, 0.06, 0.4);
    const walkP = 0.06 + pitchQuality * 0.06;
    let result;
    if (r < walkP) result = "walk";
    else if (r < walkP + kP) result = "strikeout";
    else {
      const hitP = clamp(0.14 + pitchQuality * 0.32, 0.1, 0.55);
      if (rnd() < hitP) result = rnd() < 0.08 ? "hr" : rnd() < 0.2 ? "double" : "single";
      else result = pick(["groundout", "flyout", "lineout"]);
    }
    const isOut = OUT_RESULTS.has(result);
    const isHit = HIT_RESULTS.has(result);
    const isAB = result !== "walk";
    const givesRun = isHit && rnd() < 0.12 ? 1 : 0;
    runsAllowed += givesRun;
    const hitType = isAB ? hitTypeFor(result) : null;
    const coords = isAB ? fieldCoordsFor(result, null) : { x: null, y: null };
    atBatRows.push({
      game_id: gameId,
      player_id: null,
      pitcher_id: pitcherForGame.id,
      mode: "pitching",
      inning: Math.min(7, 1 + Math.floor(pa / 5)),
      inning_half: homeAway === "home" ? "top" : "bottom",
      batting_order_position: null,
      result,
      hit_type: hitType,
      field_x: coords.x,
      field_y: coords.y,
      rbi: 0,
      runs_scored: givesRun,
      is_out: isOut,
      confirmed_at: confirmedAt.toISOString(),
    });
    pitchesByIndex.push(isFullMode ? buildPitches(result, null) : []);
  }

  // Bulk-insert this game's at_bats in one call, then map the returned
  // ids back onto pitchesByIndex -- a single multi-row INSERT...RETURNING
  // preserves input order, verified below by the length check.
  const { data: insertedAtBats, error: atBatError } = await admin.from("at_bats").insert(atBatRows).select("id");
  if (atBatError) throw new Error(`Failed inserting at_bats for game ${gi + 1}: ${atBatError.message}`);
  if (insertedAtBats.length !== atBatRows.length) throw new Error(`at_bats insert count mismatch for game ${gi + 1}.`);
  totalAtBatRows += insertedAtBats.length;

  const allPitchRows = [];
  for (let i = 0; i < insertedAtBats.length; i++) {
    for (const p of pitchesByIndex[i]) allPitchRows.push({ at_bat_id: insertedAtBats[i].id, ...p });
  }
  if (allPitchRows.length) {
    const { error: pitchError } = await admin.from("pitches").insert(allPitchRows);
    if (pitchError) throw new Error(`Failed inserting pitches for game ${gi + 1}: ${pitchError.message}`);
    totalPitchRows += allPitchRows.length;
  }

  if (gi === 4) {
    await admin.from("game_events").insert({ game_id: gameId, inning: 4, inning_half: "bottom", event_type: "wild_pitch", note: "Wild pitch." });
    totalGameEventRows += 1;
  }
  if (gi === 9) {
    await admin.from("substitutions").insert({ game_id: gameId, player_out_id: byName.get("Blake Sanders").id, player_in_id: byName.get("Devon Price").id, reason: "defensive", inning: 6, inning_half: "bottom" });
    totalSubstitutionRows += 1;
    await admin.from("game_events").insert({ game_id: gameId, inning: 5, inning_half: "top", event_type: "passed_ball", note: "Passed ball." });
    totalGameEventRows += 1;
  }

  let opponentScore = runsAllowed;
  if (isLoss && opponentScore <= ourRuns) opponentScore = ourRuns + randInt(1, 3);
  if (!isLoss && opponentScore >= ourRuns) opponentScore = Math.max(0, ourRuns - randInt(1, 3));

  const { error: updError } = await admin
    .from("games")
    .update({ our_score: ourRuns, opponent_score: opponentScore, winning_pitcher_id: !isLoss ? pitcherForGame.id : null })
    .eq("id", gameId);
  if (updError) throw new Error(updError.message);

  console.log(`  Game ${gi + 1}/20 vs ${opponent.name} (${isFullMode ? "Full" : "Quick"} Mode, ${isLoss ? "L" : "W"} ${ourRuns}-${opponentScore})`);
}

console.log(`Created ${TOTAL_GAMES} completed games, ${totalAtBatRows} at_bats, ${totalPitchRows} pitches, ${totalStolenBaseRows} stolen_bases, ${totalGameEventRows} game_events, ${totalSubstitutionRows} substitutions.`);

// ---------------------------------------------------------------------------
// Upcoming game: empty, locked lineup, ready for Quick or Full Mode
// ---------------------------------------------------------------------------
const upcomingDate = new Date(gameDates[gameDates.length - 1]);
upcomingDate.setDate(upcomingDate.getDate() + 7);
const { data: upcomingGame, error: upcomingError } = await admin
  .from("games")
  .insert({
    team_id: teamId,
    season_id: season.id,
    opponent_id: upcomingOpponent.id,
    opponent_name: UPCOMING_OPPONENT_NAME,
    game_date: upcomingDate.toISOString().slice(0, 10),
    game_time: "18:00",
    game_type: "season",
    home_away: "home",
    status: "setup",
    umpire_name: "Umpire Garcia",
    lineup_confirmed_at: new Date().toISOString(),
  })
  .select("id")
  .single();
if (upcomingError) throw new Error(upcomingError.message);
const upcomingLineupRows = [
  ...starters.map((p) => ({ game_id: upcomingGame.id, player_id: p.id, batting_order: p.battingOrder, position: p.position, status: "starting" })),
  ...reserves.map((p) => ({ game_id: upcomingGame.id, player_id: p.id, batting_order: null, position: null, status: "reserve" })),
];
await admin.from("lineup").insert(upcomingLineupRows);
console.log(`Created 1 upcoming game (status=setup, lineup locked, logging_mode left unset -- the operator picks Quick or Full Mode at Start Game, same as any real game).`);

// ---------------------------------------------------------------------------
// Verification: isolation, and the weak-zone heat map report
// ---------------------------------------------------------------------------
const whiffRate = weakZoneSwings > 0 ? weakZoneMisses / weakZoneSwings : null;
const weakZoneAvg = weakZoneAB > 0 ? weakZoneHits / weakZoneAB : null;

console.log("\n=== Isolation check ===");
const anon = createClient(url, anonKey);
const { error: signInError } = await anon.auth.signInWithPassword({ email: DEMO_EMAIL, password });
if (signInError) {
  console.error(`Could not sign in as the demo coach to verify isolation: ${signInError.message}`);
} else {
  const { data: ownPlayers } = await anon.from("players").select("id").eq("team_id", teamId);
  const { data: lionsPlayers } = await anon.from("players").select("id").eq("team_id", "63111c5c-4af6-40af-91ad-671ff3ae8d75");
  const { data: practicePlayers } = await anon.from("players").select("id").eq("team_id", "ebf554cd-e0d9-421e-9043-e31f593633fe");
  console.log(`  Demo coach session can read ${ownPlayers?.length ?? 0} of its own players.`);
  console.log(`  Demo coach session reading Lions' players returns: ${lionsPlayers?.length ?? 0} rows (RLS should make this 0).`);
  console.log(`  Demo coach session reading Practice Team's players returns: ${practicePlayers?.length ?? 0} rows (RLS should make this 0).`);
  console.log("  Since every team-scoped table uses the identical `team_id = my_team_id()` RLS policy, this same enforcement");
  console.log("  symmetrically prevents the Lions'/Practice Team's own sessions from reading the demo team's rows.");
  await anon.auth.signOut();
}

console.log("\n=== Summary ===");
console.log(`Team: ${DEMO_TEAM_NAME} (${teamId})`);
console.log(`Coach login: ${DEMO_EMAIL}`);
console.log(`Password (shown once, not stored anywhere): ${password}`);
console.log(`Players: ${playerRows.length} | Opponents: ${opponents.length} (+1 for the upcoming game) | Season games: ${TOTAL_GAMES} | Upcoming games: 1`);
console.log(`At-bats: ${totalAtBatRows} | Pitches: ${totalPitchRows} | Stolen bases: ${totalStolenBaseRows}`);
console.log(`\nDerek Foster's weak zone (Middle-Outside, zone_x~80/zone_y~50, fastballs):`);
console.log(`  At-bats ending there: ${weakZoneAB}, average there: ${weakZoneAvg !== null ? weakZoneAvg.toFixed(3) : "n/a"}`);
console.log(`  Swings there: ${weakZoneSwings}, swing-and-miss rate there: ${whiffRate !== null ? (whiffRate * 100).toFixed(0) + "%" : "n/a"}`);

console.log(`\nSuggested coach-AI questions for this team:`);
for (const q of [
  "Who's hot and who's cold on this roster right now?",
  "Where should Derek Foster expect to see pitches he struggles with?",
  "Who leads the team in stolen bases, and how efficient are they?",
  "Which hitters pull the ball, and which go the other way?",
  "Who's our most reliable bat against fastballs?",
  "What does the lineup analysis say about batting order 1 through 10 for the next game?",
]) {
  console.log(`  - ${q}`);
}

console.log("\nNote: this app's /login page only offers Google Sign-In -- there is no email/password form anywhere in the UI.");
console.log("The password above is a real Supabase Auth credential, but it can't be used to sign in through the live app as-is.");
