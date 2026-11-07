import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { lionsDisplayName, opponentDisplayName } from "@/lib/live/names";
import {
  narrateAtBatResult,
  narrateDoublePlay,
  narrateGameEvent,
  narrateRun,
  narrateRunWithContext,
  narrateStolenBase,
  narrateSubstitution,
} from "@/lib/live/narration";
import { isRateLimited } from "@/lib/live/rate-limit";
import type { AtBatMode, Runners } from "@/lib/supabase/types";

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
  // Live stadium batch: set only on a stolen-base entry -- the API has
  // no historical runners snapshot to compare against (only the current
  // one), so it can never say which base itself; the client diffs this
  // player's base across two successive polls instead and upgrades the
  // text once it can. See narration.ts's own comment (gap #1).
  stolenBasePlayerId?: string;
  stolenBaseRunnerName?: string;
  // Live stadium batch: set only on an at-bat entry with a saved field
  // tap -- lets the client animate the ball's trajectory and, for a
  // caught fly/line/foul out, place the fielder's circle. hitType is
  // null for every Quick Mode ball in play (no hit-type picker there),
  // which the client's trajectory code already treats as "use a generic
  // arc," not a missing-data error.
  fieldX?: number | null;
  fieldY?: number | null;
  hitType?: string | null;
  // True only for a flyout/lineout (foul outs are stored as "flyout" too
  // -- see CLAUDE.md) with a saved dot -- lets the client show the
  // fielder catching the ball at that dot and burst the batter, instead
  // of exposing the raw `result` enum just for this one check.
  isCaughtBall?: boolean;
  // True only when result is "hr" -- needed alongside hitType, not
  // instead of it, because Quick Mode's own "HR" button logs hitType
  // null (see quick-mode-grid.tsx) even though result is "hr"; the
  // trajectory's "home run highest" style has to key off this, the same
  // reason src/lib/heat-map.ts's lineHitCategory checks result first.
  isHomeRun?: boolean;
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
      .select("id, player_id, mode, result, field_x, field_y, hit_type, runs_scored, is_out, created_at")
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

  // Live stadium batch: score-aware narration ("Lions take the lead!",
  // "Tied up!") needs to know the score margin immediately BEFORE a run
  // crossed the plate, not just the final total -- but this route has no
  // historical score snapshots, only the two running totals on `games`.
  // Reliably reconstructing every past run's own before/after margin
  // would mean replaying the WHOLE game's scoring in order, and knowing
  // which side a game_events-sourced run belongs to isn't actually
  // possible from the stored columns (game_events has no `mode` column
  // -- see actions.ts's logGameEvent, which only uses mode transiently
  // to decide which score column to bump, never persists it). Scoped
  // down to what's both correct and knowable: only the SINGLE most
  // recent scoring play in the whole feed gets the score-aware treatment
  // (its "before" margin is just the current margin minus its own
  // contribution, since nothing has scored since), and only when that
  // play was an at-bat (whose `mode` IS reliably known) -- every older
  // or game-events-sourced run keeps the plain, still-energetic generic
  // line instead of a guess.
  type ScoringUnit = { id: string; ts: string; mode: AtBatMode | null; runs: number };
  const scoringUnits: ScoringUnit[] = [];
  for (const ab of atBats ?? []) {
    if (ab.runs_scored > 0) scoringUnits.push({ id: `ab-${ab.id}`, ts: ab.created_at, mode: ab.mode, runs: ab.runs_scored });
  }
  for (const ev of gameEvents ?? []) {
    if (ev.runs_scored > 0) scoringUnits.push({ id: `ev-${ev.id}`, ts: ev.created_at, mode: null, runs: ev.runs_scored });
  }
  scoringUnits.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  const newestScoring = scoringUnits[0];
  const marginAfterFinal = game.our_score - game.opponent_score;
  const scoreContext =
    newestScoring?.mode
      ? {
          unitId: newestScoring.id,
          marginBefore: newestScoring.mode === "hitting" ? marginAfterFinal - newestScoring.runs : marginAfterFinal + newestScoring.runs,
          marginAfter: marginAfterFinal,
        }
      : null;

  // Live stadium batch: a double/triple play is 2-3 at_bats rows
  // sharing result "double_play" (see CLAUDE.md's "two rows, not one"
  // note -- a triple play adds a third), all inserted within the same
  // server-action call a few ms apart. Narrated ONCE per real play, not
  // once per row, by grouping rows whose created_at falls within 3s of
  // the previous row in the same group (ordered ascending first so the
  // grouping only ever looks at adjacent-in-time rows).
  const dpRows = (atBats ?? [])
    .filter((ab) => ab.result === "double_play")
    .slice()
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const dpGroups: (typeof dpRows)[number][][] = [];
  for (const row of dpRows) {
    const lastGroup = dpGroups[dpGroups.length - 1];
    const lastRow = lastGroup?.[lastGroup.length - 1];
    if (lastRow && Math.abs(new Date(row.created_at).getTime() - new Date(lastRow.created_at).getTime()) <= 3000) {
      lastGroup.push(row);
    } else {
      dpGroups.push([row]);
    }
  }
  const dpRowIds = new Set(dpRows.map((r) => r.id));
  for (const group of dpGroups) {
    const latest = group[group.length - 1];
    entries.push({
      id: `dp-${group[0].id}`,
      text: narrateDoublePlay({ id: group[0].id, mode: group[0].mode, isTriplePlay: group.length >= 3 }),
      ts: latest.created_at,
    });
  }

  for (const ab of atBats ?? []) {
    if (!dpRowIds.has(ab.id)) {
      const batterName = ab.mode === "hitting" ? ourName(ab.player_id) ?? "Lions" : opponentDisplayName(hasOpponentRoster, null, null);
      const text = narrateAtBatResult({ id: ab.id, batterName, result: ab.result, fieldX: ab.field_x });
      const isCaughtBall = (ab.result === "flyout" || ab.result === "lineout") && ab.field_x !== null && ab.field_y !== null;
      if (text) {
        entries.push({
          id: `ab-${ab.id}`,
          text,
          ts: ab.created_at,
          fieldX: ab.field_x,
          fieldY: ab.field_y,
          hitType: ab.hit_type,
          isCaughtBall,
          isHomeRun: ab.result === "hr",
        });
      }
    }
    const unitId = `ab-${ab.id}`;
    for (let i = 0; i < ab.runs_scored; i++) {
      const runId = `${unitId}-run-${i}`;
      const useContext = scoreContext && scoreContext.unitId === unitId && i === ab.runs_scored - 1;
      const text = useContext ? narrateRunWithContext(runId, scoreContext.marginBefore, scoreContext.marginAfter) : narrateRun(runId);
      entries.push({ id: runId, text, ts: ab.created_at });
    }
  }

  for (const sb of stolenBases ?? []) {
    const runnerName = ourName(sb.player_id) ?? "Lions";
    entries.push({
      id: `sb-${sb.id}`,
      text: narrateStolenBase(`sb-${sb.id}`, runnerName),
      ts: sb.created_at,
      stolenBasePlayerId: sb.player_id ?? undefined,
      stolenBaseRunnerName: runnerName,
    });
  }

  for (const sub of substitutions ?? []) {
    const inName = ourName(sub.player_in_id) ?? "Sub";
    const outName = ourName(sub.player_out_id) ?? "Player";
    entries.push({ id: `sub-${sub.id}`, text: narrateSubstitution(`sub-${sub.id}`, inName, outName), ts: sub.created_at });
  }

  const OUR_RUNNER_OUT_EVENTS = new Set(["caught_stealing", "pickoff_out", "rundown_out", "out_at_next_base", "tag_up_violation"]);
  for (const ev of gameEvents ?? []) {
    const subjectName = ev.player_id ? ourName(ev.player_id) : opponentName(ev.opponent_player_id);
    const text = narrateGameEvent(`ev-${ev.id}`, ev.event_type, subjectName);
    if (text) {
      entries.push({
        id: `ev-${ev.id}`,
        text,
        ts: ev.created_at,
        outPlayerId: ev.player_id && OUR_RUNNER_OUT_EVENTS.has(ev.event_type) ? ev.player_id : undefined,
      });
    }
    const unitId = `ev-${ev.id}`;
    for (let i = 0; i < ev.runs_scored; i++) {
      const runId = `${unitId}-run-${i}`;
      entries.push({ id: runId, text: narrateRun(runId), ts: ev.created_at });
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
