"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type {
  AtBatMode,
  AtBatResult,
  FieldingPosition,
  GameEventType,
  HitType,
  InningHalf,
  LineupStatus,
  OutType,
  PitchOutcome,
  PitchType,
  Runners,
  SacrificeType,
  SubReason,
} from "@/lib/supabase/types";
import { atBatAccuracyRatio } from "@/lib/pitch-accuracy";
import { RESULT_IS_OUT } from "@/lib/operator/types";
import { nextBattingOrderPosition } from "@/lib/operator/batting-order";
import { assertGameIsActive } from "@/lib/operator/chain-substitution";
import { computeChainSlots, describeSlotError, applyChainWrites, type SlotRow, type ChainWriteOps } from "@/lib/operator/chain-slots";
import { parseVoiceCommand, type VoiceCommand } from "@/lib/anthropic";
import { generatePostGameAnalysis } from "@/lib/post-game-analysis";

// Reliability fix: every action in this file assumes a live, in-progress
// game -- none of them make sense (or were ever meant to run) once a
// game is completed/cancelled/still in setup. Nothing previously
// enforced that server-side; a stale operator tab left open from before
// a game ended, or a queued offline-retry closure, could still fire a
// mutation long after the game was over. That's exactly how Carlos De
// León's lineup slot got silently corrupted on 2026-11-08 -- a real
// confirmChainSubstitution call landed on this completed game about two
// seconds after a manual data fix, re-deriving a now-stale value. Gating
// here (rather than per-action) protects every current and future
// action in this file uniformly.
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
  assertGameIsActive(game);

  return { supabase, teamId: profile.team_id, game };
}

// Bug fix: game_state.batting_order_position was only ever set once, at
// game start -- no confirm path (Full or Quick Mode) wrote the advanced
// position back to it, so it only ever moved in the client's own
// in-memory reducer state. A reload that had no matching "dirty"
// localStorage snapshot (a different device, cleared site data, or a
// snapshot older than the last confirm) fell back to this stale server
// value instead of the real current batter. Computed from the lineup's
// own batting_order values server-side, with the same gap-aware helper
// the reducer uses, rather than trusted from the client -- same reasoning
// as lockLineup re-verifying density server-side instead of assuming it.
// Lineup rows aren't filtered by status here -- matching
// buildInitialStateFromServer's own battingOrderSlots derivation
// (initial-state.ts), which takes every row's batting_order and drops
// the nulls, since reserve/absent/late_arrival rows are always null
// there anyway (see lineup-builder.tsx's buildLineupPayload). Keeping
// both derivations identical is what makes "next" mean the same thing
// whether the reducer computes it locally or this computes it server-side.
async function occupiedBattingOrderSlots(supabase: ReturnType<typeof createClient>, gameId: string): Promise<number[]> {
  const { data } = await supabase.from("lineup").select("batting_order").eq("game_id", gameId);
  return (data ?? []).map((l) => l.batting_order).filter((n): n is number => n !== null);
}

async function advanceBattingOrder(supabase: ReturnType<typeof createClient>, gameId: string, mode: AtBatMode) {
  if (mode !== "hitting") return;
  const { data: gameState } = await supabase.from("game_state").select("batting_order_position").eq("game_id", gameId).single();
  if (!gameState) return;
  const slots = await occupiedBattingOrderSlots(supabase, gameId);
  const nextPosition = nextBattingOrderPosition(slots, gameState.batting_order_position ?? 1);
  await supabase.from("game_state").update({ batting_order_position: nextPosition }).eq("game_id", gameId);
}

// Batting-order Undo fix: this used to mirror advanceBattingOrder --
// read the CURRENT game_state.batting_order_position and compute one
// slot back from it. That's exactly the "forward or backward arithmetic"
// the bug report asked to remove: it silently gives the wrong answer if
// the position changed for any reason between this play's own forward
// advance and the Undo (a race between concurrent requests, a retried
// fire-and-forget write, anything) -- restoring a value that was never
// actually a function of "what it is right now" fixes that by
// construction. Replaced by a flat write in undoAtBat below, to the
// exact battingOrderPosition the client snapshotted in lastConfirmed
// before the play advanced it in the first place. No longer called from
// anywhere; kept deleted rather than orphaned.

// KAIROS batch, Tool 6: gated behind the same operator/coach auth every
// other action in this file uses, even though the parse itself doesn't
// touch this game's rows -- otherwise an unauthenticated caller could
// burn Anthropic API usage through this endpoint for free.
export async function parseVoicePitchCommand(gameId: string, transcript: string): Promise<VoiceCommand> {
  await requireOperatorGame(gameId);
  return parseVoiceCommand(transcript);
}

export async function getOrCreateGameState(gameId: string) {
  const { supabase, game } = await requireOperatorGame(gameId);

  const { data: existing } = await supabase.from("game_state").select("*").eq("game_id", gameId).maybeSingle();
  if (existing) return existing;

  // Top of inning 1: the away team bats first. If we're home, we start in
  // the field (pitching); if we're away, we start at bat (hitting).
  const initialMode: AtBatMode = game.home_away === "home" ? "pitching" : "hitting";

  // Feature 2 (game-rules batch): "starts automatically when the
  // operator taps Start Game" -- in practice, that's the moment this row
  // is first created, since Start Game (setup/actions.ts) immediately
  // navigates to the operator screen, whose first load is what calls
  // getOrCreateGameState. Set once, never updated again -- the timer is
  // computed client-side from this single timestamp.
  const { data: created, error } = await supabase
    .from("game_state")
    .insert({ game_id: gameId, mode: initialMode, batting_order_position: 1, game_started_at: new Date().toISOString() })
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
    current_opponent_pitcher_id: string | null;
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
    // Opponent pitcher intelligence batch: who's pitching for them,
    // mode 'hitting' only -- set here (draft creation), not at confirm
    // time, since it needs to reflect whoever was actually on the mound
    // for this specific at-bat, the same moment our own pitcher_id
    // already gets fixed for a pitching-mode at-bat.
    opponent_pitcher_id: string | null;
    // Clubhouse Pro enhancement, Part 4: outs/RISP snapshotted at the
    // exact moment this at-bat starts -- the only point they're ever
    // knowable, since game_state.outs/runners are live-only and keep
    // moving after this. See the migration's own comment.
    outs_before: number;
    risp_before: boolean;
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
      opponent_pitcher_id: input.opponent_pitcher_id,
      outs_before: input.outs_before,
      risp_before: input.risp_before,
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

// Quick Mode batch: one insert, already confirmed -- no draft phase, no
// pitches row ever created (that's the entire point of the mode). Same
// "skip pitch logging entirely" shape as confirmIntentionalWalk just
// above (awaited, not fire-and-forget -- the caller needs the real,
// server-generated id back before it can dispatch QUICK_CONFIRM_LOCAL).
export interface QuickAtBatInput {
  gameId: string;
  mode: AtBatMode;
  playerId: string | null;
  pitcherId: string | null;
  inning: number;
  inningHalf: InningHalf;
  battingOrderPosition: number | null;
  result: AtBatResult;
  hitType: HitType | null;
  rbi: number;
  runsScored: number;
  // Opponent pitcher intelligence batch: same field, mode 'hitting' only
  // -- Quick Mode at-bats can still be attributed to a specific opposing
  // pitcher even though they carry no pitch-level detail.
  opponentPitcherId: string | null;
  // Quick Mode scorekeeper batch: lets a button relabel its own result for
  // print/box-score purposes without needing a new AtBatResult value --
  // "Kl" (strikeout looking) and "Foul Out" both reuse an existing result
  // (strikeout / flyout) this way, the same relabeling precedent full
  // mode's own foul-territory result step already established (see
  // notationFor's "if (ab.scorebook_notation) return ab.scorebook_notation"
  // check in the scorebook page, which this feeds).
  scorebookNotation?: string | null;
  // Clubhouse Pro enhancement, Part 4: same snapshot startDraftAtBat
  // takes for full mode -- Quick Mode has no separate draft step, so
  // this is captured at the same moment the at-bat is logged.
  outsBefore: number;
  rispBefore: boolean;
  // Urgent mobile fixes, Fix 5: Quick Mode's own field-tap step (a
  // simplified field-diagram overlay shown after a ball-in-play result,
  // with a Skip option) -- null for anything skipped, or for a result
  // that never had a landing spot to begin with (strikeout/walk/HBP).
  fieldX?: number | null;
  fieldY?: number | null;
}

export async function logQuickAtBat(input: QuickAtBatInput): Promise<{ atBatId: string }> {
  const { supabase, game } = await requireOperatorGame(input.gameId);

  const { data, error: insertError } = await supabase
    .from("at_bats")
    .insert({
      game_id: input.gameId,
      player_id: input.playerId,
      pitcher_id: input.pitcherId,
      mode: input.mode,
      inning: input.inning,
      inning_half: input.inningHalf,
      batting_order_position: input.battingOrderPosition,
      result: input.result,
      hit_type: input.hitType,
      rbi: input.rbi,
      runs_scored: input.runsScored,
      is_out: RESULT_IS_OUT[input.result],
      opponent_pitcher_id: input.opponentPitcherId,
      scorebook_notation: input.scorebookNotation ?? null,
      outs_before: input.outsBefore,
      risp_before: input.rispBefore,
      field_x: input.fieldX ?? null,
      field_y: input.fieldY ?? null,
      confirmed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (insertError || !data) throw new Error(insertError?.message ?? "Failed to log at-bat");

  if (input.runsScored > 0) {
    const update =
      input.mode === "hitting"
        ? { our_score: game.our_score + input.runsScored }
        : { opponent_score: game.opponent_score + input.runsScored };
    await supabase.from("games").update(update).eq("id", input.gameId);
  }

  await advanceBattingOrder(supabase, input.gameId, input.mode);

  revalidatePath("/operator");
  return { atBatId: data.id };
}

export interface LogExtraOutInput {
  gameId: string;
  mode: AtBatMode;
  playerId: string | null;
  pitcherId: string | null;
  inning: number;
  inningHalf: InningHalf;
  // fix/dp-fc: a bare, already-confirmed is_out=true row for a runner
  // put out on the SAME play as an at-bat that's already been confirmed
  // separately (a double/triple play's extra out via the per-runner
  // outcome queue, or a fielder's-choice runner) -- never the batter's
  // own row, which confirmAtBat/confirmDoublePlay already handle. No
  // fielding chain/notation: this flow doesn't collect one (see
  // operator-console.tsx's finalizeRunnerOutcomeQueue/resolveFc).
  // `result` matches whatever the batter's own row ended up as
  // ("double_play" for the ground/fly/line-out case, "fc" for a
  // fielder's choice) so a scorebook reading both rows together sees a
  // consistent play, not two different outcomes for the same play.
  result: "double_play" | "fc";
}

export async function logExtraOut(input: LogExtraOutInput): Promise<{ atBatId: string }> {
  const { supabase } = await requireOperatorGame(input.gameId);

  const { data, error } = await supabase
    .from("at_bats")
    .insert({
      game_id: input.gameId,
      mode: input.mode,
      player_id: input.playerId,
      pitcher_id: input.pitcherId,
      inning: input.inning,
      inning_half: input.inningHalf,
      result: input.result,
      is_out: true,
      out_type: "force",
      rbi: 0,
      runs_scored: 0,
      confirmed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to log the extra out");

  // Bug 1 fix (fix/dp-fc follow-up): this row is never its own plate
  // appearance -- it's always the second half of a play whose batter
  // already confirmed (and already advanced the order) via confirmAtBat
  // or logQuickAtBat, called just before this. Advancing again here
  // moved game_state.batting_order_position two slots forward per play
  // while the client's own local state (and Undo's single
  // reverseBattingOrder call) only ever moved it one -- a server-side
  // drift that only surfaced on reload/resume, since the client's own
  // in-memory battingOrderPosition was never wrong to begin with.

  revalidatePath("/operator");
  return { atBatId: data.id };
}

// Quick Mode scorekeeper batch: a sac fly / squeeze play scores a runner
// through the diamond's own ad-hoc "Scored" path (applyRunnerAction),
// which only ever bumped the team score (adjustScore) -- it never wrote
// the RBI onto the batter's own at_bats row, in EITHER mode. Called only
// from the two call sites where the batter who should get credit is
// unambiguous (the sac-fly queue / squeeze prompt fire immediately after
// that specific batter's at-bat confirms) -- never from the generic
// ad-hoc runner-action path, where there's no reliable "current batter"
// to credit (see that path's own comment).
export async function incrementAtBatRbi(gameId: string, atBatId: string, delta: number) {
  const { supabase } = await requireOperatorGame(gameId);
  const { data: row } = await supabase.from("at_bats").select("rbi").eq("id", atBatId).single();
  if (!row) return;
  const { error } = await supabase.from("at_bats").update({ rbi: Math.max(0, row.rbi + delta) }).eq("id", atBatId);
  if (error) throw new Error(error.message);
  revalidatePath("/operator");
}

// Sacrifice-rules batch: called once the runnerOutcomeQueue (see
// operator-console.tsx) finishes asking about every runner on base after
// a fly/line/foul out or a bunt out at first -- a sacrifice is decided by
// what actually happened to the runners, never by which button was
// tapped, so this is always a follow-up update to an already-logged
// at-bat rather than something confirmAtBat/logQuickAtBat set directly.
export async function setSacrificeType(gameId: string, atBatId: string, sacrificeType: SacrificeType) {
  const { supabase } = await requireOperatorGame(gameId);
  const { error } = await supabase.from("at_bats").update({ sacrifice_type: sacrificeType }).eq("id", atBatId);
  if (error) throw new Error(error.message);
  revalidatePath("/operator");
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
  // Feature 1 (fielding-play logging batch): standard scorebook notation
  // ("F8", "L7", "5-3", "E5"), computed client-side.
  scorebookNotation?: string | null;
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
      scorebook_notation: input.scorebookNotation ?? null,
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

  await advanceBattingOrder(supabase, input.gameId, input.mode);

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
  // Fix 8 (baseball-logic-fixes batch, minor tier): present only for a
  // triple play -- structurally identical to the second out (its own
  // at_bats row, is_out true, fielded_by_*), so confirmDoublePlay handles
  // both rather than duplicating this whole function for one extra row.
  thirdOut?: {
    runner: { type: "player" | "opponent"; id: string | null };
    outType: OutType;
    fielding: { position: FieldingPosition; playerId: string | null; opponentPlayerId: string | null } | null;
  };
  // Feature 1 (fielding-play logging batch): stored once, on the
  // batter's own row -- matching how a real scorebook writes one
  // notation per play, not one per out recorded on it.
  scorebookNotation?: string | null;
}

// The batter's own draft row becomes the batter's out (always a force at
// 1st); a second, separately-created at_bats row records the runner also
// put out -- see 20260908150001_double_play_and_fielding.sql for why two
// rows (correct is_out-based innings-pitched counting while pitching; a
// documented minor over-count in the runner's own batting AB while hitting).
export async function confirmDoublePlay(
  input: ConfirmDoublePlayInput
): Promise<{ secondAtBatId: string; thirdAtBatId: string | null }> {
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
      scorebook_notation: input.scorebookNotation ?? null,
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

  let thirdAtBatId: string | null = null;
  if (input.thirdOut) {
    const { data: thirdRow, error: thirdError } = await supabase
      .from("at_bats")
      .insert({
        game_id: input.gameId,
        mode: input.mode,
        player_id: input.thirdOut.runner.type === "player" ? input.thirdOut.runner.id : null,
        pitcher_id: input.pitcherId,
        inning: input.inning,
        inning_half: input.inningHalf,
        result: "double_play",
        is_out: true,
        out_type: input.thirdOut.outType,
        rbi: 0,
        runs_scored: 0,
        fielded_by_position: input.thirdOut.fielding?.position ?? null,
        fielded_by_player_id: input.thirdOut.fielding?.playerId ?? null,
        fielded_by_opponent_player_id: input.thirdOut.fielding?.opponentPlayerId ?? null,
        confirmed_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (thirdError || !thirdRow) throw new Error(thirdError?.message ?? "Failed to log third out");
    thirdAtBatId = thirdRow.id;
  }

  await supabase.from("game_state").update({ current_at_bat_id: null }).eq("game_id", input.gameId);
  // Bug 1 fix (fix/dp-fc follow-up): same reasoning as logExtraOut's own
  // comment above -- the batter's own row (atBatId) was already
  // confirmed, and the order already advanced, via confirmAtBat or
  // logQuickAtBat before this function is ever called (it's always the
  // follow-up for a second/third out on that same play, never its own
  // plate appearance). confirmDoublePlay has no other caller now that
  // the old DoublePlayWizard is gone, so this call was always redundant
  // in the current architecture, not just in some cases.

  revalidatePath("/operator");
  return { secondAtBatId: secondRow.id, thirdAtBatId };
}

export interface ConfirmIntentionalWalkInput {
  gameId: string;
  mode: AtBatMode;
  playerId: string | null;
  pitcherId: string | null;
  inning: number;
  inningHalf: InningHalf;
  battingOrderPosition: number | null;
  runsScored: number;
  rbi: number;
  outsBefore: number;
  rispBefore: boolean;
}

// Bypasses the draft-at-bat lifecycle entirely (per spec: "do not require
// tapping the zone grid") -- the at_bats row is created already confirmed,
// with no pitches ever attached. Also bumps the pitcher's pitch count by 4
// server-side (mirroring the 4 balls a real intentional walk represents)
// in the same call, rather than a second round-trip.
export async function confirmIntentionalWalk(input: ConfirmIntentionalWalkInput): Promise<{ atBatId: string }> {
  const { supabase, game } = await requireOperatorGame(input.gameId);

  const { data, error } = await supabase
    .from("at_bats")
    .insert({
      game_id: input.gameId,
      mode: input.mode,
      player_id: input.playerId,
      pitcher_id: input.pitcherId,
      inning: input.inning,
      inning_half: input.inningHalf,
      batting_order_position: input.battingOrderPosition,
      result: "intentional_walk",
      rbi: input.rbi,
      runs_scored: input.runsScored,
      is_out: false,
      outs_before: input.outsBefore,
      risp_before: input.rispBefore,
      confirmed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to log intentional walk");

  await supabase.from("game_events").insert({
    game_id: input.gameId,
    inning: input.inning,
    inning_half: input.inningHalf,
    event_type: "intentional_walk",
    player_id: input.mode === "pitching" ? input.pitcherId : null,
  });

  if (input.runsScored > 0) {
    const update =
      input.mode === "hitting"
        ? { our_score: game.our_score + input.runsScored }
        : { opponent_score: game.opponent_score + input.runsScored };
    await supabase.from("games").update(update).eq("id", input.gameId);
  }

  if (input.mode === "pitching") {
    const { data: gs } = await supabase
      .from("game_state")
      .select("pitch_count_for_current_pitcher")
      .eq("game_id", input.gameId)
      .single();
    await supabase
      .from("game_state")
      .update({ pitch_count_for_current_pitcher: (gs?.pitch_count_for_current_pitcher ?? 0) + 4 })
      .eq("game_id", input.gameId);
  }

  await advanceBattingOrder(supabase, input.gameId, input.mode);

  revalidatePath("/operator");
  return { atBatId: data.id };
}

export async function undoAtBat(input: {
  gameId: string;
  atBatId: string;
  secondAtBatId?: string | null;
  // Fix 8 (baseball-logic-fixes batch, minor tier): a triple play's third
  // logged out, deleted the same way as the second.
  thirdAtBatId?: string | null;
  mode: AtBatMode;
  runsScoredToReverse: number;
  // Batting-order Undo fix: the exact game_state.batting_order_position
  // value from immediately before this play's own forward advance,
  // snapshotted client-side in lastConfirmed.battingOrderPosition at
  // confirm time (see reducer.ts) -- null for a pitching-mode play,
  // which never touches our own batting order at all. Written back
  // verbatim below; never recomputed from whatever the column currently
  // holds, so this can't drift no matter what else has touched it since.
  restoreBattingOrderPosition: number | null;
}) {
  const { supabase, game } = await requireOperatorGame(input.gameId);

  if (input.thirdAtBatId) {
    await supabase.from("pitches").delete().eq("at_bat_id", input.thirdAtBatId);
    await supabase.from("at_bats").delete().eq("id", input.thirdAtBatId);
  }
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

  if (input.mode === "hitting" && input.restoreBattingOrderPosition !== null) {
    await supabase.from("game_state").update({ batting_order_position: input.restoreBattingOrderPosition }).eq("game_id", input.gameId);
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
    eventType: GameEventType;
    inning: number;
    inningHalf: InningHalf;
    note?: string;
    mode: AtBatMode;
    runsScored?: number;
    // Run-attribution batch: our own roster only (the column's FK target
    // -- see the migration's own comment on why an opposing runner has
    // no equivalent), so this stays null for every opponent-scored event,
    // exactly as every such event already renders everywhere else.
    scorerPlayerId?: string | null;
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
    scorer_player_id: input.scorerPlayerId ?? null,
    runs_scored: input.runsScored ?? 0,
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

// Feature 1 (lineup-status batch): "Add to Reserve" flips the player's
// lineup.status from 'absent' to 'late_arrival' (substitution-eligible,
// same as a plain 'reserve', but keeps their late-arrival history
// visible -- see LineupStatus's own comment in supabase/types.ts).
// "Out of Game" leaves status untouched (still 'absent') -- the request's
// own "stays absent, just checking in" -- but the check-in is still
// worth a game_events row either way, hence logging it unconditionally.
export async function markLateArrival(
  gameId: string,
  input: { playerId: string; addToReserve: boolean; inning: number; inningHalf: InningHalf }
) {
  const { supabase, game } = await requireOperatorGame(gameId);

  if (input.addToReserve) {
    const { error } = await supabase
      .from("lineup")
      .update({ status: "late_arrival" })
      .eq("game_id", gameId)
      .eq("player_id", input.playerId);
    if (error) throw new Error(error.message);
  }

  const { error: eventError } = await supabase.from("game_events").insert({
    game_id: gameId,
    inning: input.inning,
    inning_half: input.inningHalf,
    event_type: "late_arrival",
    note: `Score at check-in: ${game.our_score}-${game.opponent_score}${input.addToReserve ? "" : " (out of game)"}`,
    player_id: input.playerId,
    opponent_player_id: null,
  });
  if (eventError) throw new Error(eventError.message);
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

// Feature 2 (lineup-status batch): a chain substitution can involve any
// number of players who simply changed defensive position without ever
// leaving the game (positionMoves) -- only one player actually enters
// the game (incomingPlayerId) and, in the common case, one actually
// leaves it (outgoingPlayerId, the one displaced last in the chain). The
// batting order slot follows that in/out pair exactly like a real
// substitution always does (the incoming player takes over the outgoing
// player's spot in the order) -- everyone else's batting order is
// untouched, since they're still in the game, just playing somewhere
// else.
//
// outgoingPlayerId is nullable: per the modal's own chain rules, a chain
// can terminate by the last mover landing on a position that was
// already *empty* (not "occupied, then vacated") -- an open roster spot
// simply absorbs them, and nobody goes to the bench at all. That case
// skips the outgoing lineup update and the `substitutions` row entirely
// (there's no real out/in pair to record there); the chain's full detail
// still lands in the game_events note either way.
export interface ChainSubstitutionInput {
  incomingPlayerId: string;
  entryPosition: string;
  outgoingPlayerId: string | null;
  positionMoves: { playerId: string; position: string }[];
  reason: SubReason;
  inning: number;
  inningHalf: InningHalf;
  // Feature 2: one human-readable sentence covering every movement in
  // the chain, e.g. "New Pitcher -> P position. Former Pitcher -> CF.
  // Former CF -> bench." -- stored as its own game_events row (note)
  // since the structured `substitutions` row can only ever represent one
  // in/out pair, not an arbitrary-length chain.
  chainNote: string;
}

// fix/chain-slots: the whole batting-order-slot decision (previously
// decideChainSubstitutionWrite, which the no-outgoing-player branch
// below used to skip calling entirely -- see src/lib/operator/chain-slots.ts's
// own top comment for why that was exactly the 2026-11-13 incident)
// now lives in computeChainSlots, run against a single fresh read of
// the WHOLE lineup rather than two targeted per-player lookups. There
// is no early skip left to bypass: every call, outgoing player or not,
// goes through the same validation.
export async function confirmChainSubstitution(gameId: string, input: ChainSubstitutionInput) {
  const { supabase } = await requireOperatorGame(gameId);

  const { data: lineupRows, error: lineupError } = await supabase.from("lineup").select("player_id, batting_order, position, status").eq("game_id", gameId);
  if (lineupError) throw new Error(lineupError.message);
  const preChainRows: SlotRow[] = (lineupRows ?? []).map((r) => ({ playerId: r.player_id, battingOrder: r.batting_order, position: r.position, status: r.status ?? "reserve" }));

  const result = computeChainSlots(preChainRows, {
    incomingPlayerId: input.incomingPlayerId,
    entryPosition: input.entryPosition,
    outgoingPlayerId: input.outgoingPlayerId,
    positionMoves: input.positionMoves,
  });
  if (!result.ok) {
    // Loud by construction: this is the exact guard that used to be
    // unreachable whenever outgoingPlayerId was null. Every chain, with
    // or without a named outgoing player, is validated here before a
    // single row is written.
    throw new Error(describeSlotError(result));
  }

  // Retry-safety: a repeat submission of the exact same already-applied
  // chain (a retry-queue replay, a double tap) naturally recomputes to
  // no actual change for every touched row once the first attempt has
  // already landed -- computeChainSlots reads the CURRENT lineup fresh
  // every time, it never trusts a value a prior run might have already
  // moved. Detected here as "nothing to write" rather than a separate
  // existing-substitution lookup, since a multi-hop chain can produce
  // more than one substitutions pair now, not just the one pair the old
  // single-lookup check could represent.
  const preChainByPlayer = new Map(preChainRows.map((r) => [r.playerId, r]));
  const realUpdates = result.updates.filter((u) => {
    const before = preChainByPlayer.get(u.playerId);
    return !before || before.battingOrder !== u.battingOrder || before.position !== u.position || before.status !== u.status;
  });
  if (realUpdates.length === 0) return;

  const substitutionPairsToInsert = [];
  for (const pair of result.substitutionPairs) {
    const { data: existingSub, error: existingSubError } = await supabase
      .from("substitutions")
      .select("id")
      .eq("game_id", gameId)
      .eq("player_out_id", pair.playerOutId)
      .eq("player_in_id", pair.playerInId)
      .maybeSingle();
    if (existingSubError) throw new Error(existingSubError.message);
    if (!existingSub) substitutionPairsToInsert.push(pair);
  }

  // "Atomic or restored": every lineup row this chain touches is
  // written, then the substitutions row(s), then the game_events note --
  // if any single write in that sequence fails, every row this attempt
  // already changed is written back to its exact pre-chain value, and
  // any substitutions/game_events rows this attempt already inserted
  // are deleted, before the error reaches the caller. See
  // applyChainWrites' own comment for why this is a compensating-write
  // sequence, not a real database transaction (no migration in this
  // batch, so no Postgres function to wrap one in).
  const ops: ChainWriteOps = {
    async updateLineupRow(playerId, values) {
      const { data, error } = await supabase
        .from("lineup")
        .update({ batting_order: values.battingOrder, position: values.position, status: values.status as LineupStatus })
        .eq("game_id", gameId)
        .eq("player_id", playerId)
        .select("id");
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) {
        throw new Error("Cannot complete this substitution: no lineup row found for a player in this chain.");
      }
    },
    async insertSubstitution(pair) {
      const { data, error } = await supabase
        .from("substitutions")
        .insert({ game_id: gameId, player_out_id: pair.playerOutId, player_in_id: pair.playerInId, reason: input.reason, inning: input.inning, inning_half: input.inningHalf })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    },
    async deleteSubstitution(id) {
      await supabase.from("substitutions").delete().eq("id", id);
    },
    async insertGameEvent() {
      const { data, error } = await supabase
        .from("game_events")
        .insert({
          game_id: gameId,
          inning: input.inning,
          inning_half: input.inningHalf,
          event_type: "substitution",
          note: input.chainNote,
          player_id: input.incomingPlayerId,
          opponent_player_id: null,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    },
    async deleteGameEvent(id) {
      await supabase.from("game_events").delete().eq("id", id);
    },
  };

  await applyChainWrites(ops, preChainRows, { updates: realUpdates, substitutionPairs: substitutionPairsToInsert });
}

// Loud-substitutions batch: called by the client right after a
// successful confirmChainSubstitution, so the lineup strip reflects
// exactly what the database now holds instead of the client's own
// optimistic guess of what the write did. Deliberately a full
// replacement of every lineup row for this game (not a diff) -- the
// caller doesn't need to know which rows changed, and a full re-read
// can't drift from the real state the way hand-patching individual
// rows locally already proved it could.
export async function getLineupForGame(gameId: string) {
  const { supabase } = await requireOperatorGame(gameId);
  const { data, error } = await supabase.from("lineup").select("*").eq("game_id", gameId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function endGame(gameId: string, notes: string) {
  const { supabase, game } = await requireOperatorGame(gameId);

  const { data: atBats } = await supabase
    .from("at_bats")
    .select("id, result")
    .eq("game_id", gameId)
    .not("confirmed_at", "is", null);

  let totalRatio = 0;
  let count = 0;
  // Quick Mode batch: every at-bat in a quick-mode game has 0 pitches by
  // design, not by an operator falling behind -- atBatAccuracyRatio would
  // score nearly every one of them as a logging failure, dragging this
  // game's score toward 0% for no real reason. Same "this metric doesn't
  // apply here" treatment as intentional walks get within a full-mode
  // game (see CONFIRM_INTENTIONAL_WALK's own comment) -- left null,
  // rather than computed and misleading.
  if (game.logging_mode !== "quick" && atBats && atBats.length > 0) {
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

  // Part 4 (post-game loss analysis): awaited, not fire-and-forget --
  // an unawaited promise started here has no guarantee of finishing on
  // Vercel's serverless functions, which can tear down once this
  // action's own response is sent. That would mean "the coach is told
  // an analysis exists" with a real risk it silently never gets written.
  // The cost is a slower End Game submission specifically after a loss
  // (Opus, not instant) -- accepted deliberately over a fire-and-forget
  // that might just never complete. A failed analysis call is caught and
  // swallowed here rather than failing the whole End Game submission --
  // the score/accuracy data above is already saved by this point, and a
  // missing AI analysis is recoverable (the coach can still see it's
  // absent), unlike losing the game record itself.
  if (game.our_score < game.opponent_score) {
    try {
      await generatePostGameAnalysis(supabase, gameId, game.team_id, "post_game_loss");
    } catch {
      // Swallowed deliberately -- see comment above.
    }
  }

  revalidatePath("/operator");
  revalidatePath("/coach");

  return { accuracyScore, atBatsLogged: count };
}
