import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { computeBattingLines, computePitchingLines, formatAvg } from "@/lib/stats";
import { zoneIndexFromCoords, type AtBatWithZone, type SprayDot } from "@/lib/heat-map";
import { resultCategory } from "@/lib/heat-map";
import { StrikeZoneHeatmap } from "./strike-zone-heatmap";
import { SprayChart } from "./spray-chart";
import type { AtBatResult, GameType, PitchType } from "@/lib/supabase/types";
import { PitcherHeatmap } from "./pitcher-heatmap";

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
  const gameTypeById = new Map((games ?? []).map((g) => [g.id, g.game_type]));
  const opponentNameById = new Map((games ?? []).map((g) => [g.id, g.opponent_name]));
  const gameDateById = new Map((games ?? []).map((g) => [g.id, g.game_date]));

  const [{ data: battingAtBats }, { data: pitchingAtBats }, { data: stolenBases }] = gameIds.length
    ? await Promise.all([
        supabase
          .from("at_bats")
          .select("*")
          .eq("player_id", player.id)
          .in("game_id", gameIds)
          .not("confirmed_at", "is", null),
        // Bug fix: the pitching stat grid previously reused the same
        // player_id-scoped query, which never has pitcher_id set (that's
        // exclusive to hitting-mode rows) -- so "Pitching" could never show
        // real data. Pitching-mode at-bats are keyed by pitcher_id instead.
        supabase.from("at_bats").select("*").eq("pitcher_id", player.id).in("game_id", gameIds).not("confirmed_at", "is", null),
        supabase.from("stolen_bases").select("*").eq("player_id", player.id).in("game_id", gameIds),
      ])
    : [{ data: [] as never[] }, { data: [] as never[] }, { data: [] as never[] }];

  const allAtBats = [...(battingAtBats ?? []), ...(pitchingAtBats ?? [])];
  const { data: pitches } = allAtBats.length
    ? await supabase
        .from("pitches")
        .select("at_bat_id, pitch_number, pitch_type, zone_x, zone_y, outcome")
        .in(
          "at_bat_id",
          allAtBats.map((ab) => ab.id)
        )
    : { data: [] };

  const lastPitchZoneByAtBat = new Map<string, number | null>();
  const lastPitchTypeByAtBat = new Map<string, string | null>();
  for (const ab of allAtBats) {
    const forThisAtBat = (pitches ?? []).filter((p) => p.at_bat_id === ab.id);
    const last = forThisAtBat.sort((a, b) => b.pitch_number - a.pitch_number)[0];
    lastPitchZoneByAtBat.set(ab.id, last && last.zone_x !== null && last.zone_y !== null ? zoneIndexFromCoords(last.zone_x, last.zone_y) : null);
    lastPitchTypeByAtBat.set(ab.id, last?.pitch_type ?? null);
  }

  const battingLine = computeBattingLines(battingAtBats ?? [], stolenBases ?? []).get(player.id);
  const pitchingLine = computePitchingLines(pitchingAtBats ?? [], games ?? []).get(player.id);

  const battingZoneAtBats: (AtBatWithZone & { gameType: GameType })[] = (battingAtBats ?? [])
    .filter((ab): ab is typeof ab & { result: AtBatResult } => ab.result !== null)
    .map((ab) => ({
      result: ab.result,
      zoneIndex: lastPitchZoneByAtBat.get(ab.id) ?? null,
      gameType: gameTypeById.get(ab.game_id) ?? "friendly",
    }));

  const pitchingZoneAtBats: (AtBatWithZone & { gameType: GameType })[] = (pitchingAtBats ?? [])
    .filter((ab): ab is typeof ab & { result: AtBatResult } => ab.result !== null)
    .map((ab) => ({
      result: ab.result,
      zoneIndex: lastPitchZoneByAtBat.get(ab.id) ?? null,
      gameType: gameTypeById.get(ab.game_id) ?? "friendly",
    }));

  const sprayDots: (SprayDot & { gameType: GameType })[] = (battingAtBats ?? [])
    .filter((ab): ab is typeof ab & { result: AtBatResult; field_x: number; field_y: number } => ab.result !== null && ab.field_x !== null && ab.field_y !== null)
    .map((ab) => ({
      x: ab.field_x,
      y: ab.field_y,
      category: resultCategory(ab.result),
      result: ab.result,
      inning: ab.inning,
      gameDate: gameDateById.get(ab.game_id) ?? "",
      opponentName: opponentNameById.get(ab.game_id) ?? "Unknown",
      hitType: ab.hit_type,
      gameType: gameTypeById.get(ab.game_id) ?? "friendly",
    }));

  const pitcherAtBatsByType: { result: AtBatResult; zoneIndex: number | null; pitchType: PitchType | null }[] = (pitchingAtBats ?? [])
    .filter((ab): ab is typeof ab & { result: AtBatResult } => ab.result !== null)
    .map((ab) => ({
      result: ab.result,
      zoneIndex: lastPitchZoneByAtBat.get(ab.id) ?? null,
      pitchType: (lastPitchTypeByAtBat.get(ab.id) as PitchType | null) ?? null,
    }));

  const pitcherAtBatIds = new Set((pitchingAtBats ?? []).map((ab) => ab.id));
  const pitcherPitches = (pitches ?? []).filter((p) => pitcherAtBatIds.has(p.at_bat_id));

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

      <div className="mx-auto mt-6 flex max-w-3xl flex-col gap-6">
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

        <section className="glossy rounded-lg border border-border bg-surface p-5">
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

        <StrikeZoneHeatmap
          battingAtBats={battingZoneAtBats}
          pitchingAtBats={pitchingZoneAtBats}
          hasPitchingData={pitchingZoneAtBats.length > 0}
        />

        <SprayChart dots={sprayDots} />

        {pitchingZoneAtBats.length > 0 && <PitcherHeatmap atBats={pitcherAtBatsByType} pitches={pitcherPitches} />}
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
