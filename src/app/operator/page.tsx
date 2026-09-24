import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/sign-out-button";
import type { FieldCalibrationPoints, PlayerPositionCalibration } from "@/lib/supabase/types";
import { getOrCreateGameState } from "./actions";
import { OperatorConsole } from "./operator-console";
import { computeBattingLines } from "@/lib/stats";

export default async function OperatorPage({
  searchParams,
}: {
  searchParams: { game?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, role, team_id")
    .eq("id", user.id)
    .single();
  if (!profile?.team_id || !["operator", "coach"].includes(profile.role)) redirect("/pending");

  const teamId = profile.team_id;
  const { data: team } = await supabase.from("teams").select("name").eq("id", teamId).single();

  const { data: activeGames } = searchParams.game
    ? await supabase.from("games").select("*").eq("team_id", teamId).eq("id", searchParams.game)
    : await supabase
        .from("games")
        .select("*")
        .eq("team_id", teamId)
        .eq("status", "active")
        .order("created_at", { ascending: false });

  const game = activeGames?.find((g) => g.status === "active") ?? null;

  if (!game) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-amber">Operator</p>
        <h1 className="font-heading text-2xl font-bold text-white">No active game</h1>
        <p className="max-w-sm text-sm text-foreground/60">
          Ask your coach to set up and start a game from the dashboard first.
        </p>
        <SignOutButton />
      </main>
    );
  }

  const [{ data: players }, { data: lineup }, { data: substitutions }, { data: fieldCalibrationRow }, { data: positionsCalibrationRow }] =
    await Promise.all([
      supabase.from("players").select("*").eq("team_id", teamId).order("jersey_number"),
      supabase.from("lineup").select("*").eq("game_id", game.id),
      supabase.from("substitutions").select("player_out_id, player_in_id").eq("game_id", game.id),
      // Feature 1 (fielding-play logging batch): the 2D field's calibration,
      // used to auto-suggest which fielder picked up a batted ball from
      // where it was tapped -- null (never calibrated yet) is a real,
      // expected state, not an error; the auto-suggest UI falls back to a
      // plain fielder picker with no suggestion when this is missing.
      supabase.from("field_calibration").select("calibration_points").eq("team_id", teamId).eq("field_type", "2d").maybeSingle(),
      // Feature 2 (lineup-status batch): the "positions" calibration row --
      // same optional-until-calibrated shape, used by the new chain
      // substitution diagram to place each defensive position's avatar at
      // its real calibrated spot instead of a generic guess.
      supabase.from("field_calibration").select("calibration_points").eq("team_id", teamId).eq("field_type", "positions").maybeSingle(),
    ]);

  const gameState = await getOrCreateGameState(game.id);

  // Feature 2 (game-rules batch): resolveGameRules needs the season's
  // own rule columns whenever this game doesn't override them --
  // null when the game has no season_id at all (a manual/friendly
  // game), which resolveGameRules already treats as "no limits."
  const { data: season } = game.season_id
    ? await supabase.from("seasons").select("*").eq("id", game.season_id).maybeSingle()
    : { data: null };

  let draftAtBat = null;
  if (gameState.current_at_bat_id) {
    const { data: atBat } = await supabase.from("at_bats").select("*").eq("id", gameState.current_at_bat_id).single();
    if (atBat) {
      const { data: pitches } = await supabase.from("pitches").select("*").eq("at_bat_id", atBat.id).order("pitch_number");
      draftAtBat = { ...atBat, pitches: pitches ?? [] };
    }
  }

  const { data: opponentPlayers } = game.opponent_id
    ? await supabase.from("opponent_players").select("*").eq("opponent_id", game.opponent_id)
    : { data: [] };

  const { data: gameAtBats } = await supabase.from("at_bats").select("id, mode").eq("game_id", game.id);
  const gameAtBatIds = gameAtBats ?? [];
  const { data: allGamePitches } =
    gameAtBatIds.length > 0
      ? await supabase
          .from("pitches")
          .select("pitch_number, pitch_type, zone_x, zone_y, outcome")
          .in(
            "at_bat_id",
            gameAtBatIds.map((a) => a.id)
          )
      : { data: [] };

  // Addition 2 (two-additions batch): "total pitches logged this game
  // against our batters" for the top bar -- every pitch attached to a
  // hitting-mode at-bat was thrown by the opponent's pitcher. No
  // game_state column for this (display-only, not worth a schema
  // change), so it's just counted here and passed as a one-time seed;
  // the reducer takes over incrementing it live from there (see
  // opponentPitchCount in lib/operator/types.ts).
  const hittingAtBatIds = gameAtBatIds.filter((a) => a.mode === "hitting").map((a) => a.id);
  const { count: opponentPitchCountSeed } =
    hittingAtBatIds.length > 0
      ? await supabase.from("pitches").select("id", { count: "exact", head: true }).in("at_bat_id", hittingAtBatIds)
      : { count: 0 };

  // Season stats for the batter card (Fix 3 layout) -- across every game
  // this team has played, not just this one; stolen bases aren't needed
  // for AVG/HR/RBI so [] is passed rather than a real fetch for it.
  const { data: teamGames } = await supabase.from("games").select("id").eq("team_id", teamId);
  const teamGameIds = (teamGames ?? []).map((g) => g.id);
  const { data: seasonAtBats } = teamGameIds.length
    ? await supabase
        .from("at_bats")
        .select("player_id, result, rbi, runs_scored")
        .in("game_id", teamGameIds)
        .not("confirmed_at", "is", null)
    : { data: [] };
  const seasonBattingLines = computeBattingLines(seasonAtBats ?? [], []);

  return (
    <OperatorConsole
      game={game}
      players={players ?? []}
      lineup={lineup ?? []}
      initialGameState={gameState}
      draftAtBat={draftAtBat}
      opponentPlayers={opponentPlayers ?? []}
      allGamePitches={allGamePitches ?? []}
      seasonBattingLines={Object.fromEntries(seasonBattingLines)}
      teamName={team?.name ?? "Us"}
      opponentPitchCountSeed={opponentPitchCountSeed ?? 0}
      initialSubstitutions={substitutions ?? []}
      fieldCalibration2d={(fieldCalibrationRow?.calibration_points as FieldCalibrationPoints | undefined) ?? null}
      fieldPositionsCalibration={(positionsCalibrationRow?.calibration_points as PlayerPositionCalibration | undefined) ?? null}
      season={season ?? null}
    />
  );
}
