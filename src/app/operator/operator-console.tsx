"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  AtBatResult,
  BattingHand,
  Database,
  FieldingPosition,
  GameEventType,
  HitType,
  OutType,
  PitchOutcome,
  PitchType,
  RunnerState,
  Runners,
} from "@/lib/supabase/types";
import { operatorReducer, UNDO_WINDOW_MS, advanceAllRunnersOneBase } from "@/lib/operator/reducer";
import { advanceOneRunner, suggestRunnerAdvance } from "@/lib/operator/runner-advance";
import { resolveFielder, type ResolvedFielder } from "@/lib/operator/fielding";
import {
  RESULT_IS_OUT,
  RESULT_LABELS,
  PITCH_TYPE_LABELS,
  HIT_TYPE_LABELS,
  HIT_TYPE_RESULT_OPTIONS,
  FIELDABLE_OUT_RESULTS,
  FIELDING_LAYOUT,
  OUTCOME_LABELS,
  SCORE_METHOD_AWARDS_RBI,
  SCORE_METHOD_EVENT,
  SCORE_METHOD_LABELS,
  resultToScoreMethod,
  type Base,
  type RunnerQuickAction,
  type ScoreMethod,
} from "@/lib/operator/types";
import { atBatAccuracyRatio, runningAccuracy } from "@/lib/pitch-accuracy";
import { loadOperatorStateLocal, saveOperatorStateLocal } from "@/lib/operator/local-storage";
import { withOfflineRetry, onQueueChange, pendingCount } from "@/lib/operator/sync-queue";
import { buildInitialStateFromServer } from "./initial-state";
import {
  adjustScore,
  confirmAtBat,
  confirmDoublePlay,
  confirmIntentionalWalk,
  logGameEvent,
  logPitch,
  logStolenBase,
  saveSubstitution,
  startDraftAtBat,
  syncGameState,
  undoAtBat,
} from "./actions";
import { StrikeZoneGrid, OUTCOME_COLOR, classifyZone } from "./strike-zone-grid";
import { FieldDiagram } from "./field-diagram";
import { BaserunnerDiamond } from "./baserunner-diamond";
import { SubstitutionPanel } from "./substitution-panel";
import { PitchCountModal } from "./pitch-count-modal";
import { PostGameSummary } from "./post-game-summary";
import { StadiumBackground } from "@/components/stadium-background";

type Game = Database["public"]["Tables"]["games"]["Row"];
type Player = Database["public"]["Tables"]["players"]["Row"];
type Lineup = Database["public"]["Tables"]["lineup"]["Row"];
type GameState = Database["public"]["Tables"]["game_state"]["Row"];
type AtBat = Database["public"]["Tables"]["at_bats"]["Row"];
type Pitch = Database["public"]["Tables"]["pitches"]["Row"];
type OpponentPlayer = Database["public"]["Tables"]["opponent_players"]["Row"];

const PITCH_TYPES: PitchType[] = ["fastball", "curveball", "changeup", "slider", "2seam", "other"];
const SCORE_METHODS: ScoreMethod[] = ["hit", "sac_fly", "forced_walk_hbp", "wild_pitch", "passed_ball", "balk", "error"];

interface DpWizardState {
  step: "runner" | "type" | "fielding1" | "fielding2";
  base?: Base;
  outType: OutType;
  firstFielding?: ResolvedFielder;
}

export function OperatorConsole({
  game,
  players,
  lineup,
  initialGameState,
  draftAtBat,
  opponentPlayers,
  allGamePitches,
}: {
  game: Game;
  players: Player[];
  lineup: Lineup[];
  initialGameState: GameState;
  draftAtBat: (AtBat & { pitches: Pitch[] }) | null;
  opponentPlayers: OpponentPlayer[];
  allGamePitches: Pick<Pitch, "pitch_number" | "pitch_type" | "zone_x" | "zone_y" | "outcome">[];
}) {
  const router = useRouter();
  // Fix 3: was a Link rendered by page.tsx as a `fixed left-3 top-3`
  // overlay, independent of this console's own header -- which put it
  // directly on top of the HITTING/PITCHING toggle also anchored top-left.
  // Moved into the header itself (top right) so it's part of the normal
  // layout instead of a separately-positioned overlay that can collide
  // with anything else near that corner, and gained a confirmation dialog
  // it never had (a stray tap could previously leave the game instantly).
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  // Deterministic on both server and client -- must never read localStorage
  // here. This function is Next.js's SSR pass for the initial HTML AND the
  // client's first render before hydration; if it returned a localStorage
  // snapshot on the client but not the server (localStorage doesn't exist
  // during SSR), the two renders would produce different batter/inning/
  // score text and React would throw a hydration mismatch the moment any
  // operator had an unsynced snapshot sitting in their browser.
  const [state, dispatch] = useReducer(operatorReducer, undefined, () =>
    buildInitialStateFromServer(game, initialGameState, draftAtBat, allGamePitches)
  );

  // Swapping in a recovered localStorage snapshot happens *after* mount
  // instead, once hydration has already matched the server output --
  // this is what the reducer's HYDRATE action is for.
  useEffect(() => {
    const local = loadOperatorStateLocal(game.id);
    if (local && local.dirty) dispatch({ type: "HYDRATE", state: local });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id]);

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const t = setInterval(() => saveOperatorStateLocal(stateRef.current), 5000);
    return () => clearInterval(t);
  }, []);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const [pendingSync, setPendingSync] = useState(0);
  useEffect(() => onQueueChange(setPendingSync), []);
  useEffect(() => setPendingSync(pendingCount()), []);

  const [banner, setBanner] = useState<string | null>(null);
  const [runnerPicker, setRunnerPicker] = useState<Base | null>(null);
  const [runnerActionMenu, setRunnerActionMenu] = useState<Base | null>(null);
  const [scoreMethodPrompt, setScoreMethodPrompt] = useState<{ base: Base; runner: RunnerState } | null>(null);
  // Fix 2: a generic "Out" on a runner now asks why before applying it --
  // "Picked Off" keeps its own unambiguous one-tap path unchanged (see
  // below), this is only for the generic case.
  const [outReasonPrompt, setOutReasonPrompt] = useState<{ base: Base; runner: RunnerState } | null>(null);
  const [pitcherPickerOpen, setPitcherPickerOpen] = useState(false);
  const [dpWizard, setDpWizard] = useState<DpWizardState | null>(null);
  // Fix 2: two-step pickoff wizard (pick the base, then the result) opened
  // from the quick-actions panel -- separate from the existing per-base
  // "Picked Off" runner quick-action (tap an occupied base -> its menu),
  // which stays as the quick single-tap path and still doesn't log a
  // game_events row (see CLAUDE.md). This one always does, and adds the
  // "attempted, runner safe" outcome that quick-action never had.
  const [pickoffWizard, setPickoffWizard] = useState<{ step: "base" | "result"; base?: Base } | null>(null);
  // Fix 4: shown after a flyout at-bat confirms, offering to record a
  // runner who left a base early and got doubled off on appeal -- a
  // second, separate out from the fly out itself. Cleared automatically
  // once the next batter's first pitch starts a new draft at-bat (the
  // appeal window has passed), or by an explicit "No"/tap-a-runner choice.
  const [tagUpPrompt, setTagUpPrompt] = useState(false);
  // Fix 4 (Intentional Walk): a plain confirmation gate before committing --
  // bypasses pitch logging entirely, so there's no popup/zone step to
  // confirm through the way a normal at-bat has.
  const [ibbConfirmOpen, setIbbConfirmOpen] = useState(false);
  // Fix 1: pitch type is now step 1 of the same zone-tap popup, asked
  // before the outcome menu, instead of a persistent top-bar pill row
  // picked before tapping. false = still showing the "what pitch was it"
  // menu; true = pitch type is settled (including "Unknown" -> null,
  // still a deliberate choice, not "not asked yet") and the outcome menu
  // should show instead. Local UI state, not reducer state -- it's purely
  // "which half of this one popup are we on," reset whenever a new zone
  // tap starts a fresh pitch.
  const [pitchTypeStepDone, setPitchTypeStepDone] = useState(false);
  useEffect(() => {
    setPitchTypeStepDone(false);
  }, [state.selectedZone?.x, state.selectedZone?.y]);
  const [sessionHeatMapOpen, setSessionHeatMapOpen] = useState(false);
  const [summaryFlash, setSummaryFlash] = useState<string | null>(null);
  // Fix 5: bumped (never reset to 0) on every ball/strike/foul/HBP so
  // StrikeZoneGrid's flash overlay remounts and its CSS animation restarts
  // -- "In Play" deliberately never bumps this, since that outcome moves
  // straight to the field diagram instead of resetting for another pitch.
  const [flashKey, setFlashKey] = useState(0);

  useEffect(() => {
    if (!summaryFlash) return;
    const t = setTimeout(() => setSummaryFlash(null), 2500);
    return () => clearTimeout(t);
  }, [summaryFlash]);

  useEffect(() => {
    if (state.currentAtBatId) setTagUpPrompt(false);
  }, [state.currentAtBatId]);

  const battingPlayer = useMemo(
    () => (state.mode === "hitting" ? lineup.find((l) => l.batting_order === state.battingOrderPosition) : undefined),
    [lineup, state.mode, state.battingOrderPosition]
  );
  const battingPlayerInfo = useMemo(
    () => (battingPlayer ? players.find((p) => p.id === battingPlayer.player_id) : undefined),
    [battingPlayer, players]
  );

  // Fix 1/4: a live, per-at-bat override of the batter's hand -- not
  // written back to players.batting_hand (this fix needs no schema
  // change; that stays the profile's system of record). Auto-seeded from
  // the profile whenever a *new* batter steps up (battingPlayerInfo?.id
  // changing), but freely one-tap-correctable at any point during that
  // same at-bat per Fix 4, with no confirmation -- it only feeds this
  // at-bat's own HBP-zone-eligibility check. Opponent batters (mode ===
  // "pitching") have no hand data source at all (opponent_players has no
  // such column, same as before this fix) so this stays null there and
  // the selector itself isn't shown.
  const [atBatBattingHand, setAtBatBattingHand] = useState<BattingHand | null>(null);
  useEffect(() => {
    setAtBatBattingHand(battingPlayerInfo?.batting_hand ?? null);
    // Deliberately keyed on the batter's identity, not the hand value --
    // this should only re-seed when a *new* batter steps up. players is
    // static per page load, so the value can't actually change out from
    // under the same id, but keying on id alone states the real intent
    // (new batter -> reseed) more clearly than the value would.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battingPlayerInfo?.id]);

  const currentPitcher = useMemo(
    () => players.find((p) => p.id === state.currentPitcherId),
    [players, state.currentPitcherId]
  );

  function currentBatterRunner(): RunnerState {
    if (state.mode === "hitting") {
      return {
        type: "player",
        id: battingPlayerInfo?.id ?? null,
        name: battingPlayerInfo?.name ?? "Batter",
        jersey: battingPlayerInfo?.jersey_number ? String(battingPlayerInfo.jersey_number) : null,
      };
    }
    return { type: "opponent", id: null, name: state.opponentBatterName || "Batter" };
  }

  function syncRunners(next: Runners) {
    void withOfflineRetry(`runners-${game.id}-${Date.now()}`, () => syncGameState(game.id, { runners: next }));
  }

  function resolve(position: FieldingPosition): ResolvedFielder {
    return resolveFielder(position, state.mode, lineup, players, opponentPlayers);
  }

  async function ensureDraftAtBat(): Promise<string> {
    if (state.currentAtBatId) return state.currentAtBatId;
    const id = await startDraftAtBat(game.id, {
      mode: state.mode,
      player_id: state.mode === "hitting" ? (battingPlayer?.player_id ?? null) : null,
      pitcher_id: state.mode === "pitching" ? state.currentPitcherId : null,
      inning: state.inning,
      inning_half: state.inningHalf,
      batting_order_position: state.mode === "hitting" ? state.battingOrderPosition : null,
    });
    dispatch({ type: "START_DRAFT_LOCAL", atBatId: id });
    return id;
  }

  async function handlePitchOutcome(outcome: PitchOutcome, swing: boolean) {
    if (state.outs >= 3) return;
    setBanner(null);
    let atBatId: string;
    try {
      atBatId = await ensureDraftAtBat();
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "Could not start at-bat -- check connection and try again");
      return;
    }
    const pitchNumber = state.pendingPitches.length + 1;
    const pitchType = state.selectedPitchType;
    const zone = state.selectedZone;

    // Mirrors the reducer's own ball/strike-count logic so the runner
    // suggestion (which needs roster/opponent-name context the reducer
    // doesn't have) can be attached in the same tick a walk/strikeout/HBP
    // auto-completes the at-bat.
    let autoResult: AtBatResult | null = null;
    if (outcome === "hbp") autoResult = "hbp";
    else if (outcome === "ball" && state.balls + 1 >= 4) autoResult = "walk";
    else if (outcome === "strike" && state.strikes + 1 >= 3) autoResult = "strikeout";

    dispatch({ type: "LOG_PITCH_LOCAL", outcome, swing });
    // Fix 5: confirmation flash for every outcome except "In Play" -- that
    // one transitions straight into the field-diagram sub-flow instead of
    // resetting the grid for another pitch, so a flash there would just be
    // a distraction on the way out.
    if (outcome !== "inplay") setFlashKey((k) => k + 1);
    void withOfflineRetry(`pitch-${atBatId}-${pitchNumber}`, () =>
      logPitch({
        gameId: game.id,
        atBatId,
        pitchNumber,
        pitchType,
        zoneX: zone?.x ?? null,
        zoneY: zone?.y ?? null,
        outcome,
        swing,
        isPitchingMode: state.mode === "pitching",
      })
    );

    if (autoResult) pickResult(autoResult);
  }

  function handleHitTypeTap(hitType: HitType) {
    dispatch({ type: "SET_HIT_TYPE", hitType: state.pendingHitType === hitType ? null : hitType });
    // HR is the one hit type with only one sensible result -- skip the
    // result-menu step entirely rather than making the operator tap twice.
    if (hitType === "hr" && state.pendingHitType !== hitType) pickResult("hr");
  }

  // baseRunners defaults to the current state, but Fix 3/6 (wild
  // pitch/passed ball landing as the 4th ball) needs to compute the
  // resulting walk's force-cascade on top of runners already moved by the
  // wild pitch's own one-base advance -- a snapshot state.runners hasn't
  // caught up to yet within the same synchronous handler.
  function pickResult(result: AtBatResult, baseRunners: Runners = state.runners) {
    if (result === "double_play") {
      setDpWizard({ step: "runner", outType: "force" });
      return;
    }
    const batter = currentBatterRunner();
    const { runners: suggestion, scored } = suggestRunnerAdvance(baseRunners, batter, result);
    const method = resultToScoreMethod(result);
    const taggedScored = scored.map((r) => ({ runner: r, method }));
    const hasMovement = scored.length > 0 || JSON.stringify(suggestion) !== JSON.stringify(baseRunners);
    dispatch({ type: "SET_RESULT", result, suggestion, scored: taggedScored, hasMovement });
    if (hasMovement) syncRunners(suggestion);
  }

  async function handleConfirm() {
    const result = state.suggestedResult;
    const atBatId = state.currentAtBatId;
    if (!result || !atBatId) return;
    const isOut = RESULT_IS_OUT[result];
    const runsScored = state.scoredThisAtBat.length;
    const accuracyRatio = atBatAccuracyRatio(result, state.pendingPitches.length);
    const hitType = state.pendingHitType;
    const fieldX = state.fieldTap?.x ?? null;
    const fieldY = state.fieldTap?.y ?? null;
    const rbi = state.pendingRbi;
    const mode = state.mode;
    const fielding = state.pendingFielding;

    dispatch({ type: "CONFIRM_LOCAL", atBatId, outsRecorded: isOut ? 1 : 0, accuracyRatio });
    setSummaryFlash(
      [RESULT_LABELS[result], hitType ? HIT_TYPE_LABELS[hitType] : null, fielding?.position ?? null].filter(Boolean).join(" — ")
    );
    // Fix 4: only offer the tag-up appeal when there's actually a runner
    // left on base to appeal against.
    if (result === "flyout" && Object.values(state.runners).some(Boolean)) setTagUpPrompt(true);

    void withOfflineRetry(`confirm-${atBatId}`, async () => {
      await confirmAtBat({
        gameId: game.id,
        atBatId,
        mode,
        result,
        hitType,
        fieldX,
        fieldY,
        rbi,
        runsScored,
        isOut,
        fieldedByPosition: fielding?.position ?? null,
        fieldedByPlayerId: fielding?.playerId ?? null,
        fieldedByOpponentPlayerId: fielding?.opponentPlayerId ?? null,
      });
    });
  }

  async function handleConfirmDoublePlay(input: {
    base: Base;
    runner: RunnerState;
    outType: OutType;
    batterFielding: ResolvedFielder;
    secondFielding: ResolvedFielder;
  }) {
    const atBatId = state.currentAtBatId;
    if (!atBatId) return;
    setDpWizard(null);
    setBanner(null);
    try {
      const { secondAtBatId } = await confirmDoublePlay({
        gameId: game.id,
        atBatId,
        mode: state.mode,
        inning: state.inning,
        inningHalf: state.inningHalf,
        pitcherId: state.mode === "pitching" ? state.currentPitcherId : null,
        hitType: state.pendingHitType,
        fieldX: state.fieldTap?.x ?? null,
        fieldY: state.fieldTap?.y ?? null,
        batterFielding: {
          position: input.batterFielding.position,
          playerId: input.batterFielding.playerId,
          opponentPlayerId: input.batterFielding.opponentPlayerId,
        },
        secondOutRunner: { type: input.runner.type, id: input.runner.id },
        outType: input.outType,
        secondOutFielding: {
          position: input.secondFielding.position,
          playerId: input.secondFielding.playerId,
          opponentPlayerId: input.secondFielding.opponentPlayerId,
        },
      });
      const accuracyRatio = atBatAccuracyRatio("double_play", state.pendingPitches.length);
      dispatch({ type: "CONFIRM_DOUBLE_PLAY", atBatId, secondAtBatId, removedBase: input.base, accuracyRatio });
      setSummaryFlash("Double Play");
      void withOfflineRetry(`dp-state-${game.id}-${Date.now()}`, () =>
        syncGameState(game.id, {
          runners: { ...state.runners, [input.base]: null },
          outs: Math.min(3, state.outs + 2),
          current_at_bat_id: null,
        })
      );
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "Failed to log double play -- check connection and try again");
    }
  }

  async function handleUndo() {
    if (!state.lastConfirmed) return;
    const { atBatId, secondAtBatId, mode, runsScored, runnersBeforeAtBat } = state.lastConfirmed;
    dispatch({ type: "UNDO_LOCAL" });
    syncRunners(runnersBeforeAtBat);
    void withOfflineRetry(`undo-${atBatId}`, () =>
      undoAtBat({ gameId: game.id, atBatId, secondAtBatId, mode, runsScoredToReverse: runsScored })
    );
  }

  function selectRunner(base: Base, runner: RunnerState | null) {
    dispatch({ type: "SET_RUNNER", base, runner });
    setRunnerPicker(null);
    syncRunners({ ...state.runners, [base]: runner });
  }

  async function handleQuickEvent(eventType: "wild_pitch" | "passed_ball" | "balk" | "error") {
    // Fix 3/6: a wild pitch or passed ball is *always* a ball -- unlike a
    // balk (runners just advance, count is untouched), it also logs a real
    // "ball" pitches row (zone/type unknown, no tap happened for it) so
    // the count survives a reload the same way every other pitch does,
    // not just a local counter bump that a resume would silently lose.
    if (eventType === "wild_pitch" || eventType === "passed_ball") {
      let atBatId: string;
      try {
        atBatId = await ensureDraftAtBat();
      } catch (err) {
        setBanner(err instanceof Error ? err.message : "Could not start at-bat -- check connection and try again");
        return;
      }
      const pitchNumber = state.pendingPitches.length + 1;
      const ballsAfter = Math.min(4, state.balls + 1);
      dispatch({ type: "LOG_PITCH_LOCAL", outcome: "ball", swing: false });
      void withOfflineRetry(`pitch-${atBatId}-${pitchNumber}`, () =>
        logPitch({
          gameId: game.id,
          atBatId,
          pitchNumber,
          pitchType: null,
          zoneX: null,
          zoneY: null,
          outcome: "ball",
          swing: false,
          isPitchingMode: state.mode === "pitching",
        })
      );

      const advance = advanceAllRunnersOneBase(state.runners);
      dispatch({ type: "ADVANCE_ALL_RUNNERS_LOCAL", result: advance });
      const fielder = eventType === "wild_pitch" ? resolve("P") : resolve("C");
      void withOfflineRetry(`event-${game.id}-${Date.now()}`, () =>
        logGameEvent(game.id, {
          eventType,
          inning: state.inning,
          inningHalf: state.inningHalf,
          mode: state.mode,
          runsScored: advance.scored.length,
          playerId: fielder?.playerId ?? null,
          opponentPlayerId: fielder?.opponentPlayerId ?? null,
        })
      );

      // The walk's own force-cascade applies on top of the wild
      // pitch/passed ball's one-base advance, not the pre-advance runners.
      if (ballsAfter >= 4) pickResult("walk", advance.runners);
      return;
    }

    const result = advanceAllRunnersOneBase(state.runners);
    dispatch({ type: "ADVANCE_ALL_RUNNERS_LOCAL", result });
    // Balk is not a ball -- runners just advance, the count is untouched.
    if (eventType === "balk") setSummaryFlash("Balk — all runners advance");
    // balk is unambiguously on the pitcher. "error" has no single obvious
    // fielder here (unlike Fix 6's picker, this all-runners quick action
    // doesn't ask which position), so it's logged without attribution
    // rather than guessing one.
    const fielder = eventType === "balk" ? resolve("P") : null;
    void withOfflineRetry(`event-${game.id}-${Date.now()}`, () =>
      logGameEvent(game.id, {
        eventType,
        inning: state.inning,
        inningHalf: state.inningHalf,
        mode: state.mode,
        runsScored: result.scored.length,
        playerId: fielder?.playerId ?? null,
        opponentPlayerId: fielder?.opponentPlayerId ?? null,
      })
    );
  }

  function applyRunnerAction(base: Base, action: RunnerQuickAction, scoreMethod?: ScoreMethod) {
    const runner = state.runners[base];
    if (!runner) return;

    if (action === "scored" && !scoreMethod) {
      setRunnerActionMenu(null);
      setScoreMethodPrompt({ base, runner });
      return;
    }

    dispatch({ type: "APPLY_RUNNER_ACTION", base, action, scoreMethod });
    setRunnerActionMenu(null);
    setScoreMethodPrompt(null);

    if (action === "advance" || action === "stolen_base" || action === "error_advance") {
      const advanced = advanceOneRunner(state.runners, base);
      syncRunners(advanced.runners);
      if (action === "stolen_base" && runner.type === "player" && runner.id) {
        void withOfflineRetry(`sb-${game.id}-${Date.now()}`, () => logStolenBase(game.id, runner.id!, state.inning));
      }
      if (action === "error_advance") {
        // No fielder picker in this quick action -- logged without
        // attribution rather than guessing a position.
        void withOfflineRetry(`event-${game.id}-${Date.now()}`, () =>
          logGameEvent(game.id, {
            eventType: "error",
            inning: state.inning,
            inningHalf: state.inningHalf,
            mode: state.mode,
          })
        );
      }
      return;
    }

    const nextRunners = { ...state.runners, [base]: null };
    if (action === "out" || action === "picked_off") {
      void withOfflineRetry(`runneraction-${game.id}-${Date.now()}`, () =>
        syncGameState(game.id, { runners: nextRunners, outs: Math.min(3, state.outs + 1) })
      );
      return;
    }

    // scored
    syncRunners(nextRunners);
    const eventType = scoreMethod ? SCORE_METHOD_EVENT[scoreMethod] : undefined;
    if (eventType) {
      // wild_pitch/balk -> pitcher, passed_ball -> catcher; "error" (no
      // picker in this sub-menu) is logged without a guessed fielder.
      const fielder = eventType === "wild_pitch" || eventType === "balk" ? resolve("P") : eventType === "passed_ball" ? resolve("C") : null;
      void withOfflineRetry(`event-${game.id}-${Date.now()}`, () =>
        logGameEvent(game.id, {
          eventType,
          inning: state.inning,
          inningHalf: state.inningHalf,
          mode: state.mode,
          playerId: fielder?.playerId ?? null,
          opponentPlayerId: fielder?.opponentPlayerId ?? null,
        })
      );
    }
    if (!state.awaitingResult) {
      // Ad-hoc, outside the at-bat review flow -- confirmAtBat's runsScored
      // already covers the in-review case (RBI included), so this only
      // fires when there's no upcoming Confirm At-Bat to carry the run.
      // RBI isn't attributed here -- there's no "current batter" in an
      // ad-hoc context to credit it to.
      void withOfflineRetry(`score-${game.id}-${Date.now()}`, () => adjustScore(game.id, state.mode, 1));
    }
  }

  // Fix 2 (this batch): the out still counts immediately via the same
  // applyRunnerAction("out") path as before -- this just adds the
  // game_events row the reason implies, one extra tap after "Out" rather
  // than a separate confirmation step.
  function handleRunnerOutWithReason(base: Base, eventType: GameEventType) {
    setOutReasonPrompt(null);
    applyRunnerAction(base, "out");
    void withOfflineRetry(`outreason-${game.id}-${Date.now()}`, () =>
      logGameEvent(game.id, {
        eventType,
        inning: state.inning,
        inningHalf: state.inningHalf,
        mode: state.mode,
      })
    );
  }

  // Fix 2, step 2 of the pickoff wizard.
  function handlePickoffResult(base: Base, outcome: "out" | "safe") {
    const runner = state.runners[base];
    setPickoffWizard(null);
    if (!runner) return;
    const fielder = resolve("P");
    if (outcome === "out") {
      applyRunnerAction(base, "picked_off");
      setSummaryFlash(`Pickoff — ${runner.name} out at ${base}`);
      void withOfflineRetry(`pickoff-${game.id}-${Date.now()}`, () =>
        logGameEvent(game.id, {
          eventType: "pickoff_out",
          inning: state.inning,
          inningHalf: state.inningHalf,
          mode: state.mode,
          playerId: fielder?.playerId ?? null,
          opponentPlayerId: fielder?.opponentPlayerId ?? null,
        })
      );
    } else {
      setSummaryFlash(`Pickoff attempt — ${runner.name} safe`);
      void withOfflineRetry(`pickoff-${game.id}-${Date.now()}`, () =>
        logGameEvent(game.id, {
          eventType: "pickoff_attempt",
          inning: state.inning,
          inningHalf: state.inningHalf,
          mode: state.mode,
          playerId: fielder?.playerId ?? null,
          opponentPlayerId: fielder?.opponentPlayerId ?? null,
        })
      );
    }
  }

  // Fix 4: an appeal-play out separate from the fly out that just ended
  // the at-bat -- reuses the same "out" runner-action path (removes the
  // runner, increments outs, which the always-rendered ThreeOutsModal
  // reacts to on its own if this is out #3) and additionally logs its own
  // game_events row. No fielder picker here (the spec didn't ask for one),
  // same "log without a guessed attribution" precedent as error_advance.
  function handleTagUpViolation(base: Base) {
    const runner = state.runners[base];
    setTagUpPrompt(false);
    if (!runner) return;
    applyRunnerAction(base, "out");
    setSummaryFlash(`${runner.name} — Out, left base early`);
    void withOfflineRetry(`tagup-${game.id}-${Date.now()}`, () =>
      logGameEvent(game.id, {
        eventType: "tag_up_violation",
        inning: state.inning,
        inningHalf: state.inningHalf,
        mode: state.mode,
      })
    );
  }

  // Fix 4: Intentional Walk. Deliberately bypasses ensureDraftAtBat/the
  // pitch popup entirely (per spec) -- the at_bats row is created already
  // confirmed by confirmIntentionalWalk, in one call. Reuses
  // suggestRunnerAdvance's existing walk/hbp force-cascade (aliased to
  // "intentional_walk" in runner-advance.ts) rather than re-deriving the
  // same force logic. Note: awards an RBI when a bases-loaded walk forces
  // a run home, *not* "no RBI" as literally requested -- that's actual
  // MLB scoring rule 9.04(a) (a bases-loaded walk/HBP that forces in a run
  // always credits the batter with an RBI, intentional or not), and this
  // codebase's own resultToScoreMethod already scores a regular walk that
  // way. Implementing "no RBI" as asked would have made intentional walks
  // less accurate than regular ones for no real reason.
  async function handleIntentionalWalk() {
    if (state.outs >= 3 || state.currentAtBatId) return;
    const batter = currentBatterRunner();
    const { runners: suggestion, scored } = suggestRunnerAdvance(state.runners, batter, "intentional_walk");
    const runsScored = scored.length;
    const runnersBeforeAtBat = state.runners;
    try {
      const { atBatId } = await confirmIntentionalWalk({
        gameId: game.id,
        mode: state.mode,
        playerId: state.mode === "hitting" ? (battingPlayer?.player_id ?? null) : null,
        pitcherId: state.mode === "pitching" ? state.currentPitcherId : null,
        inning: state.inning,
        inningHalf: state.inningHalf,
        battingOrderPosition: state.mode === "hitting" ? state.battingOrderPosition : null,
        runsScored,
        rbi: runsScored,
      });
      dispatch({ type: "CONFIRM_INTENTIONAL_WALK", atBatId, runners: suggestion, runsScored, runnersBeforeAtBat });
      syncRunners(suggestion);
      setSummaryFlash(`Intentional Walk — ${batter.name} to 1st`);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "Failed to log intentional walk -- check connection and try again");
    }
  }

  // Fix 5: a direct HBP shortcut for when the operator knows it was a hit
  // batter without having tapped the exact zone -- forces zone null
  // (rather than trusting state.selectedZone to already be null, in case
  // a zone tap was mid-flight when this got tapped instead) and clears
  // any in-flight zone selection so a stray popup can't linger. Otherwise
  // identical to a zone-tapped HBP: LOG_PITCH_LOCAL's own "hbp" branch
  // already never touches balls/strikes, so this "counts as a pitch but
  // not a ball or strike" for free, no special-casing needed.
  async function handleDirectHbp() {
    if (state.outs >= 3) return;
    setBanner(null);
    let atBatId: string;
    try {
      atBatId = await ensureDraftAtBat();
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "Could not start at-bat -- check connection and try again");
      return;
    }
    const pitchNumber = state.pendingPitches.length + 1;
    const pitchType = state.selectedPitchType;
    dispatch({ type: "CLEAR_ZONE_SELECTION" });
    dispatch({ type: "LOG_PITCH_LOCAL", outcome: "hbp", swing: false });
    void withOfflineRetry(`pitch-${atBatId}-${pitchNumber}`, () =>
      logPitch({
        gameId: game.id,
        atBatId,
        pitchNumber,
        pitchType,
        zoneX: null,
        zoneY: null,
        outcome: "hbp",
        swing: false,
        isPitchingMode: state.mode === "pitching",
      })
    );
    pickResult("hbp");
  }

  function confirmEndInning() {
    dispatch({ type: "END_INNING_LOCAL" });
    const nextHalf = state.inningHalf === "top" ? "bottom" : "top";
    const nextInning = state.inningHalf === "bottom" ? state.inning + 1 : state.inning;
    const weAreHitting = (game.home_away === "home") === (nextHalf === "bottom");
    dispatch({ type: "SET_MODE", mode: weAreHitting ? "hitting" : "pitching" });
    void withOfflineRetry(`endinning-${game.id}-${Date.now()}`, () =>
      syncGameState(game.id, {
        inning: nextInning,
        inning_half: nextHalf,
        outs: 0,
        runners: {},
        current_at_bat_id: null,
        mode: weAreHitting ? "hitting" : "pitching",
      })
    );
  }

  const atBatsLogged = 0; // computed on the post-game screen from a fresh fetch there instead

  const showFieldingPicker =
    !!state.fieldTap &&
    !!state.suggestedResult &&
    (FIELDABLE_OUT_RESULTS.includes(state.suggestedResult) || state.suggestedResult === "error") &&
    !state.pendingFielding;

  // Sequential flow (Fix 4): each tap contextually reveals the next
  // decision. All five steps fall out of state the reducer already
  // tracked before this fix (awaitingResult/suggestedResult/fieldTap/
  // pendingHitType/pendingFielding/runnersPendingConfirmation) -- this is
  // purely a view-layer derivation, no new state machine was needed.
  type FlowStep = "pitch" | "field" | "hitType" | "result" | "fielding" | "runnerConfirm";
  const flowStep: FlowStep = !state.awaitingResult
    ? "pitch"
    : state.suggestedResult === null
      ? !state.fieldTap
        ? "field"
        : !state.pendingHitType
          ? "hitType"
          : "result"
      : showFieldingPicker
        ? "fielding"
        : "runnerConfirm";

  // Once nothing is left to fill in, confirm automatically instead of
  // making the operator tap a separate "Confirm At-Bat" button -- walks,
  // strikeouts, HBPs, and now every in-play result too. Runner movement
  // still gets an explicit "Confirm & Continue" tap first (below) since
  // that's real judgment, not a formality. Declared above the postGameOpen
  // early return below -- hooks can't follow a conditional return.
  useEffect(() => {
    if (state.postGameOpen) return;
    if (flowStep !== "runnerConfirm") return;
    if (state.runnersPendingConfirmation) return;
    if (!state.currentAtBatId) return;
    void handleConfirm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowStep, state.runnersPendingConfirmation, state.currentAtBatId, state.postGameOpen]);

  if (state.postGameOpen) {
    return (
      <PostGameSummary
        gameId={game.id}
        opponentName={game.opponent_name}
        ourScore={state.ourScore}
        opponentScore={state.opponentScore}
        inningsPlayed={state.inning}
        atBatsLogged={atBatsLogged}
        pitchesLogged={state.pendingPitches.length}
      />
    );
  }

  const undoRemaining = state.lastConfirmed ? Math.max(0, state.lastConfirmed.deadline - now) : 0;
  const undoActive = state.lastConfirmed !== null && undoRemaining > 0 && !state.currentAtBatId;

  const pitchCountColor =
    state.mode === "pitching"
      ? state.pitchCountForCurrentPitcher >= 85
        ? "text-accent-red"
        : state.pitchCountForCurrentPitcher >= 75
          ? "text-accent-amber"
          : "text-foreground/60"
      : "text-foreground/60";

  const runningAccuracyPercent = Math.round(runningAccuracy(state.accuracyRatioSum, state.accuracyAtBatCount) * 100);

  return (
    <div className="min-h-screen pb-24 text-foreground">
      <StadiumBackground />
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex rounded-md border border-border p-1 text-xs">
            {(["hitting", "pitching"] as const).map((m) => (
              <button
                key={m}
                onClick={() => dispatch({ type: "SET_MODE", mode: m })}
                className={`rounded px-4 py-1.5 font-semibold uppercase tracking-wide transition ${
                  state.mode === m ? "bg-accent-primary text-white" : "text-foreground/50"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <p className="font-heading text-2xl font-bold text-white">
            {state.inningHalf === "top" ? "Top" : "Bot"} {state.inning}
          </p>
        </div>
        <div className="flex items-center gap-4">
          {state.accuracyAtBatCount > 0 && (
            <span className={`text-xs ${runningAccuracyPercent < 70 ? "text-accent-amber" : "text-foreground/50"}`}>
              Logging: {runningAccuracyPercent}% accurate
            </span>
          )}
          {pendingSync > 0 && (
            <span className="rounded-full bg-accent-amber/20 px-3 py-1 text-xs text-accent-amber">
              {pendingSync} syncing…
            </span>
          )}
          <p className="font-heading text-xl font-bold text-white">
            {game.home_away === "home" ? game.opponent_name : "Us"}{" "}
            <span className="text-accent-green">{state.opponentScore}</span> &ndash;{" "}
            <span className="text-accent-green">{state.ourScore}</span>{" "}
            {game.home_away === "home" ? "Us" : game.opponent_name}
          </p>
          <button
            onClick={() => setLeaveConfirmOpen(true)}
            className="text-xs text-foreground/40 hover:text-white"
          >
            ← Dashboard
          </button>
        </div>
      </header>

      <BoxScoreDashboard state={state} />

      {state.showLowAccuracyWarning && (
        <div className="bg-accent-amber/10 px-4 py-2 text-center text-xs text-accent-amber">
          Low pitch detail — heat map accuracy is reduced
        </div>
      )}
      {state.mode === "pitching" && state.pitchCountForCurrentPitcher >= 85 && (
        <div className="bg-accent-red/10 px-4 py-2 text-center text-xs font-semibold text-accent-red">
          High pitch count
        </div>
      )}
      {state.mode === "pitching" && state.pitchCountForCurrentPitcher >= 75 && state.pitchCountForCurrentPitcher < 85 && (
        <div className="bg-accent-amber/10 px-4 py-2 text-center text-xs font-semibold text-accent-amber">
          Approaching pitch limit
        </div>
      )}
      {banner && <div className="bg-accent-red/10 px-4 py-2 text-center text-xs text-accent-red">{banner}</div>}

      <div className="grid grid-cols-1 gap-6 p-4 md:grid-cols-2">
        {/* LEFT COLUMN -- the sequential pitch-logging conversation */}
        <div className="flex flex-col gap-4">
          <div className="glossy glow-green rounded-lg border border-accent-primary/40 bg-card p-4">
            {state.mode === "hitting" ? (
              <>
                <p className="text-xs uppercase tracking-wide text-foreground/40">
                  Batting {state.battingOrderPosition} of 9
                </p>
                <p className="font-heading flex items-baseline gap-2 text-3xl font-bold text-white">
                  {battingPlayerInfo ? `#${battingPlayerInfo.jersey_number ?? "—"} ${battingPlayerInfo.name}` : "—"}
                  {battingPlayerInfo && (
                    <span className="rounded border border-accent-primary/50 px-1.5 py-0.5 text-xs font-semibold text-accent-primary">
                      {battingPlayerInfo.batting_hand ?? "R"}
                    </span>
                  )}
                </p>
              </>
            ) : (
              <>
                <p className="text-xs uppercase tracking-wide text-foreground/40">Opposing batter</p>
                <input
                  value={state.opponentBatterName}
                  onChange={(e) => dispatch({ type: "SET_OPPONENT_BATTER_NAME", name: e.target.value })}
                  list="opponent-batters"
                  placeholder="Type or select name"
                  className="font-heading w-full border-b border-border bg-transparent text-3xl font-bold text-white outline-none focus:border-accent-primary"
                />
                <datalist id="opponent-batters">
                  {opponentPlayers.map((p) => (
                    <option key={p.id} value={p.name} />
                  ))}
                </datalist>
                <div className="mt-3 flex items-center justify-between text-xs">
                  <button onClick={() => setPitcherPickerOpen(true)} className="text-accent-primary hover:underline">
                    Pitcher: {currentPitcher ? currentPitcher.name : "Select…"}
                  </button>
                  <span className={pitchCountColor}>
                    {state.pendingPitches.length} this at-bat · {state.pitchCountForCurrentPitcher} total
                  </span>
                </div>
              </>
            )}
          </div>

          <div className="glossy grid grid-cols-3 gap-3 rounded-lg border border-border bg-surface p-4 text-center">
            <CountBlock label="Balls" value={state.balls} />
            <CountBlock label="Strikes" value={state.strikes} />
            <CountBlock label="Outs" value={state.outs} />
          </div>

          {summaryFlash && (
            <div className="glossy rounded-lg border border-accent-green/50 bg-accent-green/10 px-4 py-2 text-center">
              <p className="font-heading text-sm font-semibold text-accent-green">{summaryFlash}</p>
            </div>
          )}

          {tagUpPrompt && (
            <div className="glossy rounded-lg border border-accent-amber/50 bg-accent-amber/10 p-3">
              <p className="text-xs text-accent-amber">Did any runner leave early and get thrown out?</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(["first", "second", "third"] as Base[])
                  .filter((b) => state.runners[b])
                  .map((b) => (
                    <button
                      key={b}
                      onClick={() => handleTagUpViolation(b)}
                      className="min-h-[40px] rounded-md border border-accent-amber/60 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-amber/20"
                    >
                      {state.runners[b]!.name} ({b}) — Out, left early
                    </button>
                  ))}
                <button
                  onClick={() => setTagUpPrompt(false)}
                  className="min-h-[40px] rounded-md border border-border px-3 py-1.5 text-xs text-foreground/60"
                >
                  No
                </button>
              </div>
            </div>
          )}

          <div key={flowStep} className="flex flex-col items-center gap-3 transition-opacity duration-200">
            {flowStep === "pitch" && (
              <>
                <div className="flex w-full max-w-[280px] items-center justify-between">
                  <p className="text-xs uppercase tracking-wide text-foreground/40">
                    {sessionHeatMapOpen ? "Session heat map" : "Strike zone — tap to log a pitch"}
                  </p>
                  <button
                    onClick={() => setSessionHeatMapOpen((v) => !v)}
                    className="rounded-full border border-border px-3 py-1 text-[11px] font-medium text-foreground/70 hover:border-accent-primary hover:text-white"
                  >
                    {sessionHeatMapOpen ? "Back to Logging" : "Session Heat Map"}
                  </button>
                </div>

                {state.mode === "hitting" && !sessionHeatMapOpen && (
                  <BatterHandSelector value={atBatBattingHand} onChange={setAtBatBattingHand} />
                )}

                <StrikeZoneGrid
                  selectedZone={state.selectedZone}
                  lastPitchZone={state.lastPitchZone}
                  pendingPitches={state.pendingPitches}
                  heatMapPitches={sessionHeatMapOpen ? state.gamePitchLog : undefined}
                  onTap={(x, y) => dispatch({ type: "TAP_ZONE", x, y })}
                  flashKey={flashKey}
                  disabled={!sessionHeatMapOpen && state.mode === "hitting" && atBatBattingHand === null}
                  popupContent={
                    !sessionHeatMapOpen && state.selectedZone
                      ? pitchTypeStepDone ? (
                          <PitchOutcomePopup
                            zone={classifyZone(state.selectedZone.x, state.selectedZone.y)}
                            battingHand={state.mode === "hitting" ? atBatBattingHand : null}
                            onPick={handlePitchOutcome}
                            onClose={() => dispatch({ type: "CLEAR_ZONE_SELECTION" })}
                          />
                        ) : (
                          <PitchTypePopup
                            onPick={(t) => {
                              dispatch({ type: "SELECT_PITCH_TYPE", pitchType: t });
                              setPitchTypeStepDone(true);
                            }}
                            onClose={() => dispatch({ type: "CLEAR_ZONE_SELECTION" })}
                          />
                        )
                      : undefined
                  }
                />

                {sessionHeatMapOpen ? (
                  <div className="flex w-full max-w-[280px] flex-wrap justify-center gap-3 text-[11px] text-foreground/50">
                    <LegendDot color="#24A058" label="Ball" />
                    <LegendDot color="#E24B4A" label="Strike" />
                    <LegendDot color="#EF9F27" label="Foul" />
                  </div>
                ) : (
                  state.pendingPitches.length > 0 && (
                    <p className="w-full max-w-[280px] text-xs leading-relaxed text-foreground/50">
                      {state.pendingPitches
                        .map(
                          (p, i) =>
                            `${i + 1}. ${p.pitch_type ? PITCH_TYPE_LABELS[p.pitch_type] : "Pitch"} — ${OUTCOME_LABELS[p.outcome]}`
                        )
                        .join(", ")}
                    </p>
                  )
                )}

                {!sessionHeatMapOpen && (
                  <div className="flex w-full max-w-[280px] justify-center gap-2">
                    <button
                      onClick={() => setIbbConfirmOpen(true)}
                      className="min-h-[36px] rounded-full border px-3 text-xs font-semibold transition hover:brightness-125"
                      style={{ borderColor: "#EF9F27", color: "#EF9F27" }}
                    >
                      IBB — Intentional Walk
                    </button>
                    <button
                      onClick={() => void handleDirectHbp()}
                      className="min-h-[36px] rounded-full border border-border px-3 text-xs font-semibold text-foreground/70 transition hover:border-accent-primary hover:text-white"
                    >
                      HBP
                    </button>
                  </div>
                )}
              </>
            )}

            {flowStep === "field" && (
              <>
                <p className="font-heading text-center text-lg font-bold text-white">Tap where the ball landed</p>
                <FieldDiagram tap={state.fieldTap} onTap={(x, y) => dispatch({ type: "SET_FIELD_TAP", x, y })} />
              </>
            )}

            {flowStep === "hitType" && (
              <div className="w-full max-w-[320px]">
                <p className="mb-2 text-center text-xs uppercase tracking-wide text-foreground/40">What kind of hit?</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {(Object.keys(HIT_TYPE_LABELS) as HitType[]).map((ht) => (
                    <button
                      key={ht}
                      onClick={() => handleHitTypeTap(ht)}
                      className="min-h-[48px] rounded-full border-2 border-accent-primary px-4 text-sm font-semibold text-white transition hover:bg-accent-primary/20"
                    >
                      {HIT_TYPE_LABELS[ht]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {flowStep === "result" && state.pendingHitType && (
              <div className="w-full max-w-[320px]">
                <p className="mb-2 text-center text-xs uppercase tracking-wide text-foreground/40">
                  {HIT_TYPE_LABELS[state.pendingHitType]} — result
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {HIT_TYPE_RESULT_OPTIONS[state.pendingHitType].map((r) => (
                    <button
                      key={r}
                      onClick={() => pickResult(r)}
                      className="min-h-[48px] rounded-md border border-border bg-background px-2 text-sm font-medium text-foreground/70 transition hover:border-accent-gold hover:text-white"
                    >
                      {RESULT_LABELS[r]}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => dispatch({ type: "SET_HIT_TYPE", hitType: null })}
                  className="mt-2 text-xs text-foreground/40 hover:text-white"
                >
                  ← change hit type
                </button>
              </div>
            )}

            {flowStep === "fielding" && (
              <FieldingPositionPicker
                title="Who made the play?"
                onSelect={(f) => dispatch({ type: "SET_FIELDING", position: f.position, playerId: f.playerId, opponentPlayerId: f.opponentPlayerId })}
                resolve={resolve}
              />
            )}

            {flowStep === "runnerConfirm" && state.suggestedResult && (
              <div className="glossy w-full max-w-[320px] rounded-lg border border-accent-gold/40 bg-surface p-4 text-center">
                <p className="font-heading text-lg font-bold text-white">{RESULT_LABELS[state.suggestedResult]}</p>
                {state.runnersPendingConfirmation ? (
                  <>
                    <p className="mt-1 text-xs text-accent-amber">Suggested runner movement — review on the diamond, right column</p>
                    <div className="mt-3 flex items-start justify-center gap-6">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-foreground/40">RBI</p>
                        <p className="font-heading mt-1 text-lg font-bold text-white">{state.pendingRbi}</p>
                        <p className="mt-0.5 text-[10px] text-foreground/40">Auto -- not editable</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-foreground/40">Runs scoring</p>
                        <p className="font-heading mt-1 text-sm text-white">
                          {state.scoredThisAtBat.length > 0
                            ? `${state.scoredThisAtBat.length} — ${state.scoredThisAtBat.map((s) => s.runner.name).join(", ")}`
                            : "None"}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => dispatch({ type: "CONFIRM_RUNNERS_SUGGESTION" })}
                      className="mt-4 w-full min-h-[48px] rounded-md bg-accent-green px-4 text-base font-semibold text-white"
                    >
                      Confirm &amp; Continue
                    </button>
                  </>
                ) : (
                  <p className="mt-2 text-xs text-foreground/40">Confirming…</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN -- persistent game state, not part of the sequential flow */}
        <div className="flex flex-col gap-4">
          <div className="glossy flex flex-col items-center gap-2 rounded-lg border border-border bg-surface p-4">
            {state.runnersPendingConfirmation && (
              <div className="w-full rounded-md border border-accent-amber/50 bg-accent-amber/10 p-2 text-center">
                <p className="text-xs text-accent-amber">Suggested runner movement — confirm in the flow panel, left column</p>
              </div>
            )}
            <BaserunnerDiamond
              runners={state.runners}
              pending={state.runnersPendingConfirmation}
              onBaseTap={(b) => (state.runners[b] ? setRunnerActionMenu(b) : setRunnerPicker(b))}
            />
            {runnerPicker && (
              <RunnerPicker
                base={runnerPicker}
                mode={state.mode}
                players={players}
                battingPlayerId={battingPlayerInfo?.id ?? null}
                runners={state.runners}
                onSelect={(r) => selectRunner(runnerPicker, r)}
                onClose={() => setRunnerPicker(null)}
              />
            )}
            {runnerActionMenu && state.runners[runnerActionMenu] && (
              <RunnerQuickActionMenu
                base={runnerActionMenu}
                runner={state.runners[runnerActionMenu]!}
                onAction={(a) => {
                  // Fix 2: generic "Out" asks why first; every other action
                  // (including the separate "Picked Off") is unchanged.
                  if (a === "out") {
                    setOutReasonPrompt({ base: runnerActionMenu, runner: state.runners[runnerActionMenu]! });
                    setRunnerActionMenu(null);
                    return;
                  }
                  applyRunnerAction(runnerActionMenu, a);
                }}
                onClose={() => setRunnerActionMenu(null)}
              />
            )}
            {outReasonPrompt && (
              <OutReasonMenu
                base={outReasonPrompt.base}
                runner={outReasonPrompt.runner}
                onSelect={(eventType) => handleRunnerOutWithReason(outReasonPrompt.base, eventType)}
                onClose={() => setOutReasonPrompt(null)}
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <QuickButton label="Wild Pitch" onClick={() => void handleQuickEvent("wild_pitch")} />
            <QuickButton label="Balk" onClick={() => void handleQuickEvent("balk")} />
            <QuickButton label="Passed Ball" onClick={() => void handleQuickEvent("passed_ball")} />
            <QuickButton label="Error (all runners)" onClick={() => void handleQuickEvent("error")} />
            <QuickButton
              label="Pickoff"
              onClick={() => setPickoffWizard({ step: "base" })}
              className="col-span-2"
            />
            <QuickButton
              label="Substitution"
              onClick={() => dispatch({ type: "SET_PANEL", panel: "substitution", open: true })}
              className="col-span-2"
            />
          </div>
        </div>
      </div>

      {scoreMethodPrompt && (
        <ScoreMethodMenu
          runner={scoreMethodPrompt.runner}
          onSelect={(m) => applyRunnerAction(scoreMethodPrompt.base, "scored", m)}
          onClose={() => setScoreMethodPrompt(null)}
        />
      )}

      {dpWizard && (
        <DoublePlayWizard
          wizard={dpWizard}
          runners={state.runners}
          resolve={resolve}
          onChangeBase={(base) => setDpWizard({ step: "type", base, outType: "force" })}
          onChangeType={(outType) => setDpWizard((w) => (w ? { ...w, outType } : w))}
          onProceedToFielding1={() => setDpWizard((w) => (w ? { ...w, step: "fielding1" } : w))}
          onFirstFielding={(f) => setDpWizard((w) => (w ? { ...w, step: "fielding2", firstFielding: f } : w))}
          onSecondFielding={(f) => {
            if (!dpWizard.base || !dpWizard.firstFielding) return;
            const runner = state.runners[dpWizard.base];
            if (!runner) return;
            void handleConfirmDoublePlay({
              base: dpWizard.base,
              runner,
              outType: dpWizard.outType,
              batterFielding: dpWizard.firstFielding,
              secondFielding: f,
            });
          }}
          onCancel={() => setDpWizard(null)}
        />
      )}

      {pickoffWizard && (
        <PickoffWizard
          wizard={pickoffWizard}
          runners={state.runners}
          onChangeBase={(base) => setPickoffWizard({ step: "result", base })}
          onResult={(outcome) => pickoffWizard.base && handlePickoffResult(pickoffWizard.base, outcome)}
          onCancel={() => setPickoffWizard(null)}
        />
      )}

      {pitcherPickerOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-xs rounded-lg border border-border bg-surface p-4">
            <p className="mb-2 text-xs uppercase tracking-wide text-foreground/40">Select pitcher</p>
            <div className="flex flex-col gap-1.5">
              {players.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    dispatch({ type: "SET_PITCHER", playerId: p.id });
                    void syncGameState(game.id, { current_pitcher_id: p.id, pitch_count_for_current_pitcher: 0 });
                    setPitcherPickerOpen(false);
                  }}
                  className="rounded-md border border-border px-3 py-2 text-left text-sm text-white hover:border-accent-primary"
                >
                  #{p.jersey_number ?? "—"} {p.name}
                </button>
              ))}
            </div>
            <button onClick={() => setPitcherPickerOpen(false)} className="mt-3 w-full text-xs text-foreground/50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {state.substitutionPanelOpen && (
        <SubstitutionPanel
          players={players}
          onClose={() => dispatch({ type: "SET_PANEL", panel: "substitution", open: false })}
          onConfirm={(playerOutId, playerInId, reason) => {
            void withOfflineRetry(`sub-${game.id}-${Date.now()}`, () =>
              saveSubstitution(game.id, { playerOutId, playerInId, reason, inning: state.inning, inningHalf: state.inningHalf })
            );
            dispatch({ type: "SET_PANEL", panel: "substitution", open: false });
          }}
        />
      )}

      {state.endGameConfirmOpen && (
        <ConfirmDialog
          title="End game?"
          message="This will move to the post-game summary. You can still review before final submit."
          confirmLabel="End Game"
          onConfirm={() => {
            dispatch({ type: "SET_PANEL", panel: "endGame", open: false });
            dispatch({ type: "SET_PANEL", panel: "postGame", open: true });
          }}
          onCancel={() => dispatch({ type: "SET_PANEL", panel: "endGame", open: false })}
        />
      )}

      {ibbConfirmOpen && (
        <ConfirmDialog
          title="Intentional Walk"
          message={`Intentional walk — ${currentBatterRunner().name} awarded 1st base?`}
          confirmLabel="Confirm"
          onConfirm={() => {
            setIbbConfirmOpen(false);
            void handleIntentionalWalk();
          }}
          onCancel={() => setIbbConfirmOpen(false)}
        />
      )}

      {leaveConfirmOpen && (
        <ConfirmDialog
          title="Leave this game?"
          message="Your progress is saved."
          confirmLabel="Leave"
          onConfirm={() => {
            setLeaveConfirmOpen(false);
            router.push("/coach");
          }}
          onCancel={() => setLeaveConfirmOpen(false)}
        />
      )}

      {state.mode === "pitching" && state.pitchCountForCurrentPitcher >= 100 && !state.pitchCountAck100 && (
        <PitchCountModal
          count={state.pitchCountForCurrentPitcher}
          onAcknowledge={() => {
            dispatch({ type: "ACK_PITCH_COUNT", level: 100 });
            void syncGameState(game.id, { pitch_count_ack_100: true });
          }}
        />
      )}

      {state.outs >= 3 && (
        <ThreeOutsModal
          hits={state.hitsThisInning}
          runs={state.runsThisInning}
          errors={state.errorsThisInning}
          onEndInning={confirmEndInning}
        />
      )}

      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-border bg-surface px-4 py-3">
        <button
          onClick={() => dispatch({ type: "SET_PANEL", panel: "endGame", open: true })}
          className="min-h-[48px] rounded-md border border-accent-red/50 px-4 text-sm font-medium text-accent-red"
        >
          End Game
        </button>

        {undoActive && (
          <button
            onClick={handleUndo}
            className="relative min-h-[48px] overflow-hidden rounded-md bg-accent-amber px-4 text-sm font-semibold text-background"
          >
            <span
              className="absolute inset-0 bg-black/20"
              style={{
                width: `${(1 - undoRemaining / UNDO_WINDOW_MS) * 100}%`,
                backgroundColor: undoRemaining < 10000 ? "rgba(224,85,79,0.5)" : undefined,
              }}
            />
            <span className="relative">Undo ({Math.ceil(undoRemaining / 1000)}s)</span>
          </button>
        )}
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function CountBlock({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="font-heading text-5xl font-bold text-white">{value}</p>
      <p className="mt-1 text-[11px] uppercase tracking-wide text-foreground/40">{label}</p>
    </div>
  );
}

// Fix 1: step 1 of the zone-tap popup -- asked before the outcome menu,
// per spec. "Unknown" logs pitch_type as null (already how an unset pitch
// type has always been recorded -- nothing new needed there) with no
// separate "penalty" flag to track, since none of the pitch-type-keyed
// stats (Strike Rate by pitch type, etc.) treat a null pitch_type as
// anything but "excluded from that breakdown," which is already correct.
// Fix 1/4: two tall thin ovals side by side ("L"/"R") above the strike
// zone grid, always tappable (not just at at-bat start, per Fix 4) --
// this is a live per-at-bat override, not a write to the player's
// profile, so there's no confirmation and no server round-trip either.
function BatterHandSelector({ value, onChange }: { value: BattingHand | null; onChange: (hand: BattingHand) => void }) {
  return (
    <div className="flex w-full max-w-[280px] flex-col items-center gap-1.5">
      <div className="flex items-center gap-4">
        <EllipseButton label="L" selected={value === "L"} onClick={() => onChange("L")} />
        <EllipseButton label="R" selected={value === "R"} onClick={() => onChange("R")} />
      </div>
      {value === null && <p className="text-[10px] text-accent-amber">Select batter&apos;s stance to activate the zone</p>}
    </div>
  );
}

function EllipseButton({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className={`flex h-16 w-9 items-center justify-center rounded-[50%] border-2 text-sm font-bold transition ${
        selected ? "glow-green border-accent-green bg-accent-green/25 text-white" : "border-border bg-surface text-foreground/40"
      }`}
    >
      {label}
    </button>
  );
}

const PITCH_TYPE_POPUP_OPTIONS: { value: PitchType | null; label: string }[] = [
  ...PITCH_TYPES.map((t) => ({ value: t, label: PITCH_TYPE_LABELS[t] })),
  { value: null, label: "Unknown" },
];

function PitchTypePopup({ onPick, onClose }: { onPick: (t: PitchType | null) => void; onClose: () => void }) {
  return (
    <div className="glossy w-48 rounded-lg border border-accent-primary/50 bg-card p-2 shadow-lg">
      <p className="mb-1.5 text-center text-[10px] uppercase tracking-wide text-foreground/50">What pitch was it?</p>
      <div className="grid grid-cols-2 gap-1.5">
        {PITCH_TYPE_POPUP_OPTIONS.map((o) => (
          <button
            key={o.label}
            onClick={() => onPick(o.value)}
            className={`min-h-[40px] rounded-md border border-border px-1.5 text-[11px] font-medium text-white transition hover:border-accent-primary hover:bg-accent-primary/10 ${
              o.value === null ? "col-span-2" : ""
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <button onClick={onClose} className="mt-1.5 w-full text-[10px] text-foreground/40 hover:text-white">
        Cancel
      </button>
    </div>
  );
}

// HBP is only physically plausible on the inside part of the zone (the
// ball-zone column closest to the batter's body) at roughly chest/waist
// height -- not the corner cells (too high or too low) and not the
// lower-middle ring cell either (per spec, "not the bottom two rows").
// col/row 0 and 4 are the ball-zone ring; col 0 = left (inside to a RHB),
// col 4 = right (inside to a LHB); row 1/2 = upper-middle/middle height
// (row 0 = top corner, row 3/4 = lower-middle + bottom corner, both
// excluded). Unknown/null/switch-hitter batting_hand falls back to both
// inside columns, per spec -- a switch hitter's *effective* side for this
// at-bat isn't knowable from a static 'S' value, so this treats it the
// same as truly unknown rather than guessing one side.
function hbpEligible(zone: { col: number; row: number }, hand: BattingHand | null): boolean {
  if (zone.row !== 1 && zone.row !== 2) return false;
  if (hand === "R") return zone.col === 0;
  if (hand === "L") return zone.col === 4;
  return zone.col === 0 || zone.col === 4;
}

// Step 1 of the sequential flow: appears anchored to the tapped zone
// (StrikeZoneGrid owns the positioning). Which buttons show depends on
// where the tap landed -- inside the strike zone, a pitch can't be a Ball
// or HBP (it's over the plate); outside it (the ball zone), it can't be a
// called Strike (a pitch outside the zone the batter didn't swing at is a
// Ball, not a strike) and HBP only shows in the physically-plausible cells
// hbpEligible identifies. Strike itself is split into looking/swinging --
// the only pitches.outcome value where swing-vs-take is genuinely
// ambiguous (ball/hbp always no-swing, foul/inplay always a swing) -- see
// the pitches.swing migration.
function PitchOutcomePopup({
  zone,
  battingHand,
  onPick,
  onClose,
}: {
  zone: { col: number; row: number; isBallZone: boolean };
  battingHand: BattingHand | null;
  onPick: (outcome: PitchOutcome, swing: boolean) => void;
  onClose: () => void;
}) {
  const showHbp = hbpEligible(zone, battingHand);

  return (
    <div className="glossy w-48 rounded-lg border border-accent-primary/50 bg-card p-2 shadow-lg">
      <div className="grid grid-cols-2 gap-1.5">
        {!zone.isBallZone && (
          <PopupButton label="Strike (Looking)" color={OUTCOME_COLOR.strike} onClick={() => onPick("strike", false)} />
        )}
        <PopupButton label="Strike (Swinging)" color={OUTCOME_COLOR.strike} onClick={() => onPick("strike", true)} />
        <PopupButton label="Foul" color={OUTCOME_COLOR.foul} onClick={() => onPick("foul", true)} />
        {zone.isBallZone && <PopupButton label="Ball" color={OUTCOME_COLOR.ball} onClick={() => onPick("ball", false)} />}
        {showHbp && <PopupButton label="HBP" color="#B060F0" onClick={() => onPick("hbp", false)} />}
        <PopupButton label="In Play" color={OUTCOME_COLOR.inplay} onClick={() => onPick("inplay", true)} />
      </div>
      <button onClick={onClose} className="mt-1.5 w-full text-[10px] text-foreground/40 hover:text-white">
        Cancel
      </button>
    </div>
  );
}

function PopupButton({
  label,
  color,
  onClick,
  className = "",
}: {
  label: string;
  color: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{ borderColor: color }}
      className={`min-h-[44px] rounded-md border-2 px-1.5 text-[11px] font-semibold leading-tight text-white transition hover:brightness-125 ${className}`}
    >
      {label}
    </button>
  );
}

function QuickButton({ label, onClick, className = "" }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button
      onClick={onClick}
      className={`min-h-[48px] rounded-md border border-border bg-surface px-3 text-sm font-medium text-foreground/80 hover:border-accent-primary hover:text-white ${className}`}
    >
      {label}
    </button>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-5 text-center">
        <h3 className="font-heading text-lg font-bold text-white">{title}</h3>
        <p className="mt-2 text-sm text-foreground/70">{message}</p>
        <div className="mt-4 flex gap-3">
          <button onClick={onConfirm} className="flex-1 rounded-md bg-accent-primary px-4 py-2.5 text-sm font-semibold text-white">
            {confirmLabel}
          </button>
          <button onClick={onCancel} className="rounded-md border border-border px-4 py-2.5 text-sm text-foreground/70">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function RunnerPicker({
  base,
  mode,
  players,
  battingPlayerId,
  runners,
  onSelect,
  onClose,
}: {
  base: Base;
  mode: "hitting" | "pitching";
  players: Player[];
  battingPlayerId: string | null;
  runners: Runners;
  onSelect: (runner: RunnerState | null) => void;
  onClose: () => void;
}) {
  const occupiedIds = new Set(
    Object.values(runners)
      .filter((r): r is RunnerState => !!r && r.type === "player")
      .map((r) => r.id)
  );

  if (mode === "pitching") {
    return (
      <div className="w-full max-w-xs rounded-md border border-border bg-background p-3">
        <p className="mb-1 text-xs text-foreground/50">Runner on {base}</p>
        <OpponentRunnerInput onSelect={onSelect} onClose={onClose} />
      </div>
    );
  }

  return (
    <div className="w-full max-w-xs rounded-md border border-border bg-background p-3">
      <p className="mb-1 text-xs text-foreground/50">Runner on {base}</p>
      <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
        {players
          .filter((p) => p.id !== battingPlayerId && !occupiedIds.has(p.id))
          .map((p) => (
            <button
              key={p.id}
              onClick={() =>
                onSelect({
                  type: "player",
                  id: p.id,
                  name: p.name,
                  jersey: p.jersey_number ? String(p.jersey_number) : null,
                })
              }
              className="rounded border border-border px-2 py-1 text-left text-sm text-white hover:border-accent-primary"
            >
              #{p.jersey_number ?? "—"} {p.name}
            </button>
          ))}
      </div>
      <div className="mt-2 flex gap-2">
        <button onClick={() => onSelect(null)} className="flex-1 rounded border border-border py-1 text-xs text-foreground/60">
          Clear
        </button>
        <button onClick={onClose} className="flex-1 rounded border border-border py-1 text-xs text-foreground/60">
          Close
        </button>
      </div>
    </div>
  );
}

function OpponentRunnerInput({
  onSelect,
  onClose,
}: {
  onSelect: (runner: RunnerState | null) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  return (
    <div className="flex flex-col gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Runner name"
        className="rounded border border-border bg-surface px-2 py-1 text-sm text-white"
      />
      <div className="flex gap-2">
        <button
          onClick={() => name.trim() && onSelect({ type: "opponent", id: null, name: name.trim() })}
          className="flex-1 rounded border border-accent-primary py-1 text-xs text-white"
        >
          Set
        </button>
        <button onClick={() => onSelect(null)} className="flex-1 rounded border border-border py-1 text-xs text-foreground/60">
          Clear
        </button>
        <button onClick={onClose} className="flex-1 rounded border border-border py-1 text-xs text-foreground/60">
          Close
        </button>
      </div>
    </div>
  );
}

const RUNNER_QUICK_ACTIONS: { action: RunnerQuickAction; label: string }[] = [
  { action: "advance", label: "Advance" },
  { action: "scored", label: "Scored" },
  { action: "out", label: "Out" },
  { action: "stolen_base", label: "Stolen Base" },
  { action: "picked_off", label: "Picked Off" },
  { action: "error_advance", label: "Error Advance" },
];

function RunnerQuickActionMenu({
  base,
  runner,
  onAction,
  onClose,
}: {
  base: Base;
  runner: RunnerState;
  onAction: (action: RunnerQuickAction) => void;
  onClose: () => void;
}) {
  return (
    <div className="w-full max-w-xs rounded-md border border-border bg-background p-3">
      <p className="mb-2 text-xs text-foreground/50">
        {runner.jersey ? `#${runner.jersey} ` : ""}
        {runner.name} on {base}
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        {RUNNER_QUICK_ACTIONS.map((o) => (
          <button
            key={o.action}
            onClick={() => onAction(o.action)}
            className="min-h-[44px] rounded border border-border px-2 text-xs font-medium text-white hover:border-accent-primary"
          >
            {o.label}
          </button>
        ))}
      </div>
      <button onClick={onClose} className="mt-2 w-full text-xs text-foreground/50">
        Close
      </button>
    </div>
  );
}

// Fix 2: required after a generic "Out" -- "Pickoff" here maps onto the
// exact same pickoff_out event type the standalone Pickoff wizard (a few
// fixes back) logs, and "Out on Appeal" maps onto the same
// tag_up_violation type the post-flyout appeal panel logs -- both are
// just a second path to an event type that already existed for a
// narrower trigger, not a new concept.
const OUT_REASONS: { eventType: GameEventType; label: string }[] = [
  { eventType: "caught_stealing", label: "Caught Stealing" },
  { eventType: "pickoff_out", label: "Pickoff" },
  { eventType: "tag_up_violation", label: "Out on Appeal" },
  { eventType: "rundown_out", label: "Rundown" },
  { eventType: "runner_passed", label: "Passed" },
  { eventType: "out_at_next_base", label: "Out at Next Base" },
];

function OutReasonMenu({
  base,
  runner,
  onSelect,
  onClose,
}: {
  base: Base;
  runner: RunnerState;
  onSelect: (eventType: GameEventType) => void;
  onClose: () => void;
}) {
  return (
    <div className="w-full max-w-xs rounded-md border border-accent-red/40 bg-background p-3">
      <p className="mb-2 text-xs text-foreground/50">
        {runner.jersey ? `#${runner.jersey} ` : ""}
        {runner.name} on {base} — out. Why?
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        {OUT_REASONS.map((r) => (
          <button
            key={r.eventType}
            onClick={() => onSelect(r.eventType)}
            className="min-h-[44px] rounded border border-border px-2 text-xs font-medium text-white hover:border-accent-primary"
          >
            {r.label}
          </button>
        ))}
      </div>
      <button onClick={onClose} className="mt-2 w-full text-xs text-foreground/50">
        Cancel
      </button>
    </div>
  );
}

function ScoreMethodMenu({
  runner,
  onSelect,
  onClose,
}: {
  runner: RunnerState;
  onSelect: (method: ScoreMethod) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-xs rounded-lg border border-border bg-surface p-4">
        <p className="text-sm font-semibold text-white">{runner.name} scored</p>
        <p className="mb-3 text-xs text-foreground/50">How did they score?</p>
        <div className="flex flex-col gap-1.5">
          {SCORE_METHODS.map((m) => (
            <button
              key={m}
              onClick={() => onSelect(m)}
              className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-left text-sm text-white hover:border-accent-primary"
            >
              {SCORE_METHOD_LABELS[m]}
              <span className={`text-[10px] uppercase ${SCORE_METHOD_AWARDS_RBI[m] ? "text-accent-green" : "text-foreground/40"}`}>
                {SCORE_METHOD_AWARDS_RBI[m] ? "RBI" : "no RBI"}
              </span>
            </button>
          ))}
        </div>
        <button onClick={onClose} className="mt-3 w-full text-xs text-foreground/50">
          Cancel
        </button>
      </div>
    </div>
  );
}

function BoxScoreDashboard({ state }: { state: { hitsThisInning: number; runsThisInning: number; errorsThisInning: number; kThisInning: number; hitsGame: number; runsGame: number; errorsGame: number; kGame: number; lobGame: number } }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-border bg-surface/60 px-4 py-1.5 text-xs sm:grid-cols-2">
      <div className="flex items-center gap-3">
        <span className="w-20 shrink-0 uppercase tracking-wide text-foreground/40">This inning</span>
        <BoxStat label="H" value={state.hitsThisInning} />
        <BoxStat label="R" value={state.runsThisInning} />
        <BoxStat label="E" value={state.errorsThisInning} />
        <BoxStat label="K" value={state.kThisInning} />
      </div>
      <div className="flex items-center gap-3">
        <span className="w-20 shrink-0 uppercase tracking-wide text-foreground/40">Game</span>
        <BoxStat label="H" value={state.hitsGame} />
        <BoxStat label="R" value={state.runsGame} />
        <BoxStat label="E" value={state.errorsGame} />
        <BoxStat label="K" value={state.kGame} />
        <BoxStat label="LOB" value={state.lobGame} />
      </div>
    </div>
  );
}

function BoxStat({ label, value }: { label: string; value: number }) {
  return (
    <span className="text-white">
      <span className="text-foreground/40">{label}</span> {value}
    </span>
  );
}

function FieldingPositionPicker({
  title,
  onSelect,
  resolve,
}: {
  title: string;
  onSelect: (fielder: ResolvedFielder) => void;
  resolve: (position: FieldingPosition) => ResolvedFielder;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <p className="mb-2 text-xs uppercase tracking-wide text-foreground/40">{title}</p>
      <div className="flex flex-col items-center gap-1.5">
        {FIELDING_LAYOUT.map((row, i) => (
          <div key={i} className="flex gap-1.5">
            {row.map((pos) => (
              <button
                key={pos}
                onClick={() => onSelect(resolve(pos))}
                className="min-h-[44px] min-w-[44px] rounded border border-border px-2 text-xs font-semibold text-white hover:border-accent-primary"
              >
                {pos}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function ThreeOutsModal({
  hits,
  runs,
  errors,
  onEndInning,
}: {
  hits: number;
  runs: number;
  errors: number;
  onEndInning: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#030A06]/95 p-4">
      <div className="glossy glow-green w-full max-w-sm rounded-lg border border-accent-green/60 bg-card p-6 text-center">
        <p className="font-heading text-3xl font-bold text-accent-green" style={{ textShadow: "0 0 16px rgba(0,255,127,0.6)" }}>
          3 OUTS
        </p>
        <p className="mt-1 text-sm text-foreground/60">Inning over</p>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div>
            <p className="font-heading text-2xl text-white">{hits}</p>
            <p className="text-[10px] uppercase text-foreground/40">Hits</p>
          </div>
          <div>
            <p className="font-heading text-2xl text-white">{runs}</p>
            <p className="text-[10px] uppercase text-foreground/40">Runs</p>
          </div>
          <div>
            <p className="font-heading text-2xl text-white">{errors}</p>
            <p className="text-[10px] uppercase text-foreground/40">Errors</p>
          </div>
        </div>
        <button
          onClick={onEndInning}
          className="mt-6 w-full min-h-[48px] rounded-md bg-accent-green px-4 text-base font-semibold text-background"
        >
          End Inning
        </button>
      </div>
    </div>
  );
}

function PickoffWizard({
  wizard,
  runners,
  onChangeBase,
  onResult,
  onCancel,
}: {
  wizard: { step: "base" | "result"; base?: Base };
  runners: Runners;
  onChangeBase: (base: Base) => void;
  onResult: (outcome: "out" | "safe") => void;
  onCancel: () => void;
}) {
  const occupied = (["first", "second", "third"] as Base[]).filter((b) => runners[b]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-5">
        <h3 className="font-heading text-lg font-bold text-white">Pickoff</h3>

        {wizard.step === "base" && (
          <>
            <p className="mt-2 text-sm text-foreground/60">Throw to which base?</p>
            <div className="mt-3 flex flex-col gap-2">
              {occupied.map((b) => (
                <button
                  key={b}
                  onClick={() => onChangeBase(b)}
                  className="rounded-md border border-border px-3 py-2 text-left text-sm text-white hover:border-accent-primary"
                >
                  {runners[b]?.name} ({b})
                </button>
              ))}
              {occupied.length === 0 && <p className="text-sm text-foreground/40">No runners on base.</p>}
            </div>
          </>
        )}

        {wizard.step === "result" && wizard.base && (
          <>
            <p className="mt-2 text-sm text-foreground/60">
              {runners[wizard.base]?.name} at {wizard.base} —
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <button
                onClick={() => onResult("out")}
                className="min-h-[48px] rounded-md border border-accent-red/50 px-3 py-2 text-sm font-semibold text-white hover:bg-accent-red/10"
              >
                Out — runner caught
              </button>
              <button
                onClick={() => onResult("safe")}
                className="min-h-[48px] rounded-md border border-accent-green/50 px-3 py-2 text-sm font-semibold text-white hover:bg-accent-green/10"
              >
                Safe — runner dives back
              </button>
            </div>
          </>
        )}

        <button onClick={onCancel} className="mt-4 w-full text-xs text-foreground/50">
          Cancel
        </button>
      </div>
    </div>
  );
}

function DoublePlayWizard({
  wizard,
  runners,
  resolve,
  onChangeBase,
  onChangeType,
  onProceedToFielding1,
  onFirstFielding,
  onSecondFielding,
  onCancel,
}: {
  wizard: DpWizardState;
  runners: Runners;
  resolve: (position: FieldingPosition) => ResolvedFielder;
  onChangeBase: (base: Base) => void;
  onChangeType: (t: OutType) => void;
  onProceedToFielding1: () => void;
  onFirstFielding: (f: ResolvedFielder) => void;
  onSecondFielding: (f: ResolvedFielder) => void;
  onCancel: () => void;
}) {
  const occupied = (["first", "second", "third"] as Base[]).filter((b) => runners[b]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-5">
        <h3 className="font-heading text-lg font-bold text-white">Double Play</h3>

        {wizard.step === "runner" && (
          <>
            <p className="mt-2 text-sm text-foreground/60">Which runner was out?</p>
            <div className="mt-3 flex flex-col gap-2">
              {occupied.map((b) => (
                <button
                  key={b}
                  onClick={() => onChangeBase(b)}
                  className="rounded-md border border-border px-3 py-2 text-left text-sm text-white hover:border-accent-primary"
                >
                  {runners[b]?.name} ({b})
                </button>
              ))}
              {occupied.length === 0 && <p className="text-sm text-foreground/40">No runners on base.</p>}
            </div>
          </>
        )}

        {wizard.step === "type" && (
          <>
            <p className="mt-2 text-sm text-foreground/60">Force out or tag out (the runner)?</p>
            <div className="mt-3 flex gap-2">
              {(["force", "tag"] as OutType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => onChangeType(t)}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm capitalize ${
                    wizard.outType === t ? "border-accent-primary bg-accent-primary text-white" : "border-border text-foreground/70"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <button
              onClick={onProceedToFielding1}
              className="mt-4 w-full min-h-[48px] rounded-md bg-accent-primary px-4 text-sm font-semibold text-white"
            >
              Next
            </button>
          </>
        )}

        {wizard.step === "fielding1" && (
          <div className="mt-2">
            <FieldingPositionPicker title="First out (batter, force at 1B) — who fielded it?" onSelect={onFirstFielding} resolve={resolve} />
          </div>
        )}

        {wizard.step === "fielding2" && (
          <div className="mt-2">
            <FieldingPositionPicker title="Second out — who fielded it?" onSelect={onSecondFielding} resolve={resolve} />
          </div>
        )}

        <button onClick={onCancel} className="mt-4 w-full text-xs text-foreground/50">
          Cancel
        </button>
      </div>
    </div>
  );
}
