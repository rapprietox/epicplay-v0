import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { computeBattingLines } from "@/lib/stats";
import { computeZoneBattingLines, zoneIndexFromCoords, resultCategory } from "@/lib/heat-map";
import { finalCountForAtBat, computePressureSplits } from "@/lib/count-stats";
import { daysUntil } from "@/lib/dates";
import type { AtBatResult, FieldCalibrationPoints, GameType, PitchType } from "@/lib/supabase/types";
import { getPlayerZoneInsights, buildZoneInsightInput } from "@/app/coach/players/[id]/insights";
import { getPregameMessage } from "./insights";
import { getOrCreateInitialAssessment } from "./kairos-actions";
import { computeSituationalStats } from "@/lib/situational-stats";
import { recentGamesAvg, currentHitStreak, streakStatus } from "@/lib/streaks";
import { computeHeadToHead } from "@/lib/head-to-head";
import { computeMilestones } from "@/lib/milestones";
import { ClubhouseHeader } from "./header";
import { PregameCard } from "./pregame-card";
import { GameHistory } from "./game-history";
import { ProSection } from "./pro-section";
import { UnlockingBanner } from "./pro/unlocking-banner";
import type { GameHistoryRow } from "./types";

export default async function ClubhousePage({ searchParams }: { searchParams: { unlocked?: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("team_id, player_id").eq("id", user.id).single();
  if (!profile?.team_id || !profile?.player_id) redirect("/player");

  const [{ data: player }, { data: team }] = await Promise.all([
    supabase.from("players").select("*").eq("id", profile.player_id).single(),
    supabase.from("teams").select("name").eq("id", profile.team_id).single(),
  ]);
  if (!player) redirect("/player");

  const { data: games } = await supabase.from("games").select("*").eq("team_id", profile.team_id);
  const allGames = games ?? [];
  // Part 5: best-season-AVG milestone needs games grouped by season.
  const { data: seasons } = await supabase.from("seasons").select("id, name").eq("team_id", profile.team_id);
  const gameById = new Map(allGames.map((g) => [g.id, g]));
  const gameIds = allGames.map((g) => g.id);

  const { data: battingAtBats } = gameIds.length
    ? await supabase.from("at_bats").select("*").eq("player_id", player.id).in("game_id", gameIds).not("confirmed_at", "is", null)
    : { data: [] };
  const confirmedAtBats = battingAtBats ?? [];
  const atBatIds = confirmedAtBats.map((ab) => ab.id);

  const { data: stolenBases } = gameIds.length
    ? await supabase.from("stolen_bases").select("*").eq("player_id", player.id).in("game_id", gameIds)
    : { data: [] };

  const { data: pitches } = atBatIds.length
    ? await supabase.from("pitches").select("at_bat_id, pitch_number, pitch_type, zone_x, zone_y, outcome, swing").in("at_bat_id", atBatIds)
    : { data: [] };
  const batterPitches = pitches ?? [];

  const { data: fieldCalibrationRow } = await supabase
    .from("field_calibration")
    .select("calibration_points")
    .eq("team_id", profile.team_id)
    .eq("field_type", "2d")
    .maybeSingle();
  const fieldCalibration = (fieldCalibrationRow?.calibration_points as FieldCalibrationPoints | undefined) ?? null;

  const seasonLine = computeBattingLines(confirmedAtBats, stolenBases ?? []).get(player.id);

  // Zone data for the mini Map 1 panel + ZoneAnalyticsRow, mirroring the
  // same "last pitch of the at-bat is the zone" derivation the coach's
  // player-breakdown-client.tsx does client-side (see its own comment) --
  // done here server-side since this page isn't a client component
  // re-deriving on every filter change.
  const lastPitchZoneByAtBat = new Map<string, number | null>();
  const lastPitchTypeByAtBat = new Map<string, PitchType | null>();
  const finalCountByAtBat = new Map<string, ReturnType<typeof finalCountForAtBat>>();
  for (const ab of confirmedAtBats) {
    const forThis = batterPitches.filter((p) => p.at_bat_id === ab.id);
    const sorted = [...forThis].sort((a, b) => b.pitch_number - a.pitch_number);
    const last = sorted[0];
    lastPitchZoneByAtBat.set(ab.id, last && last.zone_x !== null && last.zone_y !== null ? zoneIndexFromCoords(last.zone_x, last.zone_y) : null);
    lastPitchTypeByAtBat.set(ab.id, last?.pitch_type ?? null);
    finalCountByAtBat.set(ab.id, finalCountForAtBat(forThis));
  }

  const decidedAtBats = confirmedAtBats.filter((ab): ab is typeof ab & { result: AtBatResult } => ab.result !== null);

  const battingZoneAtBats = decidedAtBats.map((ab) => ({
    result: ab.result,
    zoneIndex: lastPitchZoneByAtBat.get(ab.id) ?? null,
    gameType: (gameById.get(ab.game_id)?.game_type ?? "friendly") as GameType,
  }));
  const battingAvgZoneLines = computeZoneBattingLines(battingZoneAtBats);

  const hitterCountAtBats = decidedAtBats.map((ab) => ({ result: ab.result, finalCount: finalCountByAtBat.get(ab.id) ?? null }));
  const hitterPitchTypeAtBats = decidedAtBats.map((ab) => ({ result: ab.result, pitchType: lastPitchTypeByAtBat.get(ab.id) ?? null }));
  const pressureSplits = computePressureSplits(hitterCountAtBats);

  const sprayDots = decidedAtBats
    .filter((ab): ab is typeof ab & { field_x: number; field_y: number } => ab.field_x !== null && ab.field_y !== null)
    .map((ab) => {
      const g = gameById.get(ab.game_id);
      return {
        x: ab.field_x,
        y: ab.field_y,
        category: resultCategory(ab.result),
        result: ab.result,
        inning: ab.inning,
        gameDate: g?.game_date ?? "",
        opponentName: g?.opponent_name ?? "Unknown",
        hitType: ab.hit_type,
        gameType: (g?.game_type ?? "friendly") as GameType,
      };
    });

  const insights = await getPlayerZoneInsights(buildZoneInsightInput(player.name, confirmedAtBats, batterPitches));

  // Clubhouse Pro enhancement, Part 3: only generated once Pro is
  // actually unlocked -- an unlocked player is the only one who'll ever
  // see it, so there's no reason to spend an Anthropic call (or wait on
  // one) for a locked player.
  const kairosAssessment = player.clubhouse_unlocked ? await getOrCreateInitialAssessment() : "";

  // Games this player actually appeared in, most recent first -- "game
  // history" is personal ("their line"), so a game they didn't bat in
  // isn't part of it.
  const playerGameIds = Array.from(new Set(confirmedAtBats.map((ab) => ab.game_id)));
  const playerGames = playerGameIds
    .map((id) => gameById.get(id))
    .filter((g): g is NonNullable<typeof g> => Boolean(g) && g!.status === "completed")
    .sort((a, b) => b!.game_date.localeCompare(a!.game_date)) as NonNullable<ReturnType<typeof gameById.get>>[];

  const playerId = player.id;
  function personalLineFor(gameId: string) {
    const abs = confirmedAtBats.filter((ab) => ab.game_id === gameId);
    const sbs = (stolenBases ?? []).filter((sb) => sb.game_id === gameId);
    return computeBattingLines(abs, sbs).get(playerId);
  }

  const gameHistoryRows: GameHistoryRow[] = playerGames.slice(0, 10).map((g) => ({
    game: g,
    line: personalLineFor(g.id),
    result: g.our_score > g.opponent_score ? "W" : g.our_score < g.opponent_score ? "L" : "T",
  }));

  // Part 4: situational stats, hot/cold streak, head-to-head, trend chart.
  const situationalRows = computeSituationalStats(player.id, confirmedAtBats, gameById);

  const chronologicalGames = [...playerGames].reverse();
  const last5Line = recentGamesAvg(player.id, confirmedAtBats, chronologicalGames, 5);
  const last10Line = recentGamesAvg(player.id, confirmedAtBats, chronologicalGames, 10);
  const streak = currentHitStreak(player.id, confirmedAtBats, chronologicalGames);
  const streakBadge = streakStatus(last5Line?.avg ?? 0);

  const headToHeadEntries = computeHeadToHead(player.id, allGames, confirmedAtBats);

  const milestones = computeMilestones(player.id, confirmedAtBats, allGames, seasons ?? []);

  let cumulativeAtBats: typeof confirmedAtBats = [];
  const trendPoints = chronologicalGames.map((g, i) => {
    cumulativeAtBats = [...cumulativeAtBats, ...confirmedAtBats.filter((ab) => ab.game_id === g.id)];
    const rollingLine = computeBattingLines(cumulativeAtBats, []).get(player.id);
    const gameLine = personalLineFor(g.id);
    return {
      gameId: g.id,
      gameIndex: i + 1,
      opponentName: g.opponent_name,
      rollingAvg: rollingLine?.avg ?? 0,
      gameLine: gameLine ? `${gameLine.h}-${gameLine.ab}${gameLine.hr > 0 ? `, ${gameLine.hr} HR` : ""}` : "0-0",
    };
  });

  const today = new Date().toISOString().slice(0, 10);
  const todaysGame = allGames.find((g) => g.game_date === today && daysUntil(g.game_date) === 0 && g.status !== "cancelled") ?? null;

  let pregameMessage: string | null = null;
  if (todaysGame) {
    const { data: lineupRow } = await supabase
      .from("lineup")
      .select("batting_order, position")
      .eq("game_id", todaysGame.id)
      .eq("player_id", player.id)
      .maybeSingle();

    const recentGames = playerGames.slice(0, 3).map((g) => {
      const line = personalLineFor(g.id);
      return { opponent: g.opponent_name, line: line ? `${line.h}-${line.ab}` : "0-0" };
    });
    const recentAtBats = confirmedAtBats.filter((ab) => playerGames.slice(0, 3).some((g) => g.id === ab.game_id));
    const recentLine = computeBattingLines(recentAtBats, []).get(player.id);

    pregameMessage = await getPregameMessage({
      playerName: player.name,
      position: lineupRow?.position ?? player.position ?? "the field",
      opponentName: todaysGame.opponent_name,
      lineupSpot: lineupRow?.batting_order ?? null,
      recentGames,
      recentAvg: recentLine?.avg ?? null,
    });
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:px-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <ClubhouseHeader player={player} teamName={team?.name ?? "Team"} line={seasonLine} />

        <PregameCard todaysGame={todaysGame} message={pregameMessage} lastGame={gameHistoryRows[0] ?? null} />

        <GameHistory rows={gameHistoryRows} />

        {searchParams.unlocked === "1" && !player.clubhouse_unlocked && <UnlockingBanner />}

        <ProSection
          unlocked={player.clubhouse_unlocked}
          playerId={player.id}
          battingAvgZoneLines={battingAvgZoneLines}
          battingZoneAtBats={battingZoneAtBats}
          pitches={batterPitches}
          insights={insights}
          sprayDots={sprayDots}
          fieldCalibration={fieldCalibration}
          hitterCountAtBats={hitterCountAtBats}
          hitterPitchTypeAtBats={hitterPitchTypeAtBats}
          pressureSplits={pressureSplits}
          kairosAssessment={kairosAssessment}
          situationalRows={situationalRows}
          last5Line={last5Line}
          last10Line={last10Line}
          currentStreak={streak}
          streakBadge={streakBadge}
          headToHeadEntries={headToHeadEntries}
          trendPoints={trendPoints}
          milestones={milestones}
        />
      </div>
    </main>
  );
}
