import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { zoneIndexFromCoords } from "@/lib/heat-map";
import { computePitchArsenal, computeBatterLinesVsPitcher, computeBatterLinesByPitchType, teamAvgAgainst } from "@/lib/opponent-scouting";
import { formatAvg } from "@/lib/stats";
import type { AtBatResult, PitchType } from "@/lib/supabase/types";
import { PitcherHeatmap } from "../../players/[id]/pitcher-heatmap";

export default async function OpponentScoutingPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role, team_id").eq("id", user.id).single();
  if (!profile?.team_id || profile.role !== "coach") redirect("/pending");

  const { data: opponent } = await supabase.from("opponents").select("*").eq("id", params.id).eq("team_id", profile.team_id).single();
  if (!opponent) notFound();

  const [{ data: games }, { data: opponentPlayers }, { data: players }] = await Promise.all([
    supabase.from("games").select("id, game_date, our_score, opponent_score").eq("team_id", profile.team_id).eq("opponent_id", opponent.id),
    supabase.from("opponent_players").select("*").eq("opponent_id", opponent.id),
    supabase.from("players").select("id, name").eq("team_id", profile.team_id),
  ]);
  const gameIds = (games ?? []).map((g) => g.id);
  const playerNameById = new Map((players ?? []).map((p) => [p.id, p.name]));

  const { data: atBats } = gameIds.length
    ? await supabase
        .from("at_bats")
        .select("*")
        .in("game_id", gameIds)
        .eq("mode", "hitting")
        .not("confirmed_at", "is", null)
        .not("opponent_pitcher_id", "is", null)
    : { data: [] };

  const atBatIds = (atBats ?? []).map((ab) => ab.id);
  const { data: pitches } = atBatIds.length
    ? await supabase.from("pitches").select("at_bat_id, pitch_number, pitch_type, zone_x, zone_y, outcome").in("at_bat_id", atBatIds)
    : { data: [] };

  const lastPitchByAtBat = new Map<string, { zoneIndex: number | null; pitchType: PitchType | null }>();
  for (const ab of atBats ?? []) {
    const forThisAtBat = (pitches ?? []).filter((p) => p.at_bat_id === ab.id);
    const last = forThisAtBat.sort((a, b) => b.pitch_number - a.pitch_number)[0];
    lastPitchByAtBat.set(ab.id, {
      zoneIndex: last && last.zone_x !== null && last.zone_y !== null ? zoneIndexFromCoords(last.zone_x, last.zone_y) : null,
      pitchType: last?.pitch_type ?? null,
    });
  }

  // Opponent pitcher intelligence batch: "their pitcher profiles" --
  // every opponent_players id that actually appears as an
  // opponent_pitcher_id on a real at-bat, not just whoever's tagged
  // position 'P' on the roster import (a mid-game relief pitcher may
  // never have that tag, but has genuinely faced us and has real data).
  const pitcherIds = Array.from(new Set((atBats ?? []).map((ab) => ab.opponent_pitcher_id).filter((id): id is string => id !== null)));
  const opponentPlayerById = new Map((opponentPlayers ?? []).map((p) => [p.id, p]));

  const pitcherProfiles = pitcherIds
    .map((pitcherId) => {
      const info = opponentPlayerById.get(pitcherId);
      const theseAtBats = (atBats ?? []).filter((ab) => ab.opponent_pitcher_id === pitcherId);
      const theseAtBatIds = new Set(theseAtBats.map((ab) => ab.id));
      const thesePitches = (pitches ?? []).filter((p) => theseAtBatIds.has(p.at_bat_id));
      const gamesFaced = new Set(theseAtBats.map((ab) => ab.game_id)).size;

      const zonePitchTypeAtBats = theseAtBats
        .filter((ab): ab is typeof ab & { result: AtBatResult } => ab.result !== null)
        .map((ab) => ({
          result: ab.result,
          zoneIndex: lastPitchByAtBat.get(ab.id)?.zoneIndex ?? null,
          pitchType: lastPitchByAtBat.get(ab.id)?.pitchType ?? null,
        }));

      return {
        pitcherId,
        name: info?.name ?? "Unknown Pitcher",
        jerseyNumber: info?.jersey_number ?? null,
        gamesFaced,
        arsenal: computePitchArsenal(thesePitches),
        batterLines: computeBatterLinesVsPitcher(theseAtBats, playerNameById),
        team: teamAvgAgainst(theseAtBats),
        pitchTypeLines: computeBatterLinesByPitchType(zonePitchTypeAtBats),
        zonePitchTypeAtBats,
        pitches: thesePitches,
      };
    })
    .sort((a, b) => b.gamesFaced - a.gamesFaced);

  return (
    <main className="min-h-screen bg-background px-6 py-8">
      <Link href="/coach" className="text-sm text-accent-primary hover:underline">
        &larr; Back to dashboard
      </Link>

      <header className="mt-4 border-b border-border pb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-primary">Opponent Scouting</p>
        <h1 className="font-heading mt-1 text-3xl font-bold text-white">{opponent.name}</h1>
        <p className="mt-1 text-sm text-foreground/60">{(games ?? []).length} game{(games ?? []).length === 1 ? "" : "s"} played</p>
      </header>

      <div className="mx-auto mt-6 flex max-w-3xl flex-col gap-6">
        {pitcherProfiles.length === 0 && (
          <p className="rounded-md border border-border bg-surface p-5 text-sm text-foreground/50">
            No pitches logged against a known opponent pitcher yet. On the operator screen (hitting mode), tap the pitcher readout in
            the top bar to identify who&apos;s pitching for them.
          </p>
        )}

        {pitcherProfiles.map((p) => (
          <section key={p.pitcherId} className="glossy rounded-lg border border-border bg-surface p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-heading text-xl font-bold text-white">
                #{p.jerseyNumber ?? "—"} {p.name}
              </h2>
              <span className="text-xs text-foreground/50">
                {p.gamesFaced} game{p.gamesFaced === 1 ? "" : "s"} faced
              </span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-foreground/40">Team AVG vs him</p>
                <p className="font-heading text-xl font-bold text-white">{formatAvg(p.team.avg)}</p>
                <p className="text-[11px] text-foreground/40">
                  {p.team.h}-for-{p.team.ab}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-foreground/40">Best matchup</p>
                <p className="text-sm font-semibold text-accent-green">{p.batterLines[0]?.playerName ?? "—"}</p>
                {p.batterLines[0] && <p className="text-[11px] text-foreground/40">{formatAvg(p.batterLines[0].avg)}</p>}
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-foreground/40">Toughest matchup</p>
                <p className="text-sm font-semibold text-accent-red">{p.batterLines[p.batterLines.length - 1]?.playerName ?? "—"}</p>
                {p.batterLines.length > 1 && <p className="text-[11px] text-foreground/40">{formatAvg(p.batterLines[p.batterLines.length - 1].avg)}</p>}
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-foreground/40">Top pitch</p>
                <p className="text-sm font-semibold text-white capitalize">{p.arsenal[0]?.pitchType ?? "—"}</p>
                {p.arsenal[0] && <p className="text-[11px] text-foreground/40">{Math.round(p.arsenal[0].pct)}% of pitches</p>}
              </div>
            </div>

            <div className="mt-4">
              <p className="text-xs uppercase tracking-wide text-foreground/40">Pitch arsenal</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {p.arsenal.map((a) => (
                  <span key={a.pitchType} className="rounded-full border border-border px-2.5 py-1 text-xs text-white capitalize">
                    {a.pitchType} — {Math.round(a.pct)}%
                  </span>
                ))}
                {p.arsenal.length === 0 && <span className="text-xs text-foreground/30">No pitch-type data logged.</span>}
              </div>
            </div>

            <div className="mt-4">
              <p className="text-xs uppercase tracking-wide text-foreground/40">Our batters vs him</p>
              <div className="mt-1.5 overflow-x-auto">
                <table className="w-full min-w-[320px] text-left text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-foreground/40">
                      <th className="pb-1 pr-3">Batter</th>
                      <th className="pb-1 pr-3">AB</th>
                      <th className="pb-1 pr-3">H</th>
                      <th className="pb-1">AVG</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {p.batterLines.map((l) => (
                      <tr key={l.playerId}>
                        <td className="py-1 pr-3 text-white">{l.playerName}</td>
                        <td className="py-1 pr-3 text-foreground/60">{l.ab}</td>
                        <td className="py-1 pr-3 text-foreground/60">{l.h}</td>
                        <td className="py-1 font-semibold text-white">{formatAvg(l.avg)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {p.pitchTypeLines.length > 0 && (
              <div className="mt-4">
                <p className="text-xs uppercase tracking-wide text-foreground/40">Pitch types we struggle with</p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {p.pitchTypeLines.map((l) => (
                    <span key={l.pitchType} className="rounded-full border border-border px-2.5 py-1 text-xs capitalize text-white">
                      {l.pitchType}: <span className="font-semibold">{formatAvg(l.avg)}</span> ({l.ab} AB)
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Zone tendencies (where he throws each pitch type) + our AVG
                by zone against him -- reuses the same panel already built
                for OUR OWN pitchers' pages (player/[id]/pitcher-heatmap.tsx);
                the data shape is identical regardless of whose pitcher it
                is, so there was no reason to build a second version. */}
            <div className="mt-4">
              <PitcherHeatmap atBats={p.zonePitchTypeAtBats} pitches={p.pitches} />
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
