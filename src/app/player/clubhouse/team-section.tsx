import { formatGameDate } from "@/lib/dates";
import { resultLetter } from "@/lib/opponent-history";
import { computeBattingLines, computePitchingLines } from "@/lib/stats";
import { computeEpsForRoster } from "@/lib/eps";
import { buildLeaderRows } from "@/lib/leader-stats";
import { countTeamGames } from "@/lib/leader-qualification";
import { TeamLeadersBoard } from "@/components/team-leaders-board";
import type { Database } from "@/lib/supabase/types";

type Game = Database["public"]["Tables"]["games"]["Row"];
type Player = Database["public"]["Tables"]["players"]["Row"];
type AtBat = Database["public"]["Tables"]["at_bats"]["Row"];
type StolenBase = Database["public"]["Tables"]["stolen_bases"]["Row"];
type GameEvent = Pick<Database["public"]["Tables"]["game_events"]["Row"], "event_type" | "player_id" | "game_id">;

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
  const battingLines = computeBattingLines(hitting, stolenBases);
  const pitchingLines = computePitchingLines(pitching, games);
  const epsLines = computeEpsForRoster(players.map((p) => p.id), hitting, gameEvents);
  // No filters on this board (unlike the coach's), so "team games" is
  // just every completed game in the full set passed in.
  const teamGames = countTeamGames(games);
  const rows = buildLeaderRows(players, battingLines, pitchingLines, epsLines, teamGames);

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
    </section>
  );
}
