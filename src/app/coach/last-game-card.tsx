import Link from "next/link";
import { formatGameDate } from "@/lib/dates";
import { resultLetter } from "@/lib/opponent-history";
import type { Database } from "@/lib/supabase/types";

type Game = Database["public"]["Tables"]["games"]["Row"];

// Launch-audit Fix 5: closes the "where did last night's game actually
// show up" gap -- the Team Leaders Board only ever shows season-long
// aggregates, and the completed game itself drops into the Schedule's
// "Past Games" accordion, collapsed by default. This surfaces the most
// recently completed game directly, between Next Game and Team Leaders,
// with a direct link to its box score. Renders nothing at all if the
// team has no completed games yet (per spec) -- no empty-state card,
// since Next Game above it already covers "nothing's happened yet."
export function LastGameCard({ games }: { games: Game[] }) {
  const lastCompleted = [...games]
    .filter((g) => g.status === "completed")
    .sort((a, b) => b.game_date.localeCompare(a.game_date))[0];
  if (!lastCompleted) return null;

  const result = resultLetter(lastCompleted);

  return (
    <section className="glossy rounded-lg border border-border bg-surface p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-primary">Last Game</p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl font-bold text-white">
            vs {lastCompleted.opponent_name} — {formatGameDate(lastCompleted.game_date)}
          </h2>
          <p className="mt-1 text-sm text-foreground/60">
            {lastCompleted.our_score} &ndash; {lastCompleted.opponent_score}
            {result && (
              <span
                className={`ml-2 font-heading font-semibold ${
                  result === "W" ? "text-accent-green" : result === "L" ? "text-accent-red" : "text-foreground/60"
                }`}
              >
                {result}
              </span>
            )}
          </p>
        </div>
        <Link
          href={`/coach/games/${lastCompleted.id}/scorebook`}
          className="rounded-md bg-accent-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-light"
        >
          View Box Score
        </Link>
      </div>
    </section>
  );
}
