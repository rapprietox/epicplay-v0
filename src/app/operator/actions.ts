"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type {
  AtBatMode,
  AtBatResult,
  FieldingPosition,
  HitType,
  InningHalf,
  OutType,
  PitchOutcome,
  PitchType,
  Runners,
  SubReason,
} from "@/lib/supabase/types";
import { atBatAccuracyRatio } from "@/lib/pitch-accuracy";

async function requireOperatorGame(gameId: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, team_id")
    .eq("id", user.id)
    .single();
  if (!profile || !["coach", "operator"].includes(profile.role) || !profile.team_id) {
    throw new Error("Not authorized");
  }

  const { data: game } = await supabase
    .from("games")
    .select("*")
    .eq("id", gameId)
    .eq("team_id", profile.team_id)
    .single();
  if (!game) throw new Error("Game not found");

  return { supabase, teamId: profile.team_id, game };
}

export async function getOrCreateGameState(gameId: string) {
  const { supabase, game } = await requireOperatorGame(gameId);

  const { data: existing } = await supabase.from("game_state").select("*").eq("game_id", gameId).maybeSingle();
  if (existing) return existing;

  // Top of inning 1: the away team bats first. If we're home, we start in
  // the field (pitching); if we're away, we start at bat (hitting).
  const initialMode: AtBatMode = game.home_away === "home" ? "pitching" : "hitting";

  const { data: created, error } = await supabase
    .from("game_state")
    .insert({ game_id: gameId, mode: initialMode, batting_order_position: 1 })
    .select("*")
    .single();
  if (error || !created) throw new Error(error?.message ?? "Failed to create game state");
  return created;
}

export async function syncGameState(
  gameId: string,
  patch: Partial<{
    inning: number;
    inning_half: InningHalf;
    outs: number;
    mode: AtBatMode;
    batting_order_position: number | null;
    current_at_bat_id: string | null;
    current_pitcher_id: string | null;
    opponent_batter_name: string | null;
    runners: Runners;
    pitch_count_for_current_pitcher: number;
    pitch_count_ack_75: boolean;
    pitch_count_ack_85: boolean;
    pitch_count_ack_100: boolean;
    consecutive_low_accuracy_at_bats: number;
    logging_accuracy_score: number | null;
  }>
) {
  const { supabase } = await requireOperatorGame(gameId);
  const { error } = await supabase
    .from("game_state")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("game_id", gameId);
  if (error) throw new Error(error.message);
}

export async function startDraftAtBat(
  gameId: string,
  input: {
    mode: AtBatMode;
    player_id: string | null;
    pitcher_id: string | null;
    inning: number;
    inning_half: InningHalf;
    batting_order_position: number | null;
  }
): Promise<string> {
  const { supabase } = await requireOperatorGame(gameId);

  const { data, error } = await supabase
    .from("at_bats")
    .insert({
      game_id: gameId,
      mode: input.mode,
      player_id: input.player_id,
      pitcher_id: input.pitcher_id,
      inning: input.inning,
      inning_half: input.inning_half,
      batting_order_position: input.batting_order_position,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to start at-bat");

  await supabase.from("game_state").update({ current_at_bat_id: data.id }).eq("game_id", gameId);

  return data.id;
}

export async function logPitch(input: {
  gameId: string;
  atBatId: string;
  pitchNumber: number;
  pitchType: PitchType | null;
  zoneX: number | null;
  zoneY: number | null;
  outcome: PitchOutcome;
  swing: boolean | null;
  isPitchingMode: boolean;
}) {
  const { supabase } = await requireOperatorGame(input.gameId);

  const { error } = await supabase.from("pitches").insert({
    at_bat_id: input.atBatId,
    pitch_number: input.pitchNumber,
    pitch_type: input.pitchType,
    zone_x: input.zoneX,
    zone_y: input.zoneY,
    outcome: input.outcome,
    swing: input.swing,
  });
  if (error) throw new Error(error.message);

  if (input.isPitchingMode) {
    const { data: state } = await supabase
      .from("game_state")
      .select("pitch_count_for_current_pitcher")
      .eq("game_id", input.gameId)
      .single();
    await supabase
      .from("game_state")
      .update({ pitch_count_for_current_pitcher: (state?.pitch_count_for_current_pitcher ?? 0) + 1 })
      .eq("game_id", input.gameId);
  }
}

export interface ConfirmAtBatInput {
  gameId: string;
  atBatId: string;
  mode: AtBatMode;
  result: AtBatResult;
  hitType: HitType | null;
  fieldX: number | null;
  fieldY: number | null;
  rbi: number;
  runsScored: number;
  isOut: boolean;
  outType?: OutType | null;
  fieldedByPosition?: FieldingPosition | null;
  fieldedByPlayerId?: string | null;
  fieldedByOpponentPlayerId?: string | null;
}

export async function confirmAtBat(input: ConfirmAtBatInput) {
  const { supabase, game } = await requireOperatorGame(input.gameId);

  const { error: updateError } = await supabase
    .from("at_bats")
    .update({
      result: input.result,
      hit_type: input.hitType,
      field_x: input.fieldX,
      field_y: input.fieldY,
      rbi: input.rbi,
      runs_scored: input.runsScored,
      is_out: input.isOut,
      out_type: input.outType ?? null,
      fielded_by_position: input.fieldedByPosition ?? null,
      fielded_by_player_id: input.fieldedByPlayerId ?? null,
      fielded_by_opponent_player_id: input.fieldedByOpponentPlayerId ?? null,
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", input.atBatId);
  if (updateError) throw new Error(updateError.message);

  if (input.runsScored > 0) {
    const update =
      input.mode === "hitting"
        ? { our_score: game.our_score + input.runsScored }
        : { opponent_score: game.opponent_score + input.runsScored };
    await supabase.from("games").update(update).eq("id", input.gameId);
  }

  const { count: pitchCount } = await supabase
    .from("pitches")
    .select("id", { count: "exact", head: true })
    .eq("at_bat_id", input.atBatId);

  const ratio = atBatAccuracyRatio(input.result, pitchCount ?? 0);

  // logging_accuracy_score holds the running ratio *sum* (not the average)
  // and consecutive_low_accuracy_at_bats holds the at-bat *count* --
  // repurposed rather than adding new game_state columns; see initial-state.ts.
  const { data: state } = await supabase.from("game_state").select("*").eq("game_id", input.gameId).single();
  const nextSum = (state?.logging_accuracy_score ?? 0) + ratio;
  const nextCount = (state?.consecutive_low_accuracy_at_bats ?? 0) + 1;

  if (state) {
    await supabase
      .from("game_state")
      .update({
        current_at_bat_id: null,
        logging_accuracy_score: nextSum,
        consecutive_low_accuracy_at_bats: nextCount,
      })
      .eq("game_id", input.gameId);
  }

  revalidatePath("/operator");
  return { accuracyRatio: ratio, runningAccuracy: nextCount > 0 ? nextSum / nextCount : 1 };
}

export interface ConfirmDoublePlayInput {
  gameId: string;
  atBatId: string;
  mode: AtBatMode;
  inning: number;
  inningHalf: InningHalf;
  pitcherId: string | null;
  hitType: HitType | null;
  fieldX: number | null;
  fieldY: number | null;
  batterFielding: { position: FieldingPosition; playerId: string | null; opponentPlayerId: string | null } | null;
  secondOutRunner: { type: "player" | "opponent"; id: string | null };
  outType: OutType;
  secondOutFielding: { position: FieldingPosition; playerId: string | null; opponentPlayerId: string | null } | null;
}

// The batter's own draft row becomes the batter's out (always a force at
// 1st); a second, separately-created at_bats row records the runner also
// put out -- see 20260908150001_double_play_and_fielding.sql for why two
// rows (correct is_out-based innings-pitched counting while pitching; a
// documented minor over-count in the runner's own batting AB while hitting).
export async function confirmDoublePlay(input: ConfirmDoublePlayInput): Promise<{ secondAtBatId: string }> {
  const { supabase } = await requireOperatorGame(input.gameId);

  const { error: batterError } = await supabase
    .from("at_bats")
    .update({
      result: "double_play",
      hit_type: input.hitType,
      field_x: input.fieldX,
      field_y: input.fieldY,
      rbi: 0,
      runs_scored: 0,
      is_out: true,
      out_type: "force",
      fielded_by_position: input.batterFielding?.position ?? null,
      fielded_by_player_id: input.batterFielding?.playerId ?? null,
      fielded_by_opponent_player_id: input.batterFielding?.opponentPlayerId ?? null,
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", input.atBatId);
  if (batterError) throw new Error(batterError.message);

  const { data: secondRow, error: secondError } = await supabase
    .from("at_bats")
    .insert({
      game_id: input.gameId,
      mode: input.mode,
      player_id: input.secondOutRunner.type === "player" ? input.secondOutRunner.id : null,
      pitcher_id: input.pitcherId,
      inning: input.inning,
      inning_half: input.inningHalf,
      result: "double_play",
      is_out: true,
      out_type: input.outType,
      rbi: 0,
      runs_scored: 0,
      fielded_by_position: input.secondOutFielding?.position ?? null,
      fielded_by_player_id: input.secondOutFielding?.playerId ?? null,
      fielded_by_opponent_player_id: input.secondOutFielding?.opponentPlayerId ?? null,
      confirmed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (secondError || !secondRow) throw new Error(secondError?.message ?? "Failed to log second out");

  await supabase.from("game_state").update({ current_at_bat_id: null }).eq("game_id", input.gameId);

  revalidatePath("/operator");
  return { secondAtBatId: secondRow.id };
}

export async function undoAtBat(input: {
  gameId: string;
  atBatId: string;
  secondAtBatId?: string | null;
  mode: AtBatMode;
  runsScoredToReverse: number;
}) {
  const { supabase, game } = await requireOperatorGame(input.gameId);

  if (input.secondAtBatId) {
    await supabase.from("pitches").delete().eq("at_bat_id", input.secondAtBatId);
    await supabase.from("at_bats").delete().eq("id", input.secondAtBatId);
  }
  await supabase.from("pitches").delete().eq("at_bat_id", input.atBatId);
  const { error } = await supabase.from("at_bats").delete().eq("id", input.atBatId);
  if (error) throw new Error(error.message);

  if (input.runsScoredToReverse > 0) {
    const update =
      input.mode === "hitting"
        ? { our_score: Math.max(0, game.our_score - input.runsScoredToReverse) }
        : { opponent_score: Math.max(0, game.opponent_score - input.runsScoredToReverse) };
    await supabase.from("games").update(update).eq("id", input.gameId);
  }

  revalidatePath("/operator");
}

export async function logStolenBase(gameId: string, playerId: string, inning: number) {
  const { supabase } = await requireOperatorGame(gameId);
  const { error } = await supabase.from("stolen_bases").insert({ game_id: gameId, player_id: playerId, inning });
  if (error) throw new Error(error.message);
}

// Ad-hoc score adjustment for a runner marked "Scored" on the diamond
// outside the at-bat confirmation flow (e.g. a delayed steal of home, or
// correcting a missed call) -- when it happens as part of confirming an
// at-bat, confirmAtBat's runsScored already covers it and this isn't called.
export async function adjustScore(gameId: string, mode: AtBatMode, delta: number) {
  const { supabase, game } = await requireOperatorGame(gameId);
  const update =
    mode === "hitting"
      ? { our_score: Math.max(0, game.our_score + delta) }
      : { opponent_score: Math.max(0, game.opponent_score + delta) };
  const { error } = await supabase.from("games").update(update).eq("id", gameId);
  if (error) throw new Error(error.message);
}

export async function logGameEvent(
  gameId: string,
  input: {
    eventType: "wild_pitch" | "passed_ball" | "balk" | "error";
    inning: number;
    inningHalf: InningHalf;
    note?: string;
    mode: AtBatMode;
    runsScored?: number;
    playerId?: string | null;
    opponentPlayerId?: string | null;
  }
) {
  const { supabase, game } = await requireOperatorGame(gameId);
  const { error } = await supabase.from("game_events").insert({
    game_id: gameId,
    inning: input.inning,
    inning_half: input.inningHalf,
    event_type: input.eventType,
    note: input.note ?? null,
    player_id: input.playerId ?? null,
    opponent_player_id: input.opponentPlayerId ?? null,
  });
  if (error) throw new Error(error.message);

  if (input.runsScored && input.runsScored > 0) {
    const update =
      input.mode === "hitting"
        ? { our_score: game.our_score + input.runsScored }
        : { opponent_score: game.opponent_score + input.runsScored };
    await supabase.from("games").update(update).eq("id", gameId);
  }
}

export async function saveSubstitution(
  gameId: string,
  input: { playerOutId: string; playerInId: string; reason: SubReason; inning: number; inningHalf: InningHalf }
) {
  const { supabase } = await requireOperatorGame(gameId);
  const { error } = await supabase.from("substitutions").insert({
    game_id: gameId,
    player_out_id: input.playerOutId,
    player_in_id: input.playerInId,
    reason: input.reason,
    inning: input.inning,
    inning_half: input.inningHalf,
  });
  if (error) throw new Error(error.message);
}

export async function endGame(gameId: string, notes: string) {
  const { supabase } = await requireOperatorGame(gameId);

  const { data: atBats } = await supabase
    .from("at_bats")
    .select("id, result")
    .eq("game_id", gameId)
    .not("confirmed_at", "is", null);

  let totalRatio = 0;
  let count = 0;
  if (atBats && atBats.length > 0) {
    const { data: pitches } = await supabase
      .from("pitches")
      .select("at_bat_id")
      .in(
        "at_bat_id",
        atBats.map((ab) => ab.id)
      );
    const countsByAtBat = new Map<string, number>();
    for (const p of pitches ?? []) {
      countsByAtBat.set(p.at_bat_id, (countsByAtBat.get(p.at_bat_id) ?? 0) + 1);
    }
    for (const ab of atBats) {
      if (!ab.result) continue;
      totalRatio += atBatAccuracyRatio(ab.result, countsByAtBat.get(ab.id) ?? 0);
      count += 1;
    }
  }
  // Stored as a 0-1 float (not 0-100) per the Sprint 4 spec.
  const accuracyScore = count > 0 ? Math.round((totalRatio / count) * 1000) / 1000 : null;

  const { error } = await supabase
    .from("games")
    .update({ status: "completed", notes, logging_accuracy_score: accuracyScore })
    .eq("id", gameId);
  if (error) throw new Error(error.message);

  revalidatePath("/operator");
  revalidatePath("/coach");

  return { accuracyScore, atBatsLogged: count };
}
