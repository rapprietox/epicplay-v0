"use client";

// Hotfix: this file builds and passes an inline function
// (getPlayerHref) as a prop to TeamLeadersBoard, a Client Component.
// React Server Components cannot serialize a function prop across the
// server->client boundary -- without "use client" here, this file is
// itself a Server Component by default, and that function prop throws
// at render time ("a server-side exception has occurred") on every
// request to /player/clubhouse. The coach board never hit this because
// src/app/coach/leaders-board.tsx already has its own "use client" --
// its function prop to the same TeamLeadersBoard is a client-to-client
// pass, which is fine. This file has no hooks of its own, so the fix
// is just restoring the directive, not restructuring anything.
import { formatGameDate } from "@/lib/dates";
import { resultLetter } from "@/lib/opponent-history";
import { computeBattingLines, computePitchingLines } from "@/lib/stats";
import { computeEpsForRoster } from "@/lib/eps";
import { buildLeaderRows } from "@/lib/leader-stats";
import { countTeamGames, isRateQualified, MIN_PA_PER_TEAM_GAME } from "@/lib/leader-qualification";
import { TeamLeadersBoard } from "@/components/team-leaders-board";
import { TeamHittingTable, type HittingTableRow } from "@/components/team-hitting-table";
import type { Database } from "@/lib/supabase/types";

type Game = Database["public"]["Tables"]["games"]["Row"];
type Player = Database["public"]["Tables"]["players"]["Row"];
type AtBat = Database["public"]["Tables"]["at_bats"]["Row"];
type StolenBase = Database["public"]["Tables"]["stolen_bases"]["Row"];
type GameEvent = Pick<
  Database["public"]["Tables"]["game_events"]["Row"],
  "event_type" | "player_id" | "game_id" | "scorer_player_id" | "runs_scored"
>;

const TEAM_TOTAL_ID = "__team_total__";

interface Props {
  games: Game[];
  players: Player[];
  atBats: AtBat[];
  stolenBases: StolenBase[];
  gameEvents: GameEvent[];
  viewerPlayerId: string;
}

// Player team-view batch + same-cards batch: a read-only mirror of
// three pieces of the coach dashboard (Team Leaders board, Last Game
// card, season schedule + record) for the player's own Clubhouse. The
// Team Leaders board itself (stat list, qualification, card grid,
// ranking modal) now comes entirely from src/lib/leader-stats.ts +
// src/components/team-leaders-board.tsx, shared verbatim with
// src/app/coach/leaders-board.tsx -- the two boards can no longer show
// different cards or different leaders for the same data. This file
// only owns the Last Game card and the schedule, which have no coach
// equivalent worth sharing (the coach's own ScheduleTable has edit/
// cancel/add-game actions a read-only player view has no business
// linking to).
export function TeamSection({ games, players, atBats, stolenBases, gameEvents, viewerPlayerId }: Props) {
  const hitting = atBats.filter((ab) => ab.mode === "hitting");
  const pitching = atBats.filter((ab) => ab.mode === "pitching");
  // Hitting-table batch: scoringEvents (3rd arg) so Runs/R matches the
  // coach dashboard's own call, not just at_bats.runs_scored.
  const battingLines = computeBattingLines(hitting, stolenBases, gameEvents);
  const pitchingLines = computePitchingLines(pitching, games);
  const epsLines = computeEpsForRoster(players.map((p) => p.id), hitting, gameEvents);
  // No filters on this board (unlike the coach's), so "team games" is
  // just every completed game in the full set passed in.
  const teamGames = countTeamGames(games);
  const rows = buildLeaderRows(players, battingLines, pitchingLines, epsLines, teamGames);

  // Full hitting table batch: read-only mirror of the coach's "Team
  // Hitting" table, same rules (qualification, totals row via the same
  // sentinel-remap trick), no facet filters -- same "no filters on this
  // board" precedent as the Team Leaders mirror just above.
  const gamesPlayedByPlayer = new Map<string, Set<string>>();
  for (const ab of hitting) {
    if (!ab.player_id) continue;
    let set = gamesPlayedByPlayer.get(ab.player_id);
    if (!set) {
      set = new Set();
      gamesPlayedByPlayer.set(ab.player_id, set);
    }
    set.add(ab.game_id);
  }
  const csByPlayer = new Map<string, number>();
  for (const e of gameEvents) {
    if (e.event_type !== "caught_stealing" || !e.player_id) continue;
    csByPlayer.set(e.player_id, (csByPlayer.get(e.player_id) ?? 0) + 1);
  }
  const hittingRows: HittingTableRow[] = players.map((p) => {
    const line = battingLines.get(p.id);
    const pa = line?.pa ?? 0;
    return {
      playerId: p.id,
      playerName: p.name,
      playerJersey: p.jersey_number,
      g: gamesPlayedByPlayer.get(p.id)?.size ?? 0,
      pa,
      ab: line?.ab ?? 0,
      r: line?.runsScored ?? 0,
      h: line?.h ?? 0,
      doubles: line?.doubles ?? 0,
      triples: line?.triples ?? 0,
      hr: line?.hr ?? 0,
      rbi: line?.rbi ?? 0,
      bb: line?.bb ?? 0,
      k: line?.k ?? 0,
      sb: line?.sb ?? 0,
      cs: csByPlayer.get(p.id) ?? 0,
      avg: line?.avg ?? 0,
      obp: line?.obp ?? 0,
      slg: line?.slg ?? 0,
      ops: line?.ops ?? 0,
      qualified: isRateQualified("pa", pa, teamGames),
    };
  });
  const teamHitting = hitting.map((ab) => ({ ...ab, player_id: TEAM_TOTAL_ID }));
  const teamStolenBases = stolenBases.map((sb) => ({ ...sb, player_id: TEAM_TOTAL_ID }));
  const teamScoringEvents = gameEvents.map((e) => ({ ...e, scorer_player_id: e.scorer_player_id ? TEAM_TOTAL_ID : e.scorer_player_id }));
  const teamLine = computeBattingLines(teamHitting, teamStolenBases, teamScoringEvents).get(TEAM_TOTAL_ID);
  let totalCs = 0;
  for (const v of Array.from(csByPlayer.values())) totalCs += v;
  const hittingTotals: HittingTableRow = {
    playerId: TEAM_TOTAL_ID,
    playerName: "Team Total",
    playerJersey: null,
    g: teamGames,
    pa: teamLine?.pa ?? 0,
    ab: teamLine?.ab ?? 0,
    r: teamLine?.runsScored ?? 0,
    h: teamLine?.h ?? 0,
    doubles: teamLine?.doubles ?? 0,
    triples: teamLine?.triples ?? 0,
    hr: teamLine?.hr ?? 0,
    rbi: teamLine?.rbi ?? 0,
    bb: teamLine?.bb ?? 0,
    k: teamLine?.k ?? 0,
    sb: teamLine?.sb ?? 0,
    cs: totalCs,
    avg: teamLine?.avg ?? 0,
    obp: teamLine?.obp ?? 0,
    slg: teamLine?.slg ?? 0,
    ops: teamLine?.ops ?? 0,
    qualified: true,
  };

  const completed = games.filter((g) => g.status === "completed");
  const wins = completed.filter((g) => g.our_score > g.opponent_score).length;
  const losses = completed.filter((g) => g.our_score < g.opponent_score).length;
  const ties = completed.length - wins - losses;
  const record = `${wins}-${losses}${ties > 0 ? `-${ties}` : ""}`;

  const lastGame = [...completed].sort((a, b) => b.game_date.localeCompare(a.game_date))[0] ?? null;
  const upcomingAndPast = [...games].sort((a, b) => a.game_date.localeCompare(b.game_date));

  return (
    <section className="flex flex-col gap-4">
      <div className="rounded-md border border-accent-amber/30 bg-accent-amber/5 px-4 py-2 text-center text-xs text-accent-amber">
        Stats are updated after each game and may be corrected as we finish setting up.
      </div>

      {lastGame && (
        <section className="glossy rounded-lg border border-border bg-surface p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-primary">Last Game</p>
          <h2 className="font-heading mt-2 text-xl font-bold text-white">
            vs {lastGame.opponent_name} — {formatGameDate(lastGame.game_date)}
          </h2>
          <p className="mt-1 text-sm text-foreground/60">
            {lastGame.our_score}&ndash;{lastGame.opponent_score}
            {(() => {
              const r = resultLetter(lastGame);
              return r ? (
                <span className={`ml-2 font-heading font-semibold ${r === "W" ? "text-accent-green" : r === "L" ? "text-accent-red" : "text-foreground/60"}`}>{r}</span>
              ) : null;
            })()}
          </p>
        </section>
      )}

      <section className="glossy rounded-lg border border-border bg-surface p-5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-primary">Season Schedule</p>
          <p className="text-sm font-semibold text-accent-gold">Record: {record}</p>
        </div>
        <ul className="mt-3 flex flex-col divide-y divide-border">
          {upcomingAndPast.map((g) => {
            const r = resultLetter(g);
            return (
              <li key={g.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="text-foreground/70">
                  {formatGameDate(g.game_date)} · {g.home_away === "home" ? "vs" : "@"} {g.opponent_name}
                </span>
                <span className="font-mono text-xs text-foreground/50">
                  {g.status === "completed" ? (
                    <>
                      {g.our_score}&ndash;{g.opponent_score}{" "}
                      <span className={r === "W" ? "text-accent-green" : r === "L" ? "text-accent-red" : "text-foreground/60"}>{r}</span>
                    </>
                  ) : g.status === "cancelled" ? (
                    "Cancelled"
                  ) : (
                    g.game_time ?? "TBD"
                  )}
                </span>
              </li>
            );
          })}
          {upcomingAndPast.length === 0 && <li className="py-2 text-sm text-foreground/40">No games on the schedule yet.</li>}
        </ul>
      </section>

      <section className="glossy rounded-lg border border-accent-gold/30 bg-surface p-5">
        <h2 className="font-heading text-xl font-bold uppercase tracking-wide text-accent-gold">Team Leaders</h2>
        <div className="mt-4">
          <TeamLeadersBoard rows={rows} getPlayerHref={(id) => (id === viewerPlayerId ? "/player/clubhouse" : null)} />
        </div>
      </section>

      <section className="glossy rounded-lg border border-accent-gold/30 bg-surface p-5">
        <h2 className="font-heading text-xl font-bold uppercase tracking-wide text-accent-gold">Team Hitting</h2>
        <div className="mt-4">
          <TeamHittingTable
            rows={hittingRows}
            totals={hittingTotals}
            getPlayerHref={(id) => (id === viewerPlayerId ? "/player/clubhouse" : null)}
            minPaPerTeamGame={MIN_PA_PER_TEAM_GAME}
            teamGames={teamGames}
          />
        </div>
      </section>
    </section>
  );
}
