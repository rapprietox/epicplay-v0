import Link from "next/link";
import { formatGameDate } from "@/lib/dates";
import { formatPersonalLine, type GameHistoryRow } from "./types";

export function GameHistory({ rows }: { rows: GameHistoryRow[] }) {
  return (
    <section className="glossy rounded-lg border border-border bg-surface p-5">
      <h2 className="font-heading text-lg font-semibold uppercase tracking-wide text-white">Game History</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-foreground/50">No games logged yet.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-1.5">
          {rows.map(({ game, line, result }) => (
            <Link
              key={game.id}
              href={`/player/clubhouse/games/${game.id}`}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/40 px-3 py-2 text-sm transition hover:border-accent-primary hover:bg-background/70"
            >
              <span className="w-24 shrink-0 text-foreground/50">{formatGameDate(game.game_date)}</span>
              <span
                className={`w-6 shrink-0 text-center font-heading font-bold ${
                  result === "W" ? "text-accent-green" : result === "L" ? "text-accent-red" : "text-foreground/50"
                }`}
              >
                {result}
              </span>
              <span className="min-w-0 flex-1 truncate text-white">vs {game.opponent_name}</span>
              <span className="shrink-0 font-mono text-xs text-foreground/60">{formatPersonalLine(line)}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
