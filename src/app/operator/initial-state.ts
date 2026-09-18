import type { Database } from "@/lib/supabase/types";
import { initialOperatorState } from "@/lib/operator/reducer";
import type { LocalPitch, OperatorState } from "@/lib/operator/types";
import type { AtBatResult } from "@/lib/supabase/types";
import { RUNNING_ACCURACY_WARNING_THRESHOLD, runningAccuracy } from "@/lib/pitch-accuracy";

type GameRow = Database["public"]["Tables"]["games"]["Row"];
type GameStateRow = Database["public"]["Tables"]["game_state"]["Row"];
type AtBatRow = Database["public"]["Tables"]["at_bats"]["Row"];
type PitchRow = Database["public"]["Tables"]["pitches"]["Row"];

export function buildInitialStateFromServer(
  game: GameRow,
  gs: GameStateRow,
  draft: (AtBatRow & { pitches: PitchRow[] }) | null,
  allGamePitches: Pick<PitchRow, "pitch_number" | "pitch_type" | "zone_x" | "zone_y" | "outcome">[] = [],
  // Addition 2: there's no game_state column for this (no schema change
  // for a display-only figure), so unlike pitchCountForCurrentPitcher it
  // can't be read straight off `gs` -- the caller (page.tsx) computes it
  // with its own query (pitches joined through at_bats.mode = 'hitting')
  // and passes the result in here as a plain seed value.
  opponentPitchCountSeed = 0
): OperatorState {
  const base = initialOperatorState(game.id);

  let balls = 0;
  let strikes = 0;
  const pendingPitches: LocalPitch[] = [];
  let lastPitchZone: OperatorState["lastPitchZone"] = null;

  if (draft) {
    const sorted = [...draft.pitches].sort((a, b) => a.pitch_number - b.pitch_number);
    for (const p of sorted) {
      pendingPitches.push({
        pitch_number: p.pitch_number,
        pitch_type: p.pitch_type,
        zone_x: p.zone_x,
        zone_y: p.zone_y,
        outcome: p.outcome,
        swing: p.swing,
      });
      if (p.outcome === "ball") balls = Math.min(4, balls + 1);
      else if (p.outcome === "strike") strikes = Math.min(3, strikes + 1);
      else if (p.outcome === "foul" && strikes < 2) strikes += 1;
      if (p.zone_x !== null && p.zone_y !== null) {
        lastPitchZone = { x: p.zone_x, y: p.zone_y, outcome: p.outcome };
      }
    }
  }

  const awaitingResult = balls >= 4 || strikes >= 3;
  const suggestedResult: AtBatResult | null = balls >= 4 ? "walk" : strikes >= 3 ? "strikeout" : null;

  return {
    ...base,
    mode: gs.mode,
    inning: gs.inning,
    inningHalf: gs.inning_half,
    outs: gs.outs,
    ourScore: game.our_score,
    opponentScore: game.opponent_score,
    battingOrderPosition: gs.batting_order_position ?? 1,
    currentPitcherId: gs.current_pitcher_id,
    opponentBatterName: gs.opponent_batter_name ?? "",
    runners: gs.runners ?? {},
    currentAtBatId: draft?.id ?? null,
    balls,
    strikes,
    pendingPitches,
    gamePitchLog: allGamePitches.map((p) => ({
      pitch_number: p.pitch_number,
      pitch_type: p.pitch_type,
      zone_x: p.zone_x,
      zone_y: p.zone_y,
      outcome: p.outcome,
    })),
    lastPitchZone,
    awaitingResult,
    suggestedResult,
    pitchCountForCurrentPitcher: gs.pitch_count_for_current_pitcher,
    opponentPitchCount: opponentPitchCountSeed,
    pitchCountAck75: gs.pitch_count_ack_75,
    pitchCountAck85: gs.pitch_count_ack_85,
    pitchCountAck100: gs.pitch_count_ack_100,
    // Repurposed rather than adding new game_state columns: logging_accuracy_score
    // holds the running ratio *sum* (not the averaged score itself) and
    // consecutive_low_accuracy_at_bats holds the at-bat *count* -- together
    // they let the running average survive a resume on a different device.
    accuracyRatioSum: gs.logging_accuracy_score ?? 0,
    accuracyAtBatCount: gs.consecutive_low_accuracy_at_bats,
    showLowAccuracyWarning:
      runningAccuracy(gs.logging_accuracy_score ?? 0, gs.consecutive_low_accuracy_at_bats) < RUNNING_ACCURACY_WARNING_THRESHOLD,
  };
}
