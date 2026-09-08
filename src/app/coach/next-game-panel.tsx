import Link from "next/link";
import type { Database } from "@/lib/supabase/types";
import { daysUntil, formatGameDate } from "@/lib/dates";
import { recordAgainstOpponent, formatRecord } from "@/lib/opponent-history";
import { computeBattingLines, formatAvg } from "@/lib/stats";
import { generateOpponentInsight } from "@/lib/anthropic";

type Game = Database["public"]["Tables"]["games"]["Row"];
type AtBat = Database["public"]["Tables"]["at_bats"]["Row"];
type Player = Database["public"]["Tables"]["players"]["Row"];

export async function NextGamePanel({
  nextGame,
  activeGame,
  allGames,
  atBats,
  players,
}: {
  nextGame: Game | null;
  activeGame: Game | null;
  allGames: Game[];
  atBats: AtBat[];
  players: Player[];
}) {
  if (activeGame) {
    return (
      <section className="glossy rounded-lg border border-accent-green/50 bg-surface p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent-green">
              <span className="h-2 w-2 animate-pulse rounded-full bg-accent-green" /> Live
            </p>
            <h2 className="font-heading mt-1 text-3xl font-bold text-white">vs {activeGame.opponent_name}</h2>
            <p className="mt-1 text-sm text-foreground/60">
              {activeGame.our_score}&ndash;{activeGame.opponent_score}
            </p>
          </div>
          <Link
            href={`/operator?game=${activeGame.id}`}
            className="shrink-0 rounded-md bg-accent-green px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-green/90"
          >
            Continue Game
          </Link>
        </div>
      </section>
    );
  }

  if (!nextGame) {
    return (
      <section className="glossy rounded-lg border border-border bg-surface p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-amber">
          Next Game
        </p>
        <p className="mt-3 text-sm text-foreground/50">
          No upcoming games scheduled. Import or add a season to get started.
        </p>
      </section>
    );
  }

  const record = recordAgainstOpponent(allGames, nextGame);
  const days = daysUntil(nextGame.game_date);
  const daysLabel = days === 0 ? "Today" : days === 1 ? "Tomorrow" : days > 0 ? `${days} days away` : `${-days}d ago`;

  const pastGameIds = new Set(
    allGames
      .filter(
        (g) =>
          g.status === "completed" &&
          (g.opponent_id ? g.opponent_id === nextGame.opponent_id : g.opponent_name === nextGame.opponent_name)
      )
      .map((g) => g.id)
  );

  const insight = await buildInsight(nextGame, allGames, atBats, players, pastGameIds);

  return (
    <section className="glossy rounded-lg border border-accent-amber/40 bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-amber">
            Next Game &middot; {daysLabel}
          </p>
          <h2 className="font-heading mt-1 text-3xl font-bold text-white">
            vs {nextGame.opponent_name}
          </h2>
          <p className="mt-1 text-sm text-foreground/60">
            {formatGameDate(nextGame.game_date)}
            {nextGame.game_time ? ` · ${nextGame.game_time}` : ""} ·{" "}
            <span className="capitalize">{nextGame.home_away}</span> ·{" "}
            <span className="capitalize">{nextGame.game_type}</span>
          </p>
          <p className="mt-1 text-xs text-foreground/40">
            All-time vs {nextGame.opponent_name}: {formatRecord(record)}
          </p>
        </div>
        <Link
          href={`/coach/games/${nextGame.id}/setup`}
          className="shrink-0 rounded-md bg-accent-amber px-5 py-2.5 text-sm font-semibold text-background transition hover:bg-accent-amber/90"
        >
          Set Up Game
        </Link>
      </div>

      <div className="mt-5 rounded-md border border-border bg-background/50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-foreground/40">
          Scouting Note
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-foreground">{insight}</p>
      </div>
    </section>
  );
}

async function buildInsight(
  nextGame: Game,
  allGames: Game[],
  atBats: AtBat[],
  players: Player[],
  pastGameIds: Set<string>
): Promise<string> {
  if (pastGameIds.size === 0) {
    return `No history against ${nextGame.opponent_name} yet — this will be our first matchup.`;
  }

  const pastGames = allGames
    .filter((g) => pastGameIds.has(g.id))
    .map((g) => ({
      date: g.game_date,
      result: (g.our_score > g.opponent_score ? "W" : g.our_score < g.opponent_score ? "L" : "T") as
        | "W"
        | "L"
        | "T",
      ourScore: g.our_score,
      opponentScore: g.opponent_score,
    }));

  const relevantAtBats = atBats.filter((ab) => pastGameIds.has(ab.game_id));
  const battingLines = computeBattingLines(relevantAtBats, []);
  const playerPerformances = players
    .map((p) => battingLines.get(p.id))
    .filter((line): line is NonNullable<typeof line> => !!line && line.ab > 0)
    .map((line) => ({
      playerName: players.find((p) => p.id === line.playerId)?.name ?? "Unknown",
      ab: line.ab,
      h: line.h,
      avg: line.avg,
    }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 5);

  try {
    const text = await generateOpponentInsight({
      opponentName: nextGame.opponent_name,
      pastGames,
      playerPerformances,
    });
    if (text) return text;
  } catch {
    // Fall through to the static summary below.
  }

  return `Record vs ${nextGame.opponent_name}: ${
    pastGames.filter((g) => g.result === "W").length
  }-${pastGames.filter((g) => g.result === "L").length}${
    playerPerformances[0] ? `. ${playerPerformances[0].playerName} has hit ${formatAvg(playerPerformances[0].avg)} against them.` : "."
  }`;
}
