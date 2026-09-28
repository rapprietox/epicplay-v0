import Link from "next/link";
import type { Database } from "@/lib/supabase/types";

type Opponent = Database["public"]["Tables"]["opponents"]["Row"];
type Game = Database["public"]["Tables"]["games"]["Row"];

// Opponent pitcher intelligence batch: "lists all opponents faced this
// season" -- scoped to opponents with at least one game against them
// (an opponent row can exist with zero games played, e.g. auto-created
// by a schedule import that was later edited), so this only ever shows
// teams there's actually scouting data for.
export function OpponentScoutingSection({ opponents, games }: { opponents: Opponent[]; games: Game[] }) {
  const gamesByOpponentId = new Map<string, number>();
  for (const g of games) {
    if (!g.opponent_id) continue;
    gamesByOpponentId.set(g.opponent_id, (gamesByOpponentId.get(g.opponent_id) ?? 0) + 1);
  }

  const faced = opponents.filter((o) => (gamesByOpponentId.get(o.id) ?? 0) > 0).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <section className="glossy rounded-lg border border-border bg-surface p-5">
      <h2 className="font-heading text-lg font-semibold uppercase tracking-wide text-white">Opponent Scouting</h2>
      <p className="mt-1 text-xs text-foreground/50">Pitcher arsenals, zone tendencies, and our history against each team we&apos;ve faced.</p>

      {faced.length === 0 ? (
        <p className="mt-3 text-sm text-foreground/40">No opponents faced yet this season.</p>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
          {faced.map((o) => (
            <Link
              key={o.id}
              href={`/coach/opponents/${o.id}`}
              className="rounded-md border border-border bg-background/40 px-3 py-2.5 text-sm text-white transition hover:border-accent-primary"
            >
              <span className="font-medium">{o.name}</span>
              <span className="ml-2 text-xs text-foreground/40">{gamesByOpponentId.get(o.id)} game{gamesByOpponentId.get(o.id) === 1 ? "" : "s"}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
