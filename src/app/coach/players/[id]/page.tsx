import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { FieldCalibrationPoints } from "@/lib/supabase/types";
import { PlayerBreakdownClient } from "./player-breakdown-client";
import { buildZoneInsightInput, getPlayerZoneInsights } from "./insights";

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

  // field-2d.png spray chart batch: same 2d field_calibration row the
  // operator's field diagram and fielder auto-suggest already read --
  // null (never calibrated) is a real, expected state the spray chart
  // gates on with its own banner rather than guessing a home-plate
  // position.
  const { data: fieldCalibrationRow } = await supabase
    .from("field_calibration")
    .select("calibration_points")
    .eq("team_id", profile.team_id)
    .eq("field_type", "2d")
    .maybeSingle();
  const fieldCalibration = (fieldCalibrationRow?.calibration_points as FieldCalibrationPoints | undefined) ?? null;

  const { data: games } = await supabase.from("games").select("*").eq("team_id", profile.team_id);
  const gameIds = (games ?? []).map((g) => g.id);

  // Time-of-day/day-of-week filters batch: this used to compute every
  // derived stat/heat-map/spray-chart shape right here, server-side, and
  // hand the finished results down. Moved to PlayerBreakdownClient
  // instead -- a client-side time-of-day/day-of-week filter needs to
  // re-run that derivation on demand as the coach changes it, which a
  // server component can't do without a full page reload. This page now
  // just fetches the raw rows and hands them over unfiltered.
  const [{ data: battingAtBats }, { data: pitchingAtBats }, { data: stolenBases }] = gameIds.length
    ? await Promise.all([
        supabase
          .from("at_bats")
          .select("*")
          .eq("player_id", player.id)
          .in("game_id", gameIds)
          .not("confirmed_at", "is", null),
        // Bug fix (pre-existing): the pitching stat grid previously reused
        // the same player_id-scoped query, which never has pitcher_id set
        // (exclusive to hitting-mode rows) -- pitching-mode at-bats are
        // keyed by pitcher_id instead.
        supabase.from("at_bats").select("*").eq("pitcher_id", player.id).in("game_id", gameIds).not("confirmed_at", "is", null),
        supabase.from("stolen_bases").select("*").eq("player_id", player.id).in("game_id", gameIds),
      ])
    : [{ data: [] as never[] }, { data: [] as never[] }, { data: [] as never[] }];

  const allAtBatIds = [...(battingAtBats ?? []), ...(pitchingAtBats ?? [])].map((ab) => ab.id);
  // Whiff-rate/pitch-location maps batch: "swing" added to the select --
  // needed to tell a swinging strike/foul_tip (a real whiff) apart from
  // a called strike, which the pre-existing columns alone can't do.
  const { data: pitches } = allAtBatIds.length
    ? await supabase.from("pitches").select("at_bat_id, pitch_number, pitch_type, zone_x, zone_y, outcome, swing").in("at_bat_id", allAtBatIds)
    : { data: [] };

  // Whiff-rate/pitch-location maps batch: the "Key Insights" block is
  // generated server-side, from the FULL (unfiltered) dataset -- it does
  // not react to the client-side time-of-day/day-of-week filters
  // PlayerBreakdownClient applies to the three live maps, since making it
  // reactive would mean either a server round-trip on every filter change
  // (defeating the point of caching it) or duplicating the Anthropic call
  // client-side (impossible -- the API key is server-only). Cached via
  // getPlayerZoneInsights (see insights.ts) so it only regenerates when
  // the underlying pitch data actually changes, not on every render.
  const battingAtBatIds = new Set((battingAtBats ?? []).map((ab) => ab.id));
  const batterPitches = (pitches ?? []).filter((p) => battingAtBatIds.has(p.at_bat_id));
  const insights = await getPlayerZoneInsights(buildZoneInsightInput(player.name, battingAtBats ?? [], batterPitches));

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
        <PlayerBreakdownClient
          player={player}
          games={games ?? []}
          battingAtBats={battingAtBats ?? []}
          pitchingAtBats={pitchingAtBats ?? []}
          stolenBases={stolenBases ?? []}
          pitches={pitches ?? []}
          fieldCalibration={fieldCalibration}
          insights={insights}
        />
      </div>
    </main>
  );
}
