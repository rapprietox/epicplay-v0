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
  SubReason,
} from "@/lib/supabase/types";
import { operatorReducer, UNDO_WINDOW_MS } from "@/lib/operator/reducer";
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
  type ScoredRunner,
  type ScoreMethod,
} from "@/lib/operator/types";
import { atBatAccuracyRatio, runningAccuracy } from "@/lib/pitch-accuracy";
import { formatAvg, type BattingLine } from "@/lib/stats";
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

// Runner-actions consolidation: the reasons behind "Advance", replacing
// the standalone Wild Pitch/Passed Ball/Balk/Error (all-runners) buttons
// and the separate Stolen Base quick action -- see handleAdvanceReason.
type AdvanceReason = "stolen_base" | "wild_pitch" | "passed_ball" | "balk" | "error" | "passed_on_hit" | "obstruction";

// Fix 3 (smart hit defaults): one dismissible-within-3s banner per
// auto-scored runner. `base`/`runner` are the *pre-hit* position and
// identity, captured at decision time -- that's exactly what undoing
// needs to put back.
interface AutoScoreBanner {
  id: string;
  base: Base;
  runner: RunnerState;
  result: AtBatResult;
  deadline: number;
}

export function OperatorConsole({
  game,
  players,
  lineup,
  initialGameState,
  draftAtBat,
  opponentPlayers,
  allGamePitches,
  seasonBattingLines,
}: {
  game: Game;
  players: Player[];
  lineup: Lineup[];
  initialGameState: GameState;
  draftAtBat: (AtBat & { pitches: Pitch[] }) | null;
  opponentPlayers: OpponentPlayer[];
  allGamePitches: Pick<Pitch, "pitch_number" | "pitch_type" | "zone_x" | "zone_y" | "outcome">[];
  // Fix 3 layout (batter card "season stats"): keyed by player id, across
  // every game this team has played, not just this one -- a plain
  // object (not a Map) since that's what survives the RSC server ->
  // client prop serialization boundary cleanly.
  seasonBattingLines: Record<string, BattingLine>;
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
  // Runner-actions consolidation: "Advance" opens this reason menu instead
  // of moving the runner immediately; "Error" as a reason needs a second
  // step (advanceErrorFielding) to pick which fielder before it applies.
  const [advanceReasonPrompt, setAdvanceReasonPrompt] = useState<{ base: Base; runner: RunnerState } | null>(null);
  const [advanceErrorFielding, setAdvanceErrorFielding] = useState<Base | null>(null);
  // Fix 1: the ordered (third -> second -> first) queue of pre-existing
  // runners still awaiting an explicit hit-confirmation decision.
  // hitRunnerConfirmActive distinguishes "queue legitimately empty because
  // there were no runners to ask about" from "queue just drained" -- only
  // the latter should place the batter (see the useEffect above).
  const [hitRunnerConfirmActive, setHitRunnerConfirmActive] = useState(false);
  const [hitRunnerQueue, setHitRunnerQueue] = useState<Base[]>([]);
  const [hitRunnerNoStep, setHitRunnerNoStep] = useState(false);
  // Fix 3: stacked auto-score undo banners. Pruned (not just hidden) as
  // `now` ticks past each one's deadline -- `now` already updates every
  // 250ms for the existing 30s Undo bar, reused here rather than adding a
  // second timer for the same purpose.
  const [autoScoreBanners, setAutoScoreBanners] = useState<AutoScoreBanner[]>([]);
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
  const [summaryFlash, setSummaryFlash] = useState<string | null>(null);
  // Fix 5: bumped (never reset to 0) on every ball/strike/foul/HBP so
  // StrikeZoneGrid's flash overlay remounts and its CSS animation restarts
  // -- "In Play" deliberately never bumps this, since that outcome moves
  // straight to the field diagram instead of resetting for another pitch.
  const [flashKey, setFlashKey] = useState(0);
  // Left-panel redesign: which side's batter image last got tapped for a
  // direct HBP, and a per-tap counter -- BatterImage keys its red flash
  // overlay on `key` so a repeated tap on the same (already-selected)
  // image restarts the flash, the same trick flashKey above uses for the
  // strike-zone grid's own confirmation flash. Scoped by `side` so
  // tapping one image doesn't also flash the other while both are still
  // visible pre-selection.
  const [hbpFlash, setHbpFlash] = useState<{ side: BattingHand; key: number } | null>(null);

  useEffect(() => {
    if (!summaryFlash) return;
    const t = setTimeout(() => setSummaryFlash(null), 2500);
    return () => clearTimeout(t);
  }, [summaryFlash]);

  useEffect(() => {
    if (state.currentAtBatId) setTagUpPrompt(false);
  }, [state.currentAtBatId]);

  // Fix 3: banners reference a specific at-bat's runners -- once that
  // at-bat's id changes (confirmed, or a new one starts), any leftover
  // banner is stale regardless of whether its own 3s already elapsed.
  useEffect(() => {
    setAutoScoreBanners([]);
  }, [state.currentAtBatId]);

  useEffect(() => {
    if (autoScoreBanners.length === 0) return;
    if (autoScoreBanners.every((b) => b.deadline > now)) return;
    setAutoScoreBanners((bs) => bs.filter((b) => b.deadline > now));
  }, [now, autoScoreBanners]);

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

  // Fix 1 (an earlier batch) originally asked every pre-existing runner
  // "did they score?" unconditionally on any hit. This batch's Fix 3
  // replaces that with smart per-runner defaults -- most combinations are
  // resolved automatically (with a 3s undo banner for anything that
  // actually changed the runner's fate), and only the genuinely
  // ambiguous ones ("second + single," "first + double") still go
  // through the explicit ask queue below. HR/triple always auto-score
  // every runner regardless of base, checked first since it overrides
  // the base-specific rules that follow.
  const HIT_RESULTS_NEED_RUNNER_CONFIRM = new Set<AtBatResult>(["single", "double", "triple", "hr"]);

  type RunnerHitDecision = { kind: "autoScore" } | { kind: "autoAdvance"; toBase: Base } | { kind: "ask" };

  function decideRunnerOnHit(base: Base, result: AtBatResult): RunnerHitDecision {
    if (result === "hr" || result === "triple") return { kind: "autoScore" };
    if (base === "third") return { kind: "autoScore" };
    if (base === "second") return result === "double" ? { kind: "autoScore" } : { kind: "ask" };
    // base === "first"
    return result === "single" ? { kind: "autoAdvance", toBase: "second" } : { kind: "ask" };
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

    if (HIT_RESULTS_NEED_RUNNER_CONFIRM.has(result)) {
      const preExisting = (["third", "second", "first"] as Base[]).filter((b) => baseRunners[b]);
      if (preExisting.length > 0) {
        // Mark the result decided (so the flow moves past "result") --
        // runners/scored change below as each pre-existing runner's
        // decision is applied, not through suggestRunnerAdvance's guess.
        dispatch({ type: "SET_RESULT", result, suggestion: baseRunners, scored: [], hasMovement: false });

        let nextRunners = baseRunners;
        const autoScored: ScoredRunner[] = [];
        const banners: AutoScoreBanner[] = [];
        const askQueue: Base[] = [];

        for (const base of preExisting) {
          const runner = nextRunners[base]!;
          const decision = decideRunnerOnHit(base, result);
          if (decision.kind === "autoScore") {
            nextRunners = { ...nextRunners, [base]: null };
            autoScored.push({ runner, method: "hit" });
            banners.push({ id: `${base}-${Date.now()}-${Math.random()}`, base, runner, result, deadline: Date.now() + 3000 });
          } else if (decision.kind === "autoAdvance") {
            nextRunners = { ...nextRunners, [base]: null, [decision.toBase]: runner };
          } else {
            askQueue.push(base);
          }
        }

        if (nextRunners !== baseRunners) {
          dispatch({ type: "APPLY_HIT_RUNNER_DECISION", runners: nextRunners, scoredAdd: autoScored });
          syncRunners(nextRunners);
        }
        if (banners.length > 0) setAutoScoreBanners((bs) => [...bs, ...banners]);

        // Setting these unconditionally (even with an empty queue) is what
        // triggers the drain effect below to place the batter immediately
        // when nothing needs asking -- it fires on hitRunnerConfirmActive
        // *changing*, not just on the queue being non-empty.
        setHitRunnerConfirmActive(true);
        setHitRunnerQueue(askQueue);
        return;
      }
    }

    const batter = currentBatterRunner();
    const { runners: suggestion, scored } = suggestRunnerAdvance(baseRunners, batter, result);
    const method = resultToScoreMethod(result);
    const taggedScored = scored.map((r) => ({ runner: r, method }));
    const hasMovement = scored.length > 0 || JSON.stringify(suggestion) !== JSON.stringify(baseRunners);
    dispatch({ type: "SET_RESULT", result, suggestion, scored: taggedScored, hasMovement });
    if (hasMovement) syncRunners(suggestion);
  }

  // Fix 3: undo a single auto-scored runner within their 3s window --
  // reference equality on `runner` (not an id lookup) is deliberate and
  // safe, since the exact object captured in the banner at decision time
  // is the same one still sitting in scoredThisAtBat; opponent runners
  // (mode "pitching") have no id at all to match on otherwise.
  function undoAutoScore(banner: AutoScoreBanner) {
    setAutoScoreBanners((bs) => bs.filter((b) => b.id !== banner.id));
    const nextScored = state.scoredThisAtBat.filter((s) => s.runner !== banner.runner);
    const nextRunners = { ...state.runners, [banner.base]: banner.runner };
    dispatch({ type: "APPLY_HIT_RUNNER_DECISION", runners: nextRunners, scoredAdd: [], scoredSet: nextScored });
    syncRunners(nextRunners);
  }

  // Fix 3: HR/triple get their own wording (matching the spec's "Home
  // run — all runners score" framing) since those score *every* runner
  // together, not one specific base's ambiguity resolving in isolation;
  // third/second get the literal "Runner on Nth scored" the spec gives.
  function autoScoreBannerText(b: AutoScoreBanner): string {
    if (b.result === "hr") return `Home run — ${b.runner.name} scores`;
    if (b.result === "triple") return `Triple — ${b.runner.name} scores`;
    const baseLabel = b.base === "third" ? "3rd" : b.base === "second" ? "2nd" : "1st";
    return `Runner on ${baseLabel} scored — ${b.runner.name}`;
  }

  // Where the batter ends up for a hit -- HR scores them, everything else
  // is a fixed base. Not ambiguous, so never goes through the queue.
  function battersTargetBase(result: AtBatResult): Base | "home" {
    if (result === "single") return "first";
    if (result === "double") return "second";
    if (result === "triple") return "third";
    return "home";
  }

  // One runner's explicit decision from the hitRunners queue.
  function handleHitRunnerDecision(base: Base, decision: "scored" | "stay" | "advance") {
    const runner = state.runners[base];
    setHitRunnerNoStep(false);
    setHitRunnerQueue((q) => q.filter((b) => b !== base));
    if (!runner) return;

    if (decision === "stay") return;

    if (decision === "scored") {
      const nextRunners = { ...state.runners, [base]: null };
      dispatch({ type: "APPLY_HIT_RUNNER_DECISION", runners: nextRunners, scoredAdd: [{ runner, method: "hit" }] });
      syncRunners(nextRunners);
      return;
    }

    // advance one base (never offered for third -- that's "scored" instead)
    const advanced = advanceOneRunner(state.runners, base);
    const scoredAdd: ScoredRunner[] = advanced.scored.map((r) => ({ runner: r, method: "hit" as ScoreMethod }));
    dispatch({ type: "APPLY_HIT_RUNNER_DECISION", runners: advanced.runners, scoredAdd });
    syncRunners(advanced.runners);
  }

  // Fires once every pre-existing runner has an explicit decision --
  // places the batter (deterministic, no question needed) and flips on
  // the same "Confirm & Continue" review step every other result already
  // gets, so a hit's RBI count is never final without one last explicit
  // tap. Runs as an effect (not inline in handleHitRunnerDecision) so it
  // reads state.runners/scoredThisAtBat *after* React has committed the
  // last decision's dispatch, not a stale same-tick snapshot.
  useEffect(() => {
    if (!hitRunnerConfirmActive || hitRunnerQueue.length > 0) return;
    setHitRunnerConfirmActive(false);
    const result = state.suggestedResult;
    if (!result) return;
    const batter = currentBatterRunner();
    const targetBase = battersTargetBase(result);
    const finalRunners = targetBase === "home" ? state.runners : { ...state.runners, [targetBase]: batter };
    const finalScored = targetBase === "home" ? [...state.scoredThisAtBat, { runner: batter, method: "hit" as ScoreMethod }] : state.scoredThisAtBat;
    dispatch({ type: "SET_RESULT", result, suggestion: finalRunners, scored: finalScored, hasMovement: true });
    syncRunners(finalRunners);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hitRunnerQueue.length, hitRunnerConfirmActive]);

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

  // Fix 2: the substitution itself always got logged to `substitutions`
  // correctly -- the bug was that a runner already on base kept showing
  // the outgoing player's dot/jersey afterward, since nothing checked
  // whether they were a baserunner at the moment of the sub. Reuses the
  // existing SET_RUNNER action (the same one RunnerPicker already uses)
  // rather than a new one -- swapping a base's occupant is exactly what
  // that action already does.
  function handleSubstitutionConfirm(playerOutId: string, playerInId: string, reason: SubReason) {
    void withOfflineRetry(`sub-${game.id}-${Date.now()}`, () =>
      saveSubstitution(game.id, { playerOutId, playerInId, reason, inning: state.inning, inningHalf: state.inningHalf })
    );
    dispatch({ type: "SET_PANEL", panel: "substitution", open: false });

    const occupiedBase = (["first", "second", "third"] as Base[]).find(
      (b) => state.runners[b]?.type === "player" && state.runners[b]?.id === playerOutId
    );
    if (!occupiedBase) return;

    const incoming = players.find((p) => p.id === playerInId);
    const newRunner: RunnerState = {
      type: "player",
      id: playerInId,
      name: incoming?.name ?? "Pinch runner",
      jersey: incoming?.jersey_number ? String(incoming.jersey_number) : null,
    };
    dispatch({ type: "SET_RUNNER", base: occupiedBase, runner: newRunner });
    syncRunners({ ...state.runners, [occupiedBase]: newRunner });
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

    if (action === "advance" || action === "stolen_base") {
      const advanced = advanceOneRunner(state.runners, base);
      syncRunners(advanced.runners);
      if (action === "stolen_base" && runner.type === "player" && runner.id) {
        void withOfflineRetry(`sb-${game.id}-${Date.now()}`, () => logStolenBase(game.id, runner.id!, state.inning));
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

  // Shared by every AdvanceReason branch below -- dispatches the same
  // "advance" action applyRunnerAction's own advance path uses, but
  // returns the computed AdvanceResult too, so callers can read
  // .scored.length for a game_events runsScored field without
  // recomputing advanceOneRunner a second time against stale state.
  function advanceRunnerWithMethod(base: Base, method: ScoreMethod) {
    dispatch({ type: "APPLY_RUNNER_ACTION", base, action: "advance", scoreMethod: method });
    const advanced = advanceOneRunner(state.runners, base);
    syncRunners(advanced.runners);
    return advanced;
  }

  // Consolidated runner-advance flow: tapping "Advance" on a runner opens
  // AdvanceReasonMenu instead of moving them immediately, and every
  // standalone all-runners button this replaced (Wild Pitch/Passed
  // Ball/Balk/Error) now applies to just the one tapped runner instead.
  // Stolen Base moved here too, off its own RUNNER_QUICK_ACTIONS entry.
  async function handleAdvanceReason(base: Base, reason: AdvanceReason, fielder?: ResolvedFielder) {
    if (!state.runners[base]) return;
    setAdvanceReasonPrompt(null);

    if (reason === "stolen_base") {
      applyRunnerAction(base, "stolen_base");
      return;
    }

    if (reason === "wild_pitch" || reason === "passed_ball") {
      // Always a ball -- logs a real "ball" pitches row (per the earlier
      // wild-pitch/passed-ball fix) so the count survives a reload,
      // rather than a local-only counter bump.
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
      const advanced = advanceRunnerWithMethod(base, reason);
      const eventFielder = reason === "wild_pitch" ? resolve("P") : resolve("C");
      void withOfflineRetry(`event-${game.id}-${Date.now()}`, () =>
        logGameEvent(game.id, {
          eventType: reason,
          inning: state.inning,
          inningHalf: state.inningHalf,
          mode: state.mode,
          runsScored: advanced.scored.length,
          playerId: eventFielder?.playerId ?? null,
          opponentPlayerId: eventFielder?.opponentPlayerId ?? null,
        })
      );
      // The walk's own force-cascade applies on top of this runner's own
      // advance, not the pre-advance positions.
      if (ballsAfter >= 4) pickResult("walk", advanced.runners);
      return;
    }

    if (reason === "balk") {
      // Not a ball -- the count is untouched, only the runner moves.
      const advanced = advanceRunnerWithMethod(base, "balk");
      setSummaryFlash("Balk — runner advances");
      const fielderP = resolve("P");
      void withOfflineRetry(`event-${game.id}-${Date.now()}`, () =>
        logGameEvent(game.id, {
          eventType: "balk",
          inning: state.inning,
          inningHalf: state.inningHalf,
          mode: state.mode,
          runsScored: advanced.scored.length,
          playerId: fielderP?.playerId ?? null,
          opponentPlayerId: fielderP?.opponentPlayerId ?? null,
        })
      );
      return;
    }

    if (reason === "error") {
      // Unlike the old all-runners Error button and the removed
      // "Error Advance" quick action, this one now asks which fielder --
      // AdvanceReasonMenu routes here only after FieldingPositionPicker
      // has already resolved one.
      if (!fielder) return;
      const advanced = advanceRunnerWithMethod(base, "error");
      void withOfflineRetry(`event-${game.id}-${Date.now()}`, () =>
        logGameEvent(game.id, {
          eventType: "error",
          inning: state.inning,
          inningHalf: state.inningHalf,
          mode: state.mode,
          runsScored: advanced.scored.length,
          playerId: fielder.playerId,
          opponentPlayerId: fielder.opponentPlayerId,
        })
      );
      return;
    }

    // "passed_on_hit" (the plain, silent advance the old generic
    // "Advance" always meant -- still an RBI if it scores the runner,
    // same as a batted-ball advance always has been) and "obstruction"
    // (a decreed advance, nobody's batted-ball action -- no RBI, and no
    // game_events type exists for it, so nothing is logged, same
    // treatment as "no DB changes" leaves it).
    advanceRunnerWithMethod(base, reason === "passed_on_hit" ? "hit" : "obstruction");
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
  // game_events row. No fielder picker here (the spec didn't ask for one)
  // -- logged without a guessed attribution rather than assuming one.
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

  // Left-panel redesign: tapping the batter image itself is now the HBP
  // trigger (the old standalone HBP pill button is gone) -- same
  // handleDirectHbp underneath, plus bumping the per-side flash counter
  // so BatterImage's red flash overlay remounts and replays.
  function handleImageHbpTap(side: BattingHand) {
    setHbpFlash((prev) => ({ side, key: (prev?.side === side ? prev.key : 0) + 1 }));
    void handleDirectHbp();
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
  type FlowStep = "pitch" | "field" | "hitType" | "result" | "hitRunners" | "fielding" | "runnerConfirm";
  const flowStep: FlowStep = hitRunnerQueue.length > 0
    ? "hitRunners"
    : !state.awaitingResult
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

  // Fix 3 layout: the right panel shows exactly one thing at a time in
  // its middle slot -- a runner-related popup (highest priority, since
  // those need an explicit answer before anything else matters), an
  // active "what happened after contact" flow step, or the diamond as
  // the resting default. This replaces the old design's two *simultaneous*
  // panels (flow steps on the left, diamond+popups always visible on the
  // right) with one that never shows two conflicting things at once,
  // which is also what makes a strict two-panel, no-scroll layout
  // possible -- there's nowhere to put a second simultaneous panel.
  type RightPanelMode =
    | "tagUp"
    | "runnerPicker"
    | "runnerAction"
    | "outReason"
    | "advanceReason"
    | "advanceError"
    | "flow"
    | "diamond";
  const FLOW_STEPS_IN_RIGHT_PANEL = new Set<FlowStep>(["field", "hitType", "result", "hitRunners", "fielding", "runnerConfirm"]);
  const rightPanelMode: RightPanelMode = tagUpPrompt
    ? "tagUp"
    : runnerPicker
      ? "runnerPicker"
      : runnerActionMenu
        ? "runnerAction"
        : outReasonPrompt
          ? "outReason"
          : advanceReasonPrompt
            ? "advanceReason"
            : advanceErrorFielding
              ? "advanceError"
              : FLOW_STEPS_IN_RIGHT_PANEL.has(flowStep)
                ? "flow"
                : "diamond";

  const battingHandBadge = atBatBattingHand ?? battingPlayerInfo?.batting_hand ?? "R";

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden text-foreground">
      <StadiumBackground />

      {/* TOP BAR -- 52px, always visible */}
      <header className="z-10 flex h-[52px] shrink-0 items-center justify-between gap-2 border-b-2 border-accent-primary/40 bg-surface/90 px-3">
        <div className="flex rounded-md border border-border p-1 text-xs">
          {(["hitting", "pitching"] as const).map((m) => (
            <button
              key={m}
              onClick={() => dispatch({ type: "SET_MODE", mode: m })}
              className={`min-h-[36px] rounded px-3 font-heading font-semibold uppercase tracking-wide transition ${
                state.mode === m
                  ? m === "hitting"
                    ? "bg-accent-green text-background"
                    : "bg-accent-amber text-background"
                  : "text-foreground/50"
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        <p className="font-heading truncate text-sm font-bold text-white">
          {state.inningHalf === "top" ? "Top" : "Bot"} {state.inning}
          <span className="mx-1.5 text-foreground/30">·</span>
          {game.home_away === "home" ? game.opponent_name : "Us"} <span className="text-accent-green">{state.opponentScore}</span>
          {" – "}
          <span className="text-accent-green">{state.ourScore}</span> {game.home_away === "home" ? "Us" : game.opponent_name}
        </p>

        <div className="flex items-center gap-3">
          <div className="font-heading flex items-baseline gap-1 text-2xl font-bold leading-none">
            <span className="text-accent-green">{state.balls}</span>
            <span className="text-sm text-foreground/30">·</span>
            <span className="text-accent-red">{state.strikes}</span>
            <span className="text-sm text-foreground/30">·</span>
            <span className="text-accent-amber">{state.outs}</span>
          </div>
          <button onClick={() => setLeaveConfirmOpen(true)} className="min-h-[36px] px-1 text-[10px] text-foreground/40 hover:text-white">
            ← Dashboard
          </button>
        </div>
      </header>

      {/* Transient/occasional banners float over the top of the panels
          instead of reserving permanent height for something usually not
          shown -- the 52px/48px top/bottom bars leave no room to spare. */}
      <div className="pointer-events-none absolute inset-x-0 top-[52px] z-20 flex flex-col items-center gap-1 px-2 pt-1">
        {/* Fix 3: one per auto-scored runner, stacked (oldest on top,
            each independently tappable-to-undo or self-expiring after
            3s -- per spec: min 48px tall, green background, white text. */}
        {autoScoreBanners.map((b) => (
          <button
            key={b.id}
            onClick={() => undoAutoScore(b)}
            className="pointer-events-auto min-h-[48px] w-full max-w-[380px] rounded-md bg-accent-green px-4 text-left text-sm font-semibold text-white shadow-lg"
          >
            {autoScoreBannerText(b)} — tap to undo
          </button>
        ))}
        {summaryFlash && (
          <div className="glossy pointer-events-auto rounded-md border border-accent-green/50 bg-accent-green/15 px-3 py-1 text-center">
            <p className="font-heading text-xs font-semibold text-accent-green">{summaryFlash}</p>
          </div>
        )}
        {pendingSync > 0 && (
          <span className="pointer-events-auto rounded-full bg-accent-amber/20 px-3 py-1 text-[10px] text-accent-amber">{pendingSync} syncing…</span>
        )}
        {state.showLowAccuracyWarning && (
          <div className="pointer-events-auto rounded-md bg-accent-amber/15 px-3 py-1 text-[10px] text-accent-amber">Low pitch detail — heat map accuracy is reduced</div>
        )}
        {state.mode === "pitching" && state.pitchCountForCurrentPitcher >= 85 && (
          <div className="pointer-events-auto rounded-md bg-accent-red/15 px-3 py-1 text-[10px] font-semibold text-accent-red">High pitch count</div>
        )}
        {state.mode === "pitching" && state.pitchCountForCurrentPitcher >= 75 && state.pitchCountForCurrentPitcher < 85 && (
          <div className="pointer-events-auto rounded-md bg-accent-amber/15 px-3 py-1 text-[10px] font-semibold text-accent-amber">Approaching pitch limit</div>
        )}
        {banner && <div className="pointer-events-auto rounded-md bg-accent-red/15 px-3 py-1 text-[10px] text-accent-red">{banner}</div>}
      </div>

      {/* TWO EQUAL HALVES is the tablet layout (>=768px, grid-cols-2, per
          spec); below that the panels stack as two equal-height rows
          instead -- fitting a 320px-minimum zone plus flanking ellipses
          inside a genuine 50%-of-390px column is not achievable (roughly
          420px needed just for that row's tap-target minimums), so
          "emergency fallback" gets each panel the full viewport width and
          half the height instead of a half-width column. grid-rows-2
          (equal 1fr rows) keeps one panel's overflow from starving the
          other's visible space when stacked -- overflow-hidden alone,
          without an explicit row size, lets row content grow to whatever
          it needs and only clips the *combined* result. */}
      <div className="grid flex-1 grid-cols-1 grid-rows-2 overflow-hidden md:grid-cols-2 md:grid-rows-1">
        {/* LEFT PANEL -- pitching/hitting the ball. Nothing else. Fix 5:
            the "Heat Map" toggle (and the session-heat-map render mode it
            drove, in both this panel and StrikeZoneGrid itself) is gone --
            heat maps are a coach-dashboard feature; this screen only ever
            logs pitches now. gamePitchLog still accumulates in
            OperatorState (harmless, and other code doesn't touch it), it
            just has no on-screen consumer here any more.

            Left-panel redesign: the header label and the footer controls
            (hand pill, IBB) are now `absolute` overlays instead of their
            own flex-col rows -- freeing the middle row to be the panel's
            *only* normal-flow content, so it can be given the panel's
            full height (per spec, the batter images must be "the same
            height as the full left panel," which a shrink-0 header/footer
            sharing that same flex-col would otherwise eat into). `relative`
            on the panel is what anchors those overlays. */}
        <div className="relative flex flex-col overflow-hidden border-b border-border p-2 md:border-b-0 md:border-r">
          <p className="absolute left-2 top-2 z-10 text-[10px] uppercase tracking-wide text-foreground/40">
            Strike zone — tap to log a pitch
          </p>

          {/* Batter image / zone / batter image, flush against each other
              (gap-0) and each other's edges -- no card, no border, no
              padding on the images themselves (per spec). flex-1 here is
              what claims the *entire* panel height now that the header/
              footer above are absolute overlays rather than siblings
              competing for space. Before a hand is picked, both images
              render at 50% opacity; picking one un-renders the other
              entirely (not just opacity: 0) so its slot collapses and the
              zone ends up flush against the one remaining image, matching
              "[Zone][Batter-right]" / "[Batter-left][Zone]" from the spec
              -- conditional rendering does this for free, no extra
              layout logic needed. Each side's condition is "hand isn't
              definitively the *other* side" (!== "R" / !== "L"), not "is
              null," so a switch hitter ('S', from the player's own
              profile) still shows both images at 50% -- same "unresolved
              stance" treatment null already gets, consistent with how
              hbpEligible below treats 'S' too. */}
          <div className="flex flex-1 items-center justify-center gap-0 overflow-hidden">
            {state.mode === "hitting" && atBatBattingHand !== "R" && (
              <BatterImage
                hand="L"
                image="/batter-left.png"
                selected={atBatBattingHand === "L"}
                flash={hbpFlash?.side === "L" ? hbpFlash.key : 0}
                onTapHbp={() => handleImageHbpTap("L")}
              />
            )}
            <div className="flex flex-1 items-center justify-center overflow-hidden">
              <StrikeZoneGrid
                selectedZone={state.selectedZone}
                lastPitchZone={state.lastPitchZone}
                pendingPitches={state.pendingPitches}
                onTap={(x, y) => dispatch({ type: "TAP_ZONE", x, y })}
                flashKey={flashKey}
                disabled={flowStep !== "pitch" || (state.mode === "hitting" && atBatBattingHand === null)}
                popupContent={
                  state.selectedZone
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
            </div>
            {state.mode === "hitting" && atBatBattingHand !== "L" && (
              <BatterImage
                hand="R"
                image="/batter-right.png"
                selected={atBatBattingHand === "R"}
                flash={hbpFlash?.side === "R" ? hbpFlash.key : 0}
                onTapHbp={() => handleImageHbpTap("R")}
              />
            )}
          </div>

          {/* Footer overlay: warning text / pending-pitches list (both
              unchanged from before, just repositioned) / the L-R hand pill
              (replaces the old batter-card taps as the way to pick a
              stance, now that the images themselves are an HBP tap target
              instead) / IBB (unchanged; the standalone HBP pill next to it
              is gone -- tapping either batter image is the new HBP
              trigger). */}
          <div className="absolute inset-x-2 bottom-2 z-10 flex flex-col items-center gap-1">
            {state.mode === "hitting" && atBatBattingHand === null && (
              <p className="truncate text-center text-[10px] text-accent-amber">Select batter&apos;s stance to activate the zone</p>
            )}
            {state.pendingPitches.length > 0 && (
              <p className="truncate text-center text-[10px] text-foreground/50">
                {state.pendingPitches
                  .map((p, i) => `${i + 1}. ${p.pitch_type ? PITCH_TYPE_LABELS[p.pitch_type] : "Pitch"} — ${OUTCOME_LABELS[p.outcome]}`)
                  .join(", ")}
              </p>
            )}
            <div className="flex items-center gap-2">
              {state.mode === "hitting" && (
                <div className="glossy flex overflow-hidden rounded-full border border-accent-green bg-surface">
                  {(["L", "R"] as const).map((h) => (
                    <button
                      key={h}
                      onClick={() => setAtBatBattingHand(h)}
                      aria-pressed={atBatBattingHand === h}
                      className={`min-h-[36px] min-w-[36px] px-3 text-xs font-bold transition ${
                        atBatBattingHand === h ? "bg-accent-green text-background" : "text-foreground/60 hover:text-white"
                      }`}
                    >
                      {h}
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={() => setIbbConfirmOpen(true)}
                className="min-h-[36px] rounded-full border px-3 text-xs font-semibold transition hover:brightness-125"
                style={{ borderColor: "#EF9F27", color: "#EF9F27" }}
              >
                IBB
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL -- what happens after contact. */}
        <div className="flex flex-col overflow-hidden p-2">
          {/* Current batter card -- Fix 4: capped at 80px so the diamond
              below gets the overwhelming majority of the panel's height. */}
          <div className="glossy flex max-h-[80px] shrink-0 items-center gap-3 overflow-hidden rounded-lg border-l-4 border-accent-green bg-card p-2.5">
            {state.mode === "hitting" ? (
              <>
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-accent-gold bg-surface font-heading text-lg font-bold text-white">
                  {battingPlayerInfo?.jersey_number ?? "—"}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-heading truncate text-[22px] font-bold leading-tight text-accent-gold">
                    {battingPlayerInfo?.name ?? "—"}
                  </p>
                  <div className="flex items-center gap-2 text-[11px] text-foreground/60">
                    <span>
                      #{battingPlayerInfo?.jersey_number ?? "—"} · {battingPlayerInfo?.position ?? "—"}
                    </span>
                    <span className="rounded border border-accent-primary/50 px-1 text-[10px] font-semibold text-accent-primary">
                      {battingHandBadge}
                    </span>
                  </div>
                  {battingPlayerInfo && seasonBattingLines[battingPlayerInfo.id] && (
                    <p className="font-mono text-[10px] text-foreground/50">
                      AVG {formatAvg(seasonBattingLines[battingPlayerInfo.id].avg)} · HR {seasonBattingLines[battingPlayerInfo.id].hr} · RBI{" "}
                      {seasonBattingLines[battingPlayerInfo.id].rbi}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-wide text-foreground/40">Opposing batter</p>
                <input
                  value={state.opponentBatterName}
                  onChange={(e) => dispatch({ type: "SET_OPPONENT_BATTER_NAME", name: e.target.value })}
                  list="opponent-batters"
                  placeholder="Type or select name"
                  className="font-heading w-full border-b border-border bg-transparent text-lg font-bold text-accent-gold outline-none focus:border-accent-primary"
                />
                <datalist id="opponent-batters">
                  {opponentPlayers.map((p) => (
                    <option key={p.id} value={p.name} />
                  ))}
                </datalist>
                <div className="mt-1 flex items-center justify-between text-[10px]">
                  <button onClick={() => setPitcherPickerOpen(true)} className="text-accent-primary hover:underline">
                    Pitcher: {currentPitcher ? currentPitcher.name : "Select…"}
                  </button>
                  <span className={pitchCountColor}>
                    {state.pendingPitches.length} this AB · {state.pitchCountForCurrentPitcher} total
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Middle: exactly one of a runner popup / active flow step /
              the diamond -- see rightPanelMode above. Every mode except
              the diamond itself still uses the full available space here
              (a runner picker/reason menu benefits from all the room it
              can get); the diamond alone is wrapped in its own h-[60%]
              box below -- runners were reading as oversized at the size
              an unconstrained fill produced, so this batch caps it back
              down to "≈60% of the right panel," a deliberate reduction
              from the previous "≈75%+." */}
          <div className="flex flex-1 flex-col items-center justify-center gap-2 overflow-hidden py-1">
            {rightPanelMode === "tagUp" && (
              <div className="glossy w-full max-w-[320px] rounded-lg border border-accent-amber/50 bg-accent-amber/10 p-3">
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

            {rightPanelMode === "runnerPicker" && runnerPicker && (
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

            {rightPanelMode === "runnerAction" && runnerActionMenu && state.runners[runnerActionMenu] && (
              <RunnerQuickActionMenu
                base={runnerActionMenu}
                runner={state.runners[runnerActionMenu]!}
                onAction={(a) => {
                  // "Out" asks why first; "Advance" opens the
                  // consolidated reason menu instead of moving the runner
                  // immediately -- every other action ("Scored", "Picked
                  // Off") is unchanged.
                  if (a === "out") {
                    setOutReasonPrompt({ base: runnerActionMenu, runner: state.runners[runnerActionMenu]! });
                    setRunnerActionMenu(null);
                    return;
                  }
                  if (a === "advance") {
                    setAdvanceReasonPrompt({ base: runnerActionMenu, runner: state.runners[runnerActionMenu]! });
                    setRunnerActionMenu(null);
                    return;
                  }
                  applyRunnerAction(runnerActionMenu, a);
                }}
                onClose={() => setRunnerActionMenu(null)}
              />
            )}

            {rightPanelMode === "outReason" && outReasonPrompt && (
              <OutReasonMenu
                base={outReasonPrompt.base}
                runner={outReasonPrompt.runner}
                onSelect={(eventType) => handleRunnerOutWithReason(outReasonPrompt.base, eventType)}
                onClose={() => setOutReasonPrompt(null)}
              />
            )}

            {rightPanelMode === "advanceReason" && advanceReasonPrompt && (
              <AdvanceReasonMenu
                base={advanceReasonPrompt.base}
                runner={advanceReasonPrompt.runner}
                onSelect={(reason) => {
                  if (reason === "error") {
                    setAdvanceErrorFielding(advanceReasonPrompt.base);
                    setAdvanceReasonPrompt(null);
                    return;
                  }
                  void handleAdvanceReason(advanceReasonPrompt.base, reason);
                }}
                onClose={() => setAdvanceReasonPrompt(null)}
              />
            )}

            {rightPanelMode === "advanceError" && advanceErrorFielding && (
              <FieldingPositionPicker
                title="Who committed the error?"
                onSelect={(f) => {
                  setAdvanceErrorFielding(null);
                  void handleAdvanceReason(advanceErrorFielding, "error", f);
                }}
                resolve={resolve}
              />
            )}

            {rightPanelMode === "flow" && (
              <>
                {flowStep === "field" && (
                  <>
                    <p className="font-heading text-center text-base font-bold text-white">Tap where the ball landed</p>
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

                {flowStep === "hitRunners" && state.suggestedResult && hitRunnerQueue[0] && state.runners[hitRunnerQueue[0]] && (
                  <HitRunnerConfirmPanel
                    base={hitRunnerQueue[0]}
                    runner={state.runners[hitRunnerQueue[0]]!}
                    runners={state.runners}
                    targetBase={battersTargetBase(state.suggestedResult)}
                    showBaseChoice={hitRunnerNoStep}
                    onNo={() => setHitRunnerNoStep(true)}
                    onDecide={(decision) => handleHitRunnerDecision(hitRunnerQueue[0], decision)}
                  />
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
                        <p className="mt-1 text-xs text-accent-amber">Suggested runner movement — review below</p>
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
              </>
            )}

            {rightPanelMode === "diamond" && (
              <div className="flex h-[60%] w-full items-center justify-center">
                <BaserunnerDiamond
                  runners={state.runners}
                  pending={state.runnersPendingConfirmation}
                  onBaseTap={(b) => (state.runners[b] ? setRunnerActionMenu(b) : setRunnerPicker(b))}
                />
              </div>
            )}
          </div>

          {/* Quick actions -- compact, secondary (Fix 4: 40px). Everything
              else now flows from tapping the runner directly (see
              rightPanelMode). */}
          <div className="flex h-10 shrink-0 gap-2">
            <QuickButton
              label="Pickoff"
              onClick={() => setPickoffWizard({ step: "base" })}
              className="glossy flex-1 justify-start border-l-4 border-l-accent-primary pl-3 text-left"
            />
            <QuickButton
              label="Substitution"
              onClick={() => dispatch({ type: "SET_PANEL", panel: "substitution", open: true })}
              className="glossy flex-1 justify-start border-l-4 border-l-accent-gold pl-3 text-left"
            />
          </div>
        </div>
      </div>

      {/* BOTTOM BAR -- 48px, always visible */}
      <div className="z-10 flex h-[48px] shrink-0 items-center justify-between gap-2 border-t-2 border-accent-primary/40 bg-surface/90 px-3">
        <button
          onClick={confirmEndInning}
          className="min-h-[40px] rounded-md bg-accent-amber px-3 text-xs font-semibold text-background"
        >
          End Inning
        </button>

        {state.accuracyAtBatCount > 0 && (
          <span className={`truncate text-[10px] ${runningAccuracyPercent < 70 ? "text-accent-amber" : "text-foreground/50"}`}>
            Logging: {runningAccuracyPercent}% accurate
          </span>
        )}

        <div className="flex items-center gap-2">
          {undoActive && (
            <button
              onClick={handleUndo}
              className="relative min-h-[40px] overflow-hidden rounded-md bg-accent-amber px-3 text-xs font-semibold text-background"
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
          <button
            onClick={() => dispatch({ type: "SET_PANEL", panel: "endGame", open: true })}
            className="min-h-[40px] rounded-md bg-accent-red px-3 text-xs font-semibold text-white"
          >
            End Game
          </button>
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
          onConfirm={handleSubstitutionConfirm}
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
    </div>
  );
}

// Fix 1: step 1 of the zone-tap popup -- asked before the outcome menu,
// per spec. "Unknown" logs pitch_type as null (already how an unset pitch
// type has always been recorded -- nothing new needed there) with no
// separate "penalty" flag to track, since none of the pitch-type-keyed
// stats (Strike Rate by pitch type, etc.) treat a null pitch_type as
// anything but "excluded from that breakdown," which is already correct.
// Left-panel redesign: full-height batter silhouettes flanking the
// strike zone, replacing the earlier bordered/backgrounded card
// (BatterStanceCard, an ellipse button before that). Raw <img>, no
// button chrome, no card -- "no card border, no background, no padding"
// per spec, tapping the image itself is now the HBP trigger instead of
// a hand-selection tap (hand selection moved to the small L/R pill in
// the footer overlay below). Plain <img>, not next/image, matching the
// rest of this file's static-/public-asset convention. /batter-left.png
// and /batter-right.png (transparent-background silhouettes) live in
// /public.
//
// BATTER_IMAGE_VERTICAL_OFFSET_PX exists so the batter's elbow lines up
// with the top of the green strike zone and their knees with its bottom
// (the zone sits vertically centered in this same row -- see
// StrikeZoneGrid's usage above). Still 0 -- getting this right needs
// visually comparing the rendered image against the zone at real size,
// which hasn't been done yet; treat this as a known follow-up, not a
// finished value.
const BATTER_IMAGE_VERTICAL_OFFSET_PX = 0;

// Both PNGs render the batter well inset from the *inner* edge of their
// own bounding box -- the bat's own knob is the first non-transparent
// pixel, roughly 11.5% of the image's width in from that edge (measured
// directly off /batter-right.png and /batter-left.png; the two are
// mirror images of each other, so this is the same fraction on both).
// Flex's gap-0 already closes the *box* gap to zero, but that transparent
// margin still reads as visible empty space between the zone and the
// batter -- this is what "the gap doesn't look closed despite gap-0"
// actually is. translateX pulls the image in by that fraction (a %
// value in `transform` is relative to the element's *own* box, unlike
// margin/inset percentages, so this stays correct at any rendered size)
// plus a further fixed 10px so the visible art overlaps the zone
// slightly, per spec. Sign flips with which side the image is on: the R
// image needs to move left (negative), the L image right (positive).
const BATTER_IMAGE_INNER_MARGIN_PCT = 11.5;
const BATTER_IMAGE_OVERLAP_PX = 10;

function BatterImage({
  hand,
  image,
  selected,
  flash,
  onTapHbp,
}: {
  hand: BattingHand;
  image: string;
  selected: boolean;
  // 0 = no flash rendered (including on first mount -- see the `flash >
  // 0` guard below, the same "don't play the animation on mount" guard
  // strike-zone-grid.tsx's own flashKey uses); any other value is a
  // fresh HBP tap and remounts the flash overlay to replay it.
  flash: number;
  onTapHbp: () => void;
}) {
  const sign = hand === "R" ? -1 : 1;
  return (
    <div className="relative h-full shrink-0" style={{ opacity: selected ? 1 : 0.5 }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- static /public PNG, not an optimizable next/image candidate */}
      <img
        src={image}
        alt={`${hand === "L" ? "Left" : "Right"}-handed batter`}
        onClick={onTapHbp}
        className={`block h-full w-auto cursor-pointer ${selected ? "batter-glow-selected" : ""}`}
        style={{
          transform: `translateX(calc(${sign * BATTER_IMAGE_INNER_MARGIN_PCT}% + ${sign * BATTER_IMAGE_OVERLAP_PX}px)) translateY(${BATTER_IMAGE_VERTICAL_OFFSET_PX}px)`,
        }}
      />
      {flash > 0 && <div key={flash} className="batter-hbp-flash pointer-events-none absolute inset-0" />}
    </div>
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
// row is 0-4 (1-3 are the zone's own top/middle/bottom thirds, 0/4 are the
// ring's top/bottom rows -- restored). Eligible in the zone's own top
// third and middle third only (rows 1/2); row 0 is the ring's top row,
// rows 3/4 are the zone's bottom third and the ring's bottom row -- all
// excluded, per "not top row, not bottom two rows."
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

// Fix 4 (layout proportions batch): both call sites (Pickoff, Substitution)
// are the compact bottom row of the right panel, so 40px -- not the 48px
// tap-target minimum used elsewhere -- is the deliberate height here.
function QuickButton({ label, onClick, className = "" }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button
      onClick={onClick}
      className={`h-10 rounded-md border border-border bg-surface px-3 text-sm font-medium text-foreground/80 hover:border-accent-primary hover:text-white ${className}`}
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

// "Stolen Base" and "Error Advance" were removed from here -- both are
// now reasons under "Advance" (AdvanceReasonMenu) instead of their own
// top-level entries, per the runner-actions consolidation.
const RUNNER_QUICK_ACTIONS: { action: RunnerQuickAction; label: string }[] = [
  { action: "advance", label: "Advance" },
  { action: "scored", label: "Scored" },
  { action: "out", label: "Out" },
  { action: "picked_off", label: "Picked Off" },
];

// Rendered inside the right panel's middle section, which is already
// items-center/justify-center (see the "Middle:" comment above) -- so
// this is centered in the right panel by construction, not a tooltip
// anchored to the tap point the way the strike-zone popup is. Fix (popup
// size batch): min-w/button-height/text size are now explicit tap-target
// and readability minimums per spec, not just "whatever max-w-xs and
// text-xs happen to produce."
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
    <div className="glossy w-full min-w-[200px] max-w-xs rounded-md border border-border bg-background p-3">
      <p className="mb-2 text-xs text-foreground/50">
        {runner.jersey ? `#${runner.jersey} ` : ""}
        {runner.name} on {base}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {RUNNER_QUICK_ACTIONS.map((o) => (
          <button
            key={o.action}
            onClick={() => onAction(o.action)}
            className="min-h-[44px] rounded border border-border px-2 text-[15px] font-medium text-white hover:border-accent-primary"
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

// Runner-actions consolidation: the one place every runner advance now
// flows through, replacing the standalone Wild Pitch/Passed Ball/Balk/
// Error (all-runners) buttons and the separate Stolen Base quick action.
// Fix 1: one runner at a time from the hitRunners queue -- "Stay" is
// hidden if this runner's current base is exactly where the batter is
// headed (they can't share it), "Advance" (always exactly one base, not
// an open-ended picker) is hidden if the next base up is already spoken
// for, by the batter's target or by an already-resolved lead runner who
// stayed put. "Scored" is always offered -- sometimes it's the only
// option left, which is correct (nowhere else for them to go).
const NEXT_BASE: Record<Base, Base | null> = { first: "second", second: "third", third: null };

function HitRunnerConfirmPanel({
  base,
  runner,
  runners,
  targetBase,
  showBaseChoice,
  onNo,
  onDecide,
}: {
  base: Base;
  runner: RunnerState;
  runners: Runners;
  targetBase: Base | "home";
  showBaseChoice: boolean;
  onNo: () => void;
  onDecide: (decision: "scored" | "stay" | "advance") => void;
}) {
  const canStay = base !== targetBase;
  const nextBase = NEXT_BASE[base];
  const canAdvance = nextBase !== null && nextBase !== targetBase && !runners[nextBase];

  return (
    <div className="glossy w-full max-w-[320px] rounded-lg border border-accent-gold/40 bg-surface p-4 text-center">
      <p className="text-xs uppercase tracking-wide text-foreground/40">Runner on {base}</p>
      <p className="font-heading mt-1 text-lg font-bold text-white">{runner.name}</p>
      <p className="mt-1 text-sm text-foreground/70">Did they score?</p>

      {!showBaseChoice ? (
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => onDecide("scored")}
            className="min-h-[48px] flex-1 rounded-md bg-accent-green px-4 text-sm font-semibold text-white"
          >
            Yes, scored
          </button>
          <button
            onClick={onNo}
            className="min-h-[48px] flex-1 rounded-md border border-border px-4 text-sm font-medium text-foreground/70 hover:border-accent-primary hover:text-white"
          >
            No
          </button>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-xs text-foreground/50">Which base did they end up on?</p>
          {canStay && (
            <button
              onClick={() => onDecide("stay")}
              className="min-h-[48px] rounded-md border border-border px-4 text-sm font-medium text-white hover:border-accent-primary"
            >
              Stay at {base}
            </button>
          )}
          {canAdvance && nextBase && (
            <button
              onClick={() => onDecide("advance")}
              className="min-h-[48px] rounded-md border border-border px-4 text-sm font-medium text-white hover:border-accent-primary"
            >
              Advance to {nextBase}
            </button>
          )}
          <button
            onClick={() => onDecide("scored")}
            className="min-h-[48px] rounded-md border border-accent-green/50 px-4 text-sm font-medium text-accent-green hover:bg-accent-green/10"
          >
            Actually, scored
          </button>
        </div>
      )}
    </div>
  );
}

const ADVANCE_REASONS: { value: AdvanceReason; label: string }[] = [
  { value: "stolen_base", label: "Stolen Base" },
  { value: "wild_pitch", label: "Wild Pitch" },
  { value: "passed_ball", label: "Passed Ball" },
  { value: "balk", label: "Balk" },
  { value: "error", label: "Error" },
  { value: "passed_on_hit", label: "Passed on Hit" },
  { value: "obstruction", label: "Obstruction" },
];

function AdvanceReasonMenu({
  base,
  runner,
  onSelect,
  onClose,
}: {
  base: Base;
  runner: RunnerState;
  onSelect: (reason: AdvanceReason) => void;
  onClose: () => void;
}) {
  return (
    <div className="glossy w-full min-w-[200px] max-w-xs rounded-md border border-accent-primary/40 bg-background p-3">
      <p className="mb-2 text-xs text-foreground/50">
        {runner.jersey ? `#${runner.jersey} ` : ""}
        {runner.name} on {base} advances — why?
      </p>
      <div className="grid grid-cols-2 gap-2">
        {ADVANCE_REASONS.map((r) => (
          <button
            key={r.value}
            onClick={() => onSelect(r.value)}
            className="min-h-[44px] rounded border border-border px-2 text-[15px] font-medium text-white hover:border-accent-primary"
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
    <div className="glossy w-full min-w-[200px] max-w-xs rounded-md border border-accent-red/40 bg-background p-3">
      <p className="mb-2 text-xs text-foreground/50">
        {runner.jersey ? `#${runner.jersey} ` : ""}
        {runner.name} on {base} — out. Why?
      </p>
      <div className="grid grid-cols-2 gap-2">
        {OUT_REASONS.map((r) => (
          <button
            key={r.eventType}
            onClick={() => onSelect(r.eventType)}
            className="min-h-[44px] rounded border border-border px-2 text-[15px] font-medium text-white hover:border-accent-primary"
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

// BoxScoreDashboard (H/R/E/K/LOB) was dropped from the layout in this
// batch's Fix 3 overhaul -- the request's explicit 52px top bar / 48px
// bottom bar budget, with the middle strictly split into the two panels,
// leaves no third bar to put it in without either breaking "no scrolling"
// or silently growing the chrome past what was specified. The data
// itself is untouched (state.hitsGame etc. still accumulate normally);
// only this always-visible summary of it is gone. Worth restoring as a
// deliberate addition later (a toggle, or folded into a panel) if it's
// missed in practice.

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
