import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { lionsDisplayName, opponentDisplayName } from "@/lib/live/names";
import { narrateAtBatResult, narrateGameEvent, narrateRun, narrateStolenBase, narrateSubstitution } from "@/lib/live/narration";
import { isRateLimited } from "@/lib/live/rate-limit";
import type { Runners } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

// How far back the narration feed looks, across at_bats + stolen_bases +
// substitutions + game_events combined -- plenty for "newest on top"
// broadcast flavor, not a full game history endpoint.
const NARRATION_LIMIT = 30;

function clientIp(): string {
  const h = headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return h.get("x-real-ip") ?? "unknown";
}

// One shape for "this token doesn't resolve to a live game right now" --
// used identically whether the token was never real or was a real one
// that's since been disabled/rotated (both cases are, at the DB level,
// just "no games row has this share_token"), per the request's "same
// empty answer for a wrong or disabled token."
function notFoundResponse() {
  return NextResponse.json({ found: false as const });
}

type NarrationEntry = {
  id: string;
  text: string;
  ts: string;
  // Set only for the handful of game_events types that identify exactly
  // which of OUR OWN players was put out while on base (caught
  // stealing, picked off, run down, out advancing, out on appeal) --
  // lets the client burst that runner's dot instead of just letting it
  // silently vanish. Left unset for every other narration kind,
  // including an opponent runner's out (see narration.ts's own
  // comment on why that correlation isn't attempted here).
  outPlayerId?: string;
};

export async function GET(_request: NextRequest, { params }: { params: { token: string } }) {
  const ip = clientIp();
  if (isRateLimited(ip)) {
    return NextResponse.json({ found: false as const, error: "rate_limited" }, { status: 429 });
  }

  const token = params.token;
  if (!token) return notFoundResponse();

  const supabase = createServiceRoleClient();

  const { data: game, error: gameError } = await supabase
    .from("games")
    .select("id, team_id, opponent_id, opponent_name, status, our_score, opponent_score, home_away, game_date")
    .eq("share_token", token)
    .maybeSingle();

  // A real query failure (e.g. the migration adding share_token hasn't
  // been applied yet) is NOT the same thing as "no game has this
  // token" -- logged for operators, but the public response body stays
  // identically uninformative either way, just with a 500 instead of a
  // normal 200 so monitoring can tell the two apart without the client
  // being able to.
  if (gameError) {
    console.error("[api/live] games lookup failed", gameError);
    return NextResponse.json({ found: false as const }, { status: 500 });
  }

  // Deliberately the exact same response whether the token never
  // existed or belonged to a game whose link has since been turned off
  // / rotated -- both are just "no row has this token" at this point.
  if (!game) return notFoundResponse();

  const [{ data: team }, { data: gameState }, { data: opponentRoster }] = await Promise.all([
    supabase.from("teams").select("name").eq("id", game.team_id).single(),
    supabase.from("game_state").select("inning, inning_half, outs, mode, runners, current_at_bat_id").eq("game_id", game.id).maybeSingle(),
    game.opponent_id ? supabase.from("opponent_players").select("id, name, jersey_number").eq("opponent_id", game.opponent_id) : Promise.resolve({ data: [] }),
  ]);

  const hasOpponentRoster = (opponentRoster ?? []).length > 0;
  const opponentPlayerById = new Map((opponentRoster ?? []).map((p) => [p.id, p]));

  const [{ data: players }, { data: atBats }, { data: stolenBases }, { data: substitutions }, { data: gameEvents }, { data: currentAtBat }] = await Promise.all([
    supabase.from("players").select("id, name, walk_up_song").eq("team_id", game.team_id),
    supabase
      .from("at_bats")
      .select("id, player_id, mode, result, field_x, runs_scored, is_out, created_at")
      .eq("game_id", game.id)
      .not("confirmed_at", "is", null)
      .order("created_at", { ascending: false })
      .limit(NARRATION_LIMIT),
    supabase.from("stolen_bases").select("id, player_id, created_at").eq("game_id", game.id).order("created_at", { ascending: false }).limit(NARRATION_LIMIT),
    supabase.from("substitutions").select("id, player_out_id, player_in_id, created_at").eq("game_id", game.id).order("created_at", { ascending: false }).limit(NARRATION_LIMIT),
    supabase
      .from("game_events")
      .select("id, event_type, player_id, opponent_player_id, runs_scored, created_at")
      .eq("game_id", game.id)
      .neq("event_type", "substitution")
      .order("created_at", { ascending: false })
      .limit(NARRATION_LIMIT),
    gameState?.current_at_bat_id
      ? supabase.from("at_bats").select("player_id, mode").eq("id", gameState.current_at_bat_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const playerById = new Map((players ?? []).map((p) => [p.id, p]));
  function ourName(playerId: string | null): string | null {
    const p = playerId ? playerById.get(playerId) : null;
    return p ? lionsDisplayName(p.name) : null;
  }
  function opponentName(opponentPlayerId: string | null): string | null {
    if (!opponentPlayerId) return null;
    const p = opponentPlayerById.get(opponentPlayerId);
    return opponentDisplayName(hasOpponentRoster, p?.name ?? null, p?.jersey_number ?? null);
  }

  const entries: NarrationEntry[] = [];

  for (const ab of atBats ?? []) {
    const batterName = ab.mode === "hitting" ? ourName(ab.player_id) ?? "Lions" : opponentDisplayName(hasOpponentRoster, null, null);
    const text = narrateAtBatResult({ batterName, result: ab.result, fieldX: ab.field_x });
    if (text) entries.push({ id: `ab-${ab.id}`, text, ts: ab.created_at });
    for (let i = 0; i < ab.runs_scored; i++) {
      entries.push({ id: `ab-${ab.id}-run-${i}`, text: narrateRun(), ts: ab.created_at });
    }
  }

  for (const sb of stolenBases ?? []) {
    const runnerName = ourName(sb.player_id) ?? "Lions";
    entries.push({ id: `sb-${sb.id}`, text: narrateStolenBase(runnerName), ts: sb.created_at });
  }

  for (const sub of substitutions ?? []) {
    const inName = ourName(sub.player_in_id) ?? "Sub";
    const outName = ourName(sub.player_out_id) ?? "Player";
    entries.push({ id: `sub-${sub.id}`, text: narrateSubstitution(inName, outName), ts: sub.created_at });
  }

  const OUR_RUNNER_OUT_EVENTS = new Set(["caught_stealing", "pickoff_out", "rundown_out", "out_at_next_base", "tag_up_violation"]);
  for (const ev of gameEvents ?? []) {
    const subjectName = ev.player_id ? ourName(ev.player_id) : opponentName(ev.opponent_player_id);
    const text = narrateGameEvent(ev.event_type, subjectName);
    if (text) {
      entries.push({
        id: `ev-${ev.id}`,
        text,
        ts: ev.created_at,
        outPlayerId: ev.player_id && OUR_RUNNER_OUT_EVENTS.has(ev.event_type) ? ev.player_id : undefined,
      });
    }
    for (let i = 0; i < ev.runs_scored; i++) {
      entries.push({ id: `ev-${ev.id}-run-${i}`, text: narrateRun(), ts: ev.created_at });
    }
  }

  entries.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  const narration = entries.slice(0, NARRATION_LIMIT);

  const runners = (gameState?.runners ?? {}) as Runners;
  function displayRunner(r: Runners["first"]) {
    if (!r) return null;
    const label = r.type === "player" ? lionsDisplayName(r.name) : opponentDisplayName(hasOpponentRoster, r.name, r.jersey ?? null);
    return { key: `${r.type}:${r.id ?? r.name}`, label, jersey: r.jersey ?? null };
  }

  // Current batter -- only ever resolvable for our own hitting-mode
  // batter (a real players.id); an opponent batter's identity is never
  // persisted (see narration.ts's own comment), so that case just
  // shows a generic label and no walk-up song. Walk-up song is text
  // only in this phase, per the request -- no audio.
  let currentBatterName: string | null = null;
  let currentBatterWalkUpSong: string | null = null;
  if (currentAtBat?.mode === "hitting" && currentAtBat.player_id) {
    const p = playerById.get(currentAtBat.player_id);
    if (p) {
      currentBatterName = lionsDisplayName(p.name);
      currentBatterWalkUpSong = p.walk_up_song;
    }
  } else if (currentAtBat?.mode === "pitching") {
    currentBatterName = opponentDisplayName(hasOpponentRoster, null, null);
  }

  return NextResponse.json({
    found: true as const,
    status: game.status,
    teamName: team?.name ?? "Lions",
    opponentName: game.opponent_name,
    homeAway: game.home_away,
    gameDate: game.game_date,
    ourScore: game.our_score,
    opponentScore: game.opponent_score,
    inning: gameState?.inning ?? 1,
    inningHalf: gameState?.inning_half ?? "top",
    outs: gameState?.outs ?? 0,
    mode: gameState?.mode ?? "hitting",
    runners: {
      first: displayRunner(runners.first ?? null),
      second: displayRunner(runners.second ?? null),
      third: displayRunner(runners.third ?? null),
    },
    currentBatterName,
    currentBatterWalkUpSong,
    narration,
    updatedAt: new Date().toISOString(),
  });
}
