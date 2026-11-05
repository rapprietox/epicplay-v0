import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatGameDate } from "@/lib/dates";
import { RESULT_LABELS } from "@/lib/operator/types";
import { computeBattingLines } from "@/lib/stats";

// Clubhouse batch: runs under the player's own session -- RLS
// ("at_bats: player selects own") already restricts the at_bats select
// to this player's own rows, so no service-role client is needed here
// (unlike the invite-claim/promo-redemption paths, which write outside
// a player's normal scope).
//
// Free preview batch: "server-side rule" compliance for the new full-line
// display -- every query below is hardcoded to profile.player_id (this
// signed-in player's own row, read from their own session, never from
// a URL/query param), so there is no way to see another player's line
// by editing [gameId] or any other part of the URL.
export default async function ClubhouseGameDetailPage({ params }: { params: { gameId: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("team_id, player_id").eq("id", user.id).single();
  if (!profile?.team_id || !profile?.player_id) redirect("/player");

  const { data: game } = await supabase.from("games").select("*").eq("id", params.gameId).eq("team_id", profile.team_id).maybeSingle();
  if (!game) notFound();

  const [{ data: atBats }, { data: stolenBases }] = await Promise.all([
    supabase
      .from("at_bats")
      .select("*")
      .eq("game_id", game.id)
      .eq("player_id", profile.player_id)
      .not("confirmed_at", "is", null)
      .order("inning", { ascending: true }),
    supabase.from("stolen_bases").select("*").eq("game_id", game.id).eq("player_id", profile.player_id),
  ]);

  const line = computeBattingLines(atBats ?? [], stolenBases ?? []).get(profile.player_id);

  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:px-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <Link href="/player/clubhouse" className="text-sm text-accent-primary hover:underline">
          ← Back to Clubhouse
        </Link>

        <header className="border-b border-border pb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-primary">{formatGameDate(game.game_date)}</p>
          <h1 className="font-heading mt-1 text-2xl font-bold text-white">
            {game.our_score}-{game.opponent_score} vs {game.opponent_name}
          </h1>
        </header>

        <section className="glossy rounded-lg border border-border bg-surface p-5">
          <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-white">Your Line</h2>
          <div className="mt-3 grid grid-cols-5 gap-3 sm:grid-cols-10">
            <StatTile label="AB" value={line?.ab ?? 0} />
            <StatTile label="H" value={line?.h ?? 0} />
            <StatTile label="2B" value={line?.doubles ?? 0} />
            <StatTile label="3B" value={line?.triples ?? 0} />
            <StatTile label="HR" value={line?.hr ?? 0} />
            <StatTile label="RBI" value={line?.rbi ?? 0} />
            <StatTile
              label="R"
              value={line?.runsScored ?? 0}
              note="Runs scored on wild pitches or steals may be added later."
            />
            <StatTile label="BB" value={line?.bb ?? 0} />
            <StatTile label="K" value={line?.k ?? 0} />
            <StatTile label="SB" value={line?.sb ?? 0} />
          </div>
        </section>

        <div className="flex flex-col gap-2">
          {(atBats ?? []).length === 0 && <p className="py-4 text-sm text-foreground/50">No at-bats logged for you in this game.</p>}
          {(atBats ?? []).map((ab) => (
            <div key={ab.id} className="glossy flex items-center justify-between rounded-md border border-border bg-surface px-4 py-3 text-sm">
              <span className="text-foreground/50">
                {ab.inning_half === "top" ? "Top" : "Bot"} {ab.inning}
              </span>
              <span className="font-semibold text-white">{ab.result ? RESULT_LABELS[ab.result] : "—"}</span>
              <span className="text-foreground/60">
                {ab.rbi > 0 ? `${ab.rbi} RBI` : ""} {ab.runs_scored > 0 ? `· Scored` : ""}
              </span>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

function StatTile({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="text-center">
      <p className="font-heading text-lg font-bold text-accent-gold">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-foreground/40">{label}</p>
      {note && <p className="mt-0.5 text-[9px] leading-tight text-foreground/35">{note}</p>}
    </div>
  );
}
