import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { computeBattingLines, computePitchingLines, formatAvg } from "@/lib/stats";

export default async function PlayerBreakdownPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, team_id")
    .eq("id", user.id)
    .single();
  if (!profile?.team_id || profile.role !== "coach") redirect("/pending");

  const { data: player } = await supabase
    .from("players")
    .select("*")
    .eq("id", params.id)
    .eq("team_id", profile.team_id)
    .single();
  if (!player) notFound();

  const { data: games } = await supabase.from("games").select("*").eq("team_id", profile.team_id);
  const gameIds = (games ?? []).map((g) => g.id);

  const [{ data: atBats }, { data: stolenBases }] = gameIds.length
    ? await Promise.all([
        supabase
          .from("at_bats")
          .select("*")
          .eq("player_id", player.id)
          .in("game_id", gameIds)
          .not("confirmed_at", "is", null),
        supabase.from("stolen_bases").select("*").eq("player_id", player.id).in("game_id", gameIds),
      ])
    : [{ data: [] as never[] }, { data: [] as never[] }];

  const battingLine = computeBattingLines(atBats ?? [], stolenBases ?? []).get(player.id);
  const pitchingLine = computePitchingLines(atBats ?? [], games ?? []).get(player.id);

  return (
    <main className="min-h-screen bg-background px-6 py-8">
      <Link href="/coach" className="text-sm text-accent-primary hover:underline">
        &larr; Back to dashboard
      </Link>

      <header className="mt-4 border-b border-border pb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-primary">
          #{player.jersey_number ?? "—"} &middot; {player.position ?? "—"}
        </p>
        <h1 className="font-heading mt-1 text-3xl font-bold text-white">{player.name}</h1>
      </header>

      <div className="mx-auto mt-6 max-w-3xl">
        <section className="glossy rounded-lg border border-border bg-surface p-5">
          <h2 className="font-heading text-lg font-semibold uppercase tracking-wide text-white">
            Batting
          </h2>
          {battingLine && battingLine.ab > 0 ? (
            <StatGrid
              stats={[
                ["AVG", formatAvg(battingLine.avg)],
                ["OBP", formatAvg(battingLine.obp)],
                ["SLG", formatAvg(battingLine.slg)],
                ["OPS", battingLine.ops.toFixed(3)],
                ["AB", battingLine.ab],
                ["H", battingLine.h],
                ["2B", battingLine.doubles],
                ["3B", battingLine.triples],
                ["HR", battingLine.hr],
                ["RBI", battingLine.rbi],
                ["BB", battingLine.bb],
                ["SB", battingLine.sb],
              ]}
            />
          ) : (
            <p className="mt-3 text-sm text-foreground/50">No at-bats logged yet.</p>
          )}
        </section>

        <section className="mt-6 glossy rounded-lg border border-border bg-surface p-5">
          <h2 className="font-heading text-lg font-semibold uppercase tracking-wide text-white">
            Pitching
          </h2>
          {pitchingLine && pitchingLine.ip > 0 ? (
            <StatGrid
              stats={[
                ["ERA", pitchingLine.era?.toFixed(2) ?? "—"],
                ["WHIP", pitchingLine.whip?.toFixed(2) ?? "—"],
                ["IP", pitchingLine.ipDisplay],
                ["W", pitchingLine.wins],
                ["K", pitchingLine.k],
                ["BB", pitchingLine.bbAllowed],
                ["H", pitchingLine.hAllowed],
              ]}
            />
          ) : (
            <p className="mt-3 text-sm text-foreground/50">No innings pitched yet.</p>
          )}
        </section>
      </div>
    </main>
  );
}

function StatGrid({ stats }: { stats: [string, string | number][] }) {
  return (
    <div className="mt-4 grid grid-cols-3 gap-4 sm:grid-cols-4">
      {stats.map(([label, value]) => (
        <div key={label}>
          <p className="text-xs uppercase tracking-wide text-foreground/40">{label}</p>
          <p className="font-heading text-xl font-bold text-white">{value}</p>
        </div>
      ))}
    </div>
  );
}
