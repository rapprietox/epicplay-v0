import Link from "next/link";
import type { Database } from "@/lib/supabase/types";
import { formatGameDate } from "@/lib/dates";
import { formatPersonalLine, type GameHistoryRow } from "./types";

type Game = Database["public"]["Tables"]["games"]["Row"];

// Clubhouse batch: green-glow card, top of the free tier. Exactly one of
// todaysGame/lastGame is ever present -- the caller (page.tsx) already
// decided which per spec ("if there's a game today... if no game today,
// show their last game summary instead").
export function PregameCard({
  todaysGame,
  message,
  lastGame,
}: {
  todaysGame: Game | null;
  message: string | null;
  lastGame: GameHistoryRow | null;
}) {
  if (todaysGame) {
    return (
      <section
        className="glossy rounded-lg border border-accent-green/60 bg-surface p-5"
        style={{ boxShadow: "0 0 24px rgba(46,204,113,0.25)" }}
      >
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-green">Game Day</p>
        <p className="mt-1 text-xs text-foreground/50">
          {todaysGame.home_away === "home" ? "vs" : "@"} {todaysGame.opponent_name}
        </p>
        {message ? (
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-white">{message}</p>
        ) : (
          <p className="mt-3 text-sm text-foreground/50">Good luck today.</p>
        )}
      </section>
    );
  }

  if (!lastGame) {
    return (
      <section className="glossy rounded-lg border border-border bg-surface p-5 text-center">
        <p className="text-sm text-foreground/50">No games logged yet. Check back after your first one.</p>
      </section>
    );
  }

  return (
    <section className="glossy rounded-lg border border-border bg-surface p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground/40">Last Game</p>
      <div className="mt-2 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-white">
            {lastGame.result} {lastGame.game.our_score}-{lastGame.game.opponent_score} vs {lastGame.game.opponent_name}
          </p>
          <p className="text-xs text-foreground/50">{formatGameDate(lastGame.game.game_date)}</p>
        </div>
        <p className="font-heading text-lg font-bold text-accent-gold">{formatPersonalLine(lastGame.line)}</p>
      </div>
      <Link href={`/player/clubhouse/games/${lastGame.game.id}`} className="mt-2 inline-block text-xs text-accent-primary hover:underline">
        See your at-bats →
      </Link>
    </section>
  );
}
