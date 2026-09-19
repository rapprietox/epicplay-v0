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
import { advanceOneRunner, isForced, suggestRunnerAdvance } from "@/lib/operator/runner-advance";
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
import { Scoreboard } from "./scoreboard";
import { ConfettiBurst, Fireworks, InningEndBurst } from "./celebration";
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
  step: "runner" | "type" | "fielding1" | "fielding2" | "thirdOutAsk" | "thirdOutRunner" | "thirdOutType" | "thirdOutFielding";
  base?: Base;
  outType: OutType;
  firstFielding?: ResolvedFielder;
  // Fix 8 (baseball-logic-fixes batch, minor tier): held onto once known
  // so it can be passed to handleConfirmDoublePlay only once the wizard
  // fully resolves -- confirming used to happen immediately after this
  // was picked, before there was a "was there a third out?" step to defer
  // past.
  secondFielding?: ResolvedFielder;
  thirdBase?: Base;
  thirdOutType?: OutType;
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
  teamName,
  opponentPitchCountSeed,
  initialSubstitutions,
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
  // Fix 4 (six-fixes batch): the coach-set teams.name row, replacing the
  // hardcoded "Us" the score display used everywhere it needed to name
  // our own side.
  teamName: string;
  // Addition 2 (two-additions batch): one-time seed for
  // state.opponentPitchCount, counted server-side (pitches joined
  // through hitting-mode at-bats) since there's no game_state column to
  // read it from directly -- the reducer increments it live from here.
  opponentPitchCountSeed: number;
  // Fix 6 (baseball-logic-fixes batch): every substitution logged so far
  // this game, seeded server-side and appended to locally as new subs are
  // made -- drives which players are eligible for "Player out"/"Player
  // in"/pitcher-change (no re-entry, no double-booking a player already
  // active elsewhere). Only the two id columns are needed here.
  initialSubstitutions: { player_out_id: string; player_in_id: string }[];
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
    buildInitialStateFromServer(game, initialGameState, draftAtBat, allGamePitches, opponentPitchCountSeed)
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
  // Fix 6: seeded from the server, appended to locally the moment a sub is
  // confirmed (same optimistic-local-first pattern as every other write in
  // this console) so the eligibility filters below react immediately
  // rather than waiting on a reload.
  const [substitutionLog, setSubstitutionLog] = useState(initialSubstitutions);
  // Fix 2 (baseball-logic-fixes batch): the two-step dropped-third-strike
  // prompt -- null means no prompt is active.
  const [dropThirdStep, setDropThirdStep] = useState<"caught_or_dropped" | "safe_or_out" | null>(null);
  // Fix 5 (baseball-logic-fixes batch): shown right after a strikeout
  // confirms with runners on base -- "Yes" hands off to the normal
  // per-runner diamond Advance flow (postStrikeoutWildPitch tells
  // handleAdvanceReason to skip logging a second phantom pitch, since the
  // real pitch that got away was already logged as the strikeout's own
  // strike 3).
  const [wildPitchKPrompt, setWildPitchKPrompt] = useState(false);
  const [postStrikeoutWildPitch, setPostStrikeoutWildPitch] = useState(false);
  const [pitcherPickerOpen, setPitcherPickerOpen] = useState(false);
  const [dpWizard, setDpWizard] = useState<DpWizardState | null>(null);
  // Fix 2: two-step pickoff wizard (pick the base, then the result) opened
  // from the quick-actions panel -- separate from the existing per-base
  // "Picked Off" runner quick-action (tap an occupied base -> its menu),
  // which stays as the quick single-tap path and still doesn't log a
  // game_events row (see CLAUDE.md). This one always does, and adds the
  // "attempted, runner safe" outcome that quick-action never had.
  const [pickoffWizard, setPickoffWizard] = useState<{ step: "base" | "result"; base?: Base } | null>(null);
  // Addition 1 (two-additions batch): shown after a flyout/lineout
  // at-bat confirms with runners on base and the inning still alive
  // (outs < 3) -- asks what happened to each runner on the play, top
  // base first (queue order: third, second, first). Supersedes the
  // earlier, narrower "did anyone leave early" tag-up-only prompt: that
  // was exactly this same trigger (flyouts + runners on base) but with
  // only one of what are now four per-runner outcomes (Scored / Advanced
  // / Held / Out-left-early) -- see SacFlyPanel below, which reuses
  // handleTagUpViolation's own out-on-appeal logic verbatim for that
  // fourth option rather than duplicating it. Cleared automatically once
  // the next batter's first pitch starts a new draft at-bat (the window
  // to decide has implicitly passed), or as each runner in the queue is
  // resolved.
  const [sacFlyQueue, setSacFlyQueue] = useState<Base[]>([]);
  // Addition 1: "was this a squeeze play?" -- only ever prompted when a
  // bunt confirms with the runner on third still actually on third
  // (state.runners.third truthy at confirm time). A bunt *single*
  // doesn't reach this at all: "single" is a HIT_RESULT, so the
  // existing hit-runner-confirm/auto-score machinery (decideRunnerOnHit:
  // "third base always auto-scores on any hit") already resolves that
  // runner's third-base fate before handleConfirm ever runs, which is
  // exactly what naturally excludes it here -- no separate check needed
  // beyond "is anyone still on third."
  const [squeezePrompt, setSqueezePrompt] = useState(false);
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

  // RBI/run-scored/home-run celebration -- toasts, full-screen flashes,
  // confetti/fireworks, and the scoreboard's score-pulse are all driven
  // from here. Scoped to the one place that already knows, synchronously
  // and before dispatch, exactly how many runs/RBI a confirm produced,
  // who scored, and whether the result was a home run (handleConfirm
  // below) -- not a generic state.ourScore-diff watcher, which would
  // catch every path a run can score through (double play, intentional
  // walk, wild pitch/balk, adjustScore for a delayed steal of home) but
  // couldn't say *who* scored, *how* (HR vs. otherwise), or risk
  // double-firing against a more specific trigger. Known, documented
  // gap: those other paths don't call handleConfirm, so they don't
  // trigger this celebration yet -- same "honest partial coverage,
  // flagged" precedent as this codebase's other documented
  // simplifications (Whiff Rate, chase rate, etc.), not silently assumed
  // complete.
  type ToastKind = "rbi" | "run" | "hr" | "opp_run" | "opp_hr" | "k" | "inning_over";
  const [celebrationToasts, setCelebrationToasts] = useState<{ id: number; kind: ToastKind; text: string; leaving: boolean }[]>(
    []
  );
  // Three separate full-screen flashes (plain run / RBI / home run all
  // read differently per spec -- see .celebration-flash/-rbi/-hr in
  // globals.css) plus confetti (RBI) and fireworks (HR) particle bursts,
  // each its own bump counter so remounting one never restarts another.
  const [celebrationFlash, setCelebrationFlash] = useState(0);
  const [rbiFlash, setRbiFlash] = useState(0);
  const [hrFlash, setHrFlash] = useState(0);
  const [confettiKey, setConfettiKey] = useState(0);
  const [fireworksKey, setFireworksKey] = useState(0);
  // The scoreboard's score-number animation has two tiers (plain
  // score-celebrate vs. the bigger score-celebrate-hr) -- tier travels
  // alongside the bump key so Scoreboard knows which class to apply for
  // *this* remount without needing two independent key props.
  const [scoreCelebrate, setScoreCelebrate] = useState<{ key: number; tier: "normal" | "hr" }>({ key: 0, tier: "normal" });
  // Pitching-mode reactions batch (Fix 2/3): opponent run/HR flashes,
  // the opponent score's own pulse/shake, the strike-zone-scoped
  // strikeout flash, and the last-out-of-inning burst -- all the same
  // bump-a-counter-and-remount idiom as the hitting-mode celebration
  // state above, just the "opposite energy" set.
  const [oppRunFlash, setOppRunFlash] = useState(0);
  const [oppHrDarkFlash, setOppHrDarkFlash] = useState(0);
  const [oppHrRedFlash, setOppHrRedFlash] = useState(0);
  const [opponentScoreCelebrate, setOpponentScoreCelebrate] = useState<{ key: number; tier: "run" | "hr" }>({
    key: 0,
    tier: "run",
  });
  const [strikeoutFlashKey, setStrikeoutFlashKey] = useState(0);
  const [inningEndBurstKey, setInningEndBurstKey] = useState(0);
  // True for a 1.5s window after the pitching-mode last-out-of-inning
  // toast fires -- ThreeOutsModal checks this and stays hidden until it
  // clears, per spec ("toast... THEN the inning-end modal appears on
  // top"). Reset by its own timeout, not by the next at-bat starting
  // (unlike the sac-fly/squeeze prompts) since the inning genuinely has
  // ended at this point -- there's no "next pitch" to key a cleanup
  // effect off until the *next* half-inning's first pitch, which is more
  // machinery than a plain timeout needs.
  const [inningEndCelebrating, setInningEndCelebrating] = useState(false);
  const toastIdRef = useRef(0);

  // durationMs is the toast's total on-screen time including its 250ms
  // slide-in and 300ms slide-out (per spec, "stays 2s, slides out" etc.
  // are inclusive of the transition, not additional to it) -- `leaving`
  // flips 300ms before removal so .toast-slide-out can play first
  // instead of the toast just vanishing.
  function pushCelebrationToast(kind: ToastKind, text: string, durationMs = 2500) {
    const id = ++toastIdRef.current;
    setCelebrationToasts((prev) => [...prev, { id, kind, text, leaving: false }]);
    setTimeout(() => {
      setCelebrationToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    }, Math.max(0, durationMs - 300));
    setTimeout(() => setCelebrationToasts((prev) => prev.filter((t) => t.id !== id)), durationMs);
  }

  useEffect(() => {
    if (!summaryFlash) return;
    const t = setTimeout(() => setSummaryFlash(null), 2500);
    return () => clearTimeout(t);
  }, [summaryFlash]);

  useEffect(() => {
    if (state.currentAtBatId) {
      setSacFlyQueue([]);
      setSqueezePrompt(false);
    }
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

  // Fix 5 (baseball-logic-fixes batch): the wild-pitch-on-K window closes
  // once a new draft at-bat starts -- same "the window has implicitly
  // passed" reasoning the tag-up appeal panel already uses elsewhere.
  // Without this, an ignored prompt (or a "Yes" the operator never
  // followed through on by tapping a runner) would stay armed and could
  // wrongly attach a much later, unrelated wild pitch to this at-bat.
  useEffect(() => {
    if (!state.currentAtBatId) return;
    setWildPitchKPrompt(false);
    setPostStrikeoutWildPitch(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.currentAtBatId]);

  // Fix 6 (baseball-logic-fixes batch): who's currently on the field for
  // our team, and who's already been used up this game -- derived from
  // the starting lineup plus every substitution logged so far, no
  // re-entry (once a player is substituted out, they stay out for good;
  // this app has no mechanism to bring them back, matching the "does not
  // fix re-entry" scope of the fixes this batch is building). Order of
  // substitutions doesn't matter for either set: a player who was ever a
  // player_out this game is permanently ineligible, and everyone else who
  // started or was ever brought in and never taken back out is active.
  const substitutedOutIds = useMemo(() => new Set(substitutionLog.map((s) => s.player_out_id)), [substitutionLog]);
  const activePlayerIds = useMemo(() => {
    const startingIds = lineup.map((l) => l.player_id);
    const broughtInIds = substitutionLog.map((s) => s.player_in_id);
    const active = new Set([...startingIds, ...broughtInIds]);
    substitutedOutIds.forEach((id) => active.delete(id));
    return active;
  }, [lineup, substitutionLog, substitutedOutIds]);

  const battingPlayer = useMemo(
    () => (state.mode === "hitting" ? lineup.find((l) => l.batting_order === state.battingOrderPosition) : undefined),
    [lineup, state.mode, state.battingOrderPosition]
  );
  const battingPlayerInfo = useMemo(
    () => (battingPlayer ? players.find((p) => p.id === battingPlayer.player_id) : undefined),
    [battingPlayer, players]
  );

  // Addition 2: the opponent's pitcher, if their lineup photo import
  // happened to record one with position "P" -- opponent_players has no
  // "who's pitching right now" concept (no live pitching-change tracking
  // for the other team at all), so this is a static best-effort lookup,
  // not something that updates mid-game the way our own currentPitcher
  // does via SET_PITCHER.
  const opponentPitcherInfo = useMemo(() => opponentPlayers.find((p) => p.position === "P"), [opponentPlayers]);

  // Fix 7 (six-fixes batch, appended after): "on deck" is just the next
  // slot in the batting order, wrapping from the last position back to
  // the first -- lineup.batting_order isn't guaranteed to already be
  // sorted (it's fetched as a plain table scan), so the position list is
  // sorted here before finding "current, then one after it." Recomputes
  // automatically whenever state.battingOrderPosition changes (a new
  // batter stepping up), same as battingPlayer above.
  const onDeckPlayerInfo = useMemo(() => {
    if (state.mode !== "hitting" || lineup.length === 0) return undefined;
    const positions = lineup.map((l) => l.batting_order).sort((a, b) => a - b);
    const currentIdx = positions.indexOf(state.battingOrderPosition);
    const nextPos = currentIdx === -1 ? positions[0] : positions[(currentIdx + 1) % positions.length];
    const onDeckSlot = lineup.find((l) => l.batting_order === nextPos);
    return onDeckSlot ? players.find((p) => p.id === onDeckSlot.player_id) : undefined;
  }, [lineup, players, state.mode, state.battingOrderPosition]);

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
    // Fix 3: a caught foul tip completes strike 3 exactly like a plain
    // strike does.
    else if ((outcome === "strike" || outcome === "foul_tip") && state.strikes + 1 >= 3) autoResult = "strikeout";

    // Fix 2: eligibility for the "was it caught?" prompt, decided on the
    // pre-dispatch snapshot -- a foul tip is caught by definition (that's
    // what makes it a foul tip and not a plain foul), so it never prompts.
    // Standard rule: dropped third strike doesn't apply (batter is out no
    // matter what) when 1st is occupied with fewer than 2 outs, since
    // letting the batter run there would hand the defense a cheap
    // force-play double play the rule exists to prevent.
    const isDroppableStrikeout = autoResult === "strikeout" && outcome === "strike";
    const dropThirdEligible = isDroppableStrikeout && (!state.runners.first || state.outs >= 2);

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

    if (dropThirdEligible) {
      // Deferred: handleDropThirdDecision (below) calls pickResult once
      // the operator answers "caught?" (and, if dropped, "safe?").
      setDropThirdStep("caught_or_dropped");
      return;
    }
    if (autoResult) pickResult(autoResult);
  }

  // Fix 2 (baseball-logic-fixes batch): resolves the two-step
  // dropped-third-strike prompt. "Caught" is just a normal strikeout --
  // nothing was actually dropped, so no game_events row. "Dropped" logs
  // the event regardless of the throw's outcome (the drop itself is what
  // happened, whether or not the defense recovers), then either
  // "Safe" (dropped_third_strike_safe, batter reaches 1st, is_out=false)
  // or "Thrown Out" (a plain strikeout -- the K stands, the drop just
  // didn't matter in the end).
  function handleDropThirdCaught() {
    setDropThirdStep(null);
    pickResult("strikeout");
  }

  function handleDropThirdDropped() {
    setDropThirdStep("safe_or_out");
  }

  // Fix 4 (baseball-logic-fixes batch): a bunt attempt fouled off with 2
  // strikes already is an automatic strikeout (rule 6.03(a)(2)) -- unlike
  // any other foul, which just caps at 2 strikes and waits for the next
  // pitch. Reuses handlePitchOutcome verbatim for the actual pitch
  // logging (still just outcome "foul", swing true -- indistinguishable
  // from a regular foul in the data), then layers the strikeout
  // completion on top using the strike count from *before* this pitch
  // (captured synchronously, ahead of handlePitchOutcome's own await).
  async function handlePitchPopupPick(outcome: PitchOutcome, swing: boolean, isBunt?: boolean) {
    const isBuntStrikeout = outcome === "foul" && isBunt === true && state.strikes >= 2;
    await handlePitchOutcome(outcome, swing);
    if (isBuntStrikeout) {
      setSummaryFlash("Foul bunt — 2 strikes — STRIKEOUT");
      pickResult("strikeout");
    }
  }

  function handleDropThirdResolution(safe: boolean) {
    setDropThirdStep(null);
    const fielder = resolve("C");
    void withOfflineRetry(`dts-${game.id}-${Date.now()}`, () =>
      logGameEvent(game.id, {
        eventType: "dropped_third_strike",
        inning: state.inning,
        inningHalf: state.inningHalf,
        mode: state.mode,
        playerId: fielder?.playerId ?? null,
        opponentPlayerId: fielder?.opponentPlayerId ?? null,
      })
    );
    pickResult(safe ? "dropped_third_strike_safe" : "strikeout");
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
    // Fix 1 (force-play validation): a groundout is always a force out at
    // first (the batter-runner has no choice but to run) -- this is the
    // same rule as "a runner forced out elsewhere," not a separate one,
    // so it folds into the same currentPlayForceOuts check rather than a
    // standalone "batter out before first" flag. flyout/lineout/strikeout
    // are never forces (batter is retired without anyone being forced to
    // advance); double_play never reaches this function (its own confirm
    // path hardcodes runsScored to 0 already, so nothing to void here).
    const batterForcedAtFirst = isOut && result === "groundout";
    const outsAfterThisPlay = state.outs + (isOut ? 1 : 0);
    // Rule 5.09(b)/4.09(b): if the out that ends the half-inning is a
    // force out, no run scores on that same play, no matter when the
    // runner crossed home relative to the out. Deliberately NOT "batter
    // out before first always cancels the run" as a separate rule --
    // that would incorrectly block the legal, common "productive out"
    // case (runner scores from 3rd on a routine, non-force groundout
    // with fewer than 2 outs and 1st base open).
    const voidRuns = outsAfterThisPlay >= 3 && (batterForcedAtFirst || state.currentPlayForceOuts.length > 0);
    const runsScored = voidRuns ? 0 : state.scoredThisAtBat.length;
    const rbi = voidRuns ? 0 : state.pendingRbi;
    const accuracyRatio = atBatAccuracyRatio(result, state.pendingPitches.length);
    const hitType = state.pendingHitType;
    const fieldX = state.fieldTap?.x ?? null;
    const fieldY = state.fieldTap?.y ?? null;
    const mode = state.mode;
    const fielding = state.pendingFielding;
    const scoredRunners = voidRuns ? [] : state.scoredThisAtBat;
    const batterName = battingPlayerInfo?.name ?? "Batter";

    dispatch({ type: "CONFIRM_LOCAL", atBatId, outsRecorded: isOut ? 1 : 0, accuracyRatio, voidRuns });
    if (voidRuns && state.scoredThisAtBat.length > 0) {
      setBanner(
        `${state.scoredThisAtBat.length > 1 ? "Runs" : "Run"} did not count — the 3rd out was a force play (rule 5.09)`
      );
    }

    // Celebrate -- hitting mode only, per spec. Reads the pre-dispatch
    // snapshot captured above (state.scoredThisAtBat/pendingRbi are
    // about to be reset for the next batter). A home run gets its own,
    // more dramatic tier (fireworks, triple flash, bigger score-scale,
    // one big banner toast) instead of stacking the plain run + RBI
    // treatments on top of it -- a HR almost always produces both, but
    // showing all three at once would be visual noise, not "more
    // dramatic." Every other result keeps the plain run-scored toast
    // (per runner) and/or the RBI confetti treatment, independently,
    // exactly as before.
    if (mode === "hitting") {
      if (result === "hr") {
        setFireworksKey((k) => k + 1);
        setHrFlash((k) => k + 1);
        setScoreCelebrate((prev) => ({ key: prev.key + 1, tier: "hr" }));
        pushCelebrationToast("hr", `💥 HOME RUN — ${batterName}! 🔥`, 2500);
      } else {
        if (runsScored > 0) {
          scoredRunners.forEach((s) => pushCelebrationToast("run", `🏃 ${s.runner.name} SCORES!`));
          setCelebrationFlash((k) => k + 1);
          setScoreCelebrate((prev) => ({ key: prev.key + 1, tier: "normal" }));
        }
        if (rbi > 0) {
          setConfettiKey((k) => k + 1);
          setRbiFlash((k) => k + 1);
          pushCelebrationToast("rbi", `⚾ RBI — ${batterName}!`, 2500);
        }
      }
    } else if (mode === "pitching") {
      // Pitching-mode reactions batch (Fix 2/3): the "opposite energy" --
      // red/dark flashes and no confetti for a run or HR against, a
      // scoped blue zone-flash for a strikeout, and a green burst +
      // banked toast for the last out of the inning. Regular outs
      // (flyout/groundout/lineout that don't end the inning) stay
      // silent, per spec -- only the four cases below ever fire
      // anything here.
      const outsAfter = state.outs + (isOut ? 1 : 0);
      const isLastOut = isOut && outsAfter >= 3;
      const isStrikeout = result === "strikeout";
      const opponentBatterLabel = state.opponentBatterName || "Batter";

      if (isStrikeout) {
        setStrikeoutFlashKey((k) => k + 1);
        pushCelebrationToast("k", `⚡ K — ${opponentBatterLabel} STRUCK OUT!`, 2000);
      }

      if (result === "hr") {
        setOppHrDarkFlash((k) => k + 1);
        setOppHrRedFlash((k) => k + 1);
        setOpponentScoreCelebrate((prev) => ({ key: prev.key + 1, tier: "hr" }));
        pushCelebrationToast("opp_hr", `💥 HOME RUN — ${opponentBatterLabel}`, 3000);
      } else if (runsScored > 0) {
        scoredRunners.forEach((s) => pushCelebrationToast("opp_run", `💀 Run scored — ${s.runner.name}`));
        setOppRunFlash((k) => k + 1);
        setOpponentScoreCelebrate((prev) => ({ key: prev.key + 1, tier: "run" }));
      }

      if (isLastOut) {
        // Strikeout-as-last-out sequences the blue flash first (per
        // spec, "blue flash first (200ms) then green burst") -- a plain
        // setTimeout rather than useEffect machinery, since this is a
        // one-shot delay triggered from an event handler, not something
        // that needs to react to state changes.
        const delay = isStrikeout ? 200 : 0;
        setTimeout(() => {
          setInningEndBurstKey((k) => k + 1);
          pushCelebrationToast("inning_over", `🔒 INNING OVER — ${teamName} holds!`, 1500);
          setInningEndCelebrating(true);
          setTimeout(() => setInningEndCelebrating(false), 1500);
        }, delay);
      }
    }
    setSummaryFlash(
      [RESULT_LABELS[result], hitType ? HIT_TYPE_LABELS[hitType] : null, fielding?.position ?? null].filter(Boolean).join(" — ")
    );
    // Addition 1: sac-fly/tag-up decision queue -- fly out or line out,
    // at least one runner still on base, and this out didn't end the
    // inning (outs *after* this one < 3 -- a dead inning has no more
    // baserunning to ask about). Queue order is top base first (third,
    // second, first), per spec.
    if ((result === "flyout" || result === "lineout") && state.outs + 1 < 3) {
      const order: Base[] = ["third", "second", "first"];
      const queue = order.filter((b) => state.runners[b]);
      if (queue.length > 0) setSacFlyQueue(queue);
    }
    // Addition 1: squeeze-play prompt -- see squeezePrompt's own comment
    // above for why "single" never reaches this.
    if (hitType === "bunt" && state.runners.third) setSqueezePrompt(true);
    // Fix 5 (baseball-logic-fixes batch): a plain caught strikeout (not
    // dropped-third-strike-safe, which already covers "the catcher
    // couldn't handle it" via its own Fix 2 prompt) with runners on base
    // -- ask whether the pitch that ended the at-bat also got away enough
    // to let someone else advance.
    if (result === "strikeout" && (state.runners.first || state.runners.second || state.runners.third)) {
      setWildPitchKPrompt(true);
    }

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
    // Fix 8 (baseball-logic-fixes batch, minor tier): present only when
    // the wizard's "was there a third out?" step was answered yes.
    thirdOut?: { base: Base; runner: RunnerState; outType: OutType; fielding: ResolvedFielder };
  }) {
    const atBatId = state.currentAtBatId;
    if (!atBatId) return;
    setDpWizard(null);
    setBanner(null);
    try {
      const { secondAtBatId, thirdAtBatId } = await confirmDoublePlay({
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
        thirdOut: input.thirdOut
          ? {
              runner: { type: input.thirdOut.runner.type, id: input.thirdOut.runner.id },
              outType: input.thirdOut.outType,
              fielding: {
                position: input.thirdOut.fielding.position,
                playerId: input.thirdOut.fielding.playerId,
                opponentPlayerId: input.thirdOut.fielding.opponentPlayerId,
              },
            }
          : undefined,
      });
      const accuracyRatio = atBatAccuracyRatio("double_play", state.pendingPitches.length);
      dispatch({
        type: "CONFIRM_DOUBLE_PLAY",
        atBatId,
        secondAtBatId,
        removedBase: input.base,
        accuracyRatio,
        thirdAtBatId,
        thirdRemovedBase: input.thirdOut?.base ?? null,
      });
      setSummaryFlash(input.thirdOut ? "Triple Play" : "Double Play");
      void withOfflineRetry(`dp-state-${game.id}-${Date.now()}`, () =>
        syncGameState(game.id, {
          runners: {
            ...state.runners,
            [input.base]: null,
            ...(input.thirdOut ? { [input.thirdOut.base]: null } : {}),
          },
          outs: Math.min(3, state.outs + (input.thirdOut ? 3 : 2)),
          current_at_bat_id: null,
        })
      );
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "Failed to log double play -- check connection and try again");
    }
  }

  async function handleUndo() {
    if (!state.lastConfirmed) return;
    const { atBatId, secondAtBatId, thirdAtBatId, mode, runsScored, runnersBeforeAtBat, pitchesThisAtBat } = state.lastConfirmed;
    dispatch({ type: "UNDO_LOCAL" });
    syncRunners(runnersBeforeAtBat);
    // Fix 7 (baseball-logic-fixes batch): UNDO_LOCAL already corrects the
    // local pitchCountForCurrentPitcher, but that counter is also
    // persisted server-side in game_state (logPitch increments it there
    // directly, unlike opponentPitchCount which is never stored and just
    // gets recomputed fresh from real pitch rows on reload) -- without
    // this, a reload after an Undo would resurrect the stale, too-high
    // count from the DB. Computed from the pre-dispatch snapshot (the
    // same math UNDO_LOCAL just applied), not read back from `state`,
    // since this render's `state` hasn't caught up to that dispatch yet.
    if (mode === "pitching" && pitchesThisAtBat > 0) {
      const corrected = Math.max(0, state.pitchCountForCurrentPitcher - pitchesThisAtBat);
      void withOfflineRetry(`undo-pitchcount-${atBatId}`, () =>
        syncGameState(game.id, { pitch_count_for_current_pitcher: corrected })
      );
    }
    void withOfflineRetry(`undo-${atBatId}`, () =>
      undoAtBat({ gameId: game.id, atBatId, secondAtBatId, thirdAtBatId, mode, runsScoredToReverse: runsScored })
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
    // Fix 6: recorded immediately (not awaited) so the eligibility filters
    // on both selects and the pitcher picker exclude this pair on the very
    // next render, same as every other optimistic-local-first write here.
    setSubstitutionLog((log) => [...log, { player_out_id: playerOutId, player_in_id: playerInId }]);
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

  function applyRunnerAction(base: Base, action: RunnerQuickAction, scoreMethod?: ScoreMethod, forced?: boolean) {
    const runner = state.runners[base];
    if (!runner) return;

    if (action === "scored" && !scoreMethod) {
      setRunnerActionMenu(null);
      setScoreMethodPrompt({ base, runner });
      return;
    }

    dispatch({ type: "APPLY_RUNNER_ACTION", base, action, scoreMethod, forced });
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
      // Fix 5 (baseball-logic-fixes batch): if this wild pitch/passed ball
      // is the follow-up to a strikeout that just completed on strike 3
      // (postStrikeoutWildPitch), the pitch that got away was already
      // logged correctly as "strike" (it's what completed the K) -- there
      // is no longer a draft at-bat to attach a second, phantom pitch to
      // (this one's confirmed, the next batter hasn't stepped in). Skip
      // straight to the runner advance + event log. Otherwise, unchanged:
      // always a ball -- logs a real "ball" pitches row so the count
      // survives a reload, rather than a local-only counter bump.
      if (!postStrikeoutWildPitch) {
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

      setPostStrikeoutWildPitch(false);
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
    // Fix 1 (force-play validation): "Out at Next Base" is the one reason
    // in this menu that represents a runner forced out advancing on a
    // batted ball -- the other five (pickoff, caught stealing, rundown,
    // passed-a-runner, out-on-appeal) are all tag plays or independent
    // violations, never forces, regardless of who else is on base.
    // isForced() checks the pre-play snapshot, not live state, since force
    // status doesn't change mid-play under standard rules.
    const forced = eventType === "out_at_next_base" && isForced(base, state.runnersAtAtBatStart);
    applyRunnerAction(base, "out", undefined, forced);
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

  // Addition 1: one runner's outcome on a fly out/line out with the
  // inning still alive -- popped from sacFlyQueue regardless of which
  // way it's decided. "Scored" and "advance" both go through the same
  // applyRunnerAction path every other runner move already uses;
  // "scored" passes scoreMethod "sac_fly" directly (already a real
  // ScoreMethod, already RBI-eligible per SCORE_METHOD_AWARDS_RBI -- no
  // schema change needed, exactly the mechanism CLAUDE.md already
  // documents for why "Sacrifice Fly" was never its own AtBatResult
  // button). "out_early" is handleTagUpViolation's own former body,
  // moved here verbatim (reuses the same out-on-appeal path + the same
  // tag_up_violation game_events row) rather than duplicated.
  type SacFlyDecision = "scored" | "advance" | "held" | "out_early";
  function handleSacFlyDecision(base: Base, decision: SacFlyDecision) {
    const runner = state.runners[base];
    setSacFlyQueue((q) => q.filter((b) => b !== base));
    if (!runner) return;
    if (decision === "held") return;
    if (decision === "scored") {
      applyRunnerAction(base, "scored", "sac_fly");
      setSummaryFlash(`${runner.name} scores — sacrifice fly`);
      return;
    }
    if (decision === "advance") {
      applyRunnerAction(base, "advance");
      setSummaryFlash(`${runner.name} advances to ${NEXT_BASE[base]}`);
      return;
    }
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

  // Addition 1: resolves the squeeze-play prompt. "Yes" reuses the exact
  // same applyRunnerAction("scored", ...) path sac-fly's own "Scored"
  // option uses -- squeeze_play is just another RBI-eligible ScoreMethod
  // (SCORE_METHOD_AWARDS_RBI) that happens to also auto-log its own
  // game_events row via SCORE_METHOD_EVENT, both already wired generically
  // in applyRunnerAction, so no bespoke scoring/logging code was needed
  // here beyond adding those two type-table entries. "No" leaves the
  // bunt's own already-confirmed result (groundout/single/error/fc) as
  // the complete record -- there's nothing left to do.
  function handleSqueezeDecision(wasSqueeze: boolean) {
    const runner = state.runners.third;
    setSqueezePrompt(false);
    if (!wasSqueeze || !runner) return;
    applyRunnerAction("third", "scored", "squeeze_play");
    setSummaryFlash(`${runner.name} scores — squeeze play`);
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
    | "dropThird"
    | "wildPitchK"
    | "sacFly"
    | "squeeze"
    | "runnerPicker"
    | "runnerAction"
    | "outReason"
    | "advanceReason"
    | "advanceError"
    | "flow"
    | "diamond";
  const FLOW_STEPS_IN_RIGHT_PANEL = new Set<FlowStep>(["field", "hitType", "result", "hitRunners", "fielding", "runnerConfirm"]);
  const rightPanelMode: RightPanelMode = dropThirdStep
    ? "dropThird"
    : wildPitchKPrompt
    ? "wildPitchK"
    : sacFlyQueue.length > 0
    ? "sacFly"
    : squeezePrompt
      ? "squeeze"
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

      {/* Refinement pass -- Fix 5: three full-screen flashes (plain run /
          RBI / home run, each its own color+timing -- see globals.css),
          each remounted only on its own trigger and only once fired
          (guard > 0, the same "don't play on mount" pattern flashKey/
          hbpFlash already use), plus the RBI confetti and HR fireworks
          particle bursts. All position: fixed, pointer-events: none,
          z-[9999] -- never intercept a tap. */}
      {celebrationFlash > 0 && <div key={`cf-${celebrationFlash}`} className="celebration-flash pointer-events-none fixed inset-0 z-[9999]" />}
      {rbiFlash > 0 && <div key={`rf-${rbiFlash}`} className="celebration-flash-rbi pointer-events-none fixed inset-0 z-[9999]" />}
      {hrFlash > 0 && <div key={`hf-${hrFlash}`} className="celebration-flash-hr pointer-events-none fixed inset-0 z-[9999]" />}
      <ConfettiBurst triggerKey={confettiKey} />
      <Fireworks triggerKey={fireworksKey} />

      {/* Pitching-mode reactions batch: opponent run/HR flashes ("the
          opposite energy" -- red/dark, no confetti) and the inning-end
          burst. Same remount-only-once-fired pattern as the hitting-mode
          flashes above. */}
      {oppRunFlash > 0 && <div key={`orf-${oppRunFlash}`} className="celebration-flash-opp-run pointer-events-none fixed inset-0 z-[9999]" />}
      {oppHrDarkFlash > 0 && (
        <div key={`ohd-${oppHrDarkFlash}`} className="celebration-flash-opp-hr-dark pointer-events-none fixed inset-0 z-[9999]" />
      )}
      {oppHrRedFlash > 0 && (
        <div key={`ohr-${oppHrRedFlash}`} className="celebration-flash-opp-hr-red pointer-events-none fixed inset-0 z-[9999]" />
      )}
      <InningEndBurst triggerKey={inningEndBurstKey} />

      {/* All toast kinds, stacked top-center. The horizontal centering
          (-translate-x-1/2) is static, applied once to this container --
          not part of each toast's own slide animation, which only needs
          to animate vertically. `leaving` swaps the slide-in class for
          slide-out 300ms before the toast is removed from the array
          entirely. hr/opp_hr get a larger full-width banner treatment;
          everything else shares the smaller pill style, colored per kind. */}
      <div className="pointer-events-none fixed left-1/2 top-4 z-[9999] flex w-full max-w-md -translate-x-1/2 flex-col items-center gap-2 px-4">
        {celebrationToasts.map((t) => (
          <div
            key={t.id}
            className={`${t.leaving ? "toast-slide-out" : "toast-slide-in"} rounded-md border font-bold shadow-lg ${
              t.kind === "hr"
                ? "w-full whitespace-normal px-5 py-3 text-center text-lg border-accent-gold bg-gradient-to-r from-[#0A2214] via-[#123018] to-[#0A2214] text-accent-gold"
                : t.kind === "opp_hr"
                  ? "w-full whitespace-normal px-5 py-3 text-center text-lg border-accent-red bg-gradient-to-r from-[#2A0808] via-[#3D0B0B] to-[#2A0808] text-white"
                  : "whitespace-nowrap px-4 py-2 text-sm " +
                    (t.kind === "rbi"
                      ? "border-accent-gold/60 bg-[#0A2214] text-accent-gold"
                      : t.kind === "run"
                        ? "border-accent-green/60 bg-[#0A2214] text-accent-green"
                        : t.kind === "opp_run"
                          ? "border-accent-red/60 bg-[#2A0808] text-white"
                          : t.kind === "k"
                            ? "border-[#1D4ED8]/60 bg-[#1D4ED8] text-white"
                            : "border-accent-green/60 bg-accent-green text-white")
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>

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

        {/* Addition 2 (two-additions batch): replaces the previous
            "HITTING — batter · AB N" readout with the pitcher on the
            mound instead -- in hitting mode that's the *opponent's*
            pitcher (opponentPitcherInfo, a best-effort lookup off their
            lineup-photo-imported roster; "OPP. PITCHER" if none was
            tagged position "P"), with state.opponentPitchCount for their
            whole-game total; in pitching mode it's our own currentPitcher
            with the existing pitchCountForCurrentPitcher, colored via
            the same pitchCountColor thresholds (amber 75+, red 85+) the
            pitching-mode batter-strip pitch count already uses, so both
            readouts of that same number always agree. */}
        <p className={`truncate text-center font-mono text-[13px] ${state.mode === "hitting" ? "text-foreground/60" : pitchCountColor}`}>
          {state.mode === "hitting"
            ? `${opponentPitcherInfo?.name ?? "OPP. PITCHER"} · ${state.opponentPitchCount} pitches`
            : `${currentPitcher?.name ?? "—"} · ${state.pitchCountForCurrentPitcher} pitches`}
        </p>

        {/* Right-panel redesign: the floating B/S/O readout that used to
            live here is gone -- the scoreboard's own B/S/O line (right
            panel, Section 2) is now the only place those counts are
            shown, so this bar is just mode toggle + batter/pitcher info +
            the dashboard exit. */}
        <button onClick={() => setLeaveConfirmOpen(true)} className="min-h-[36px] px-1 text-[10px] text-foreground/40 hover:text-white">
          ← Dashboard
        </button>
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
          <p className="absolute left-2 top-2 z-10 text-[15px] uppercase tracking-[0.08em] text-[#7AB893]">
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
                strikeoutFlashKey={strikeoutFlashKey}
                disabled={flowStep !== "pitch" || (state.mode === "hitting" && atBatBattingHand === null)}
                popupContent={
                  state.selectedZone
                    ? pitchTypeStepDone ? (
                        <PitchOutcomePopup
                          zone={classifyZone(state.selectedZone.x, state.selectedZone.y)}
                          battingHand={state.mode === "hitting" ? atBatBattingHand : null}
                          onPick={handlePitchPopupPick}
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

        {/* RIGHT PANEL -- what happens after contact. p-1.5 (was p-2) --
            refinement pass, ~25% tighter, applied throughout this panel. */}
        <div className="flex flex-col overflow-hidden p-1.5">
          {/* Sections 1-3 (batter strip / scoreboard / on-deck) get a
              max-width so they stay a compact centered column instead of
              stretching edge-to-edge on a wide screen -- the diamond
              (Section 4, below) is deliberately NOT inside this wrapper,
              since it must still fill the panel's full remaining
              width/height per Fix 4. */}
          <div className="mx-auto flex w-full max-w-[420px] shrink-0 flex-col gap-1">
          {/* Sections 1+2 (three-fixes batch): batter/pitcher card top
              LEFT, scoreboard top RIGHT, side by side -- replaces the
              previous stacked layout (one-line strip, then scoreboard
              below it). justify-between + items-start per spec; the
              card is flex-1 (takes whatever the scoreboard's fixed
              ~220px doesn't need), the scoreboard is shrink-0 so it
              never gets squeezed by a long name. */}
          <div className="flex items-start justify-between gap-2">
            <div className="glossy flex min-w-0 flex-1 items-center gap-2.5 rounded-lg border-l-[3px] border-l-accent-green bg-card px-2.5 py-2">
              {state.mode === "hitting" ? (
                <>
                  {/* Circular avatar -- jersey number for now, styled like
                      the diamond's runner dots but bigger; swaps for a real
                      photo once players can upload one, same slot. */}
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-accent-gold bg-surface font-heading text-2xl font-bold text-white">
                    {battingPlayerInfo?.jersey_number ?? "—"}
                  </div>
                  <div className="min-w-0">
                    <p className="font-heading truncate text-[20px] font-bold text-white">{battingPlayerInfo?.name ?? "—"}</p>
                    <p className="truncate text-[12px] text-foreground/40">
                      {battingPlayerInfo?.position ?? "—"} · {battingHandBadge}
                    </p>
                    {battingPlayerInfo && seasonBattingLines[battingPlayerInfo.id] && (
                      <p className="truncate font-mono text-[13px] text-accent-green">
                        AVG {formatAvg(seasonBattingLines[battingPlayerInfo.id].avg)} · HR {seasonBattingLines[battingPlayerInfo.id].hr} · RBI{" "}
                        {seasonBattingLines[battingPlayerInfo.id].rbi}
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <div className="min-w-0 flex-1">
                  <input
                    value={state.opponentBatterName}
                    onChange={(e) => dispatch({ type: "SET_OPPONENT_BATTER_NAME", name: e.target.value })}
                    list="opponent-batters"
                    placeholder="Opposing batter…"
                    className="font-heading w-full border-b border-border bg-transparent text-[20px] font-bold text-white outline-none focus:border-accent-primary"
                  />
                  <datalist id="opponent-batters">
                    {opponentPlayers.map((p) => (
                      <option key={p.id} value={p.name} />
                    ))}
                  </datalist>
                  <div className="mt-0.5 flex items-center gap-2">
                    <button onClick={() => setPitcherPickerOpen(true)} className="shrink-0 text-[12px] text-accent-primary hover:underline">
                      P: {currentPitcher ? currentPitcher.name : "Select…"}
                    </button>
                    <span className={`shrink-0 text-[12px] ${pitchCountColor}`}>{state.pitchCountForCurrentPitcher}p</span>
                  </div>
                </div>
              )}
            </div>

            {/* Scoreboard, flush to the right edge, capped narrower
                (~220px) than its previous standalone centered width
                (300px) now that it shares the row with the batter card. */}
            <Scoreboard
              teamName={teamName}
              opponentName={game.opponent_name ?? "Opponent"}
              ourScore={state.ourScore}
              opponentScore={state.opponentScore}
              inning={state.inning}
              inningHalf={state.inningHalf}
              outs={state.outs}
              balls={state.balls}
              strikes={state.strikes}
              isLive={game.status === "active"}
              celebrateKey={scoreCelebrate.key}
              celebrateTier={scoreCelebrate.tier}
              opponentCelebrateKey={opponentScoreCelebrate.key}
              opponentCelebrateTier={opponentScoreCelebrate.tier}
            />
          </div>

          {/* Section 3: on-deck batter -- capped at 24px, one compact
              muted line so it stays supporting info rather than
              competing with the diamond or the scoreboard for
              attention. Derived from onDeckPlayerInfo above, so it
              advances automatically the moment the batting order does.
              Opponent batters (mode === "pitching") have no lineup/
              order concept here, so this only ever shows in hitting
              mode. The jersey circle is styled as a glowing blue badge
              (border/background + drop-shadow filter) -- a deliberately
              different accent color from the gold/green/amber already
              used everywhere else on this screen, so "on deck" reads as
              its own distinct category at a glance. */}
          {state.mode === "hitting" && onDeckPlayerInfo && (
            <div className="flex h-6 max-h-6 shrink-0 items-center justify-center gap-1.5 truncate font-mono text-[12px] text-foreground/50">
              <span className="text-[13px] font-semibold uppercase tracking-wide text-accent-amber">On deck</span>
              <span aria-hidden="true">⚾</span>
              <span
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                style={{ background: "#3B82F6", filter: "drop-shadow(0 0 6px #3B82F6)" }}
              >
                {onDeckPlayerInfo.jersey_number ?? "—"}
              </span>
              <span className="truncate text-[14px]">{onDeckPlayerInfo.name}</span>
              {seasonBattingLines[onDeckPlayerInfo.id] && <span>· AVG {formatAvg(seasonBattingLines[onDeckPlayerInfo.id].avg)}</span>}
            </div>
          )}
          </div>

          {/* Middle: exactly one of a runner popup / active flow step /
              the diamond -- see rightPanelMode above. flex-1 here is
              "everything left after sections 1 (batter strip), 2
              (scoreboard), 3 (on-deck), and 5 (quick actions)," which the
              diamond (Section 4) now fills entirely (h-full, not the
              previous batch's h-[60%] cap) -- it must visually dominate
              the panel, per this redesign's own framing. Every other
              rightPanelMode branch still gets the same full space; only
              the diamond's own wrapper below claims all of it as a rule
              rather than a byproduct. */}
          <div className="flex flex-1 flex-col items-center justify-center gap-2 overflow-hidden py-1">
            {rightPanelMode === "dropThird" && dropThirdStep === "caught_or_dropped" && (
              <div className="glossy w-full max-w-[320px] rounded-lg border border-accent-red/50 bg-accent-red/10 p-3 text-center">
                <p className="text-sm font-semibold text-white">Strike 3 — was it caught?</p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={handleDropThirdCaught}
                    className="min-h-[44px] flex-1 rounded-md bg-accent-primary px-3 text-sm font-semibold text-white"
                  >
                    Caught
                  </button>
                  <button
                    onClick={handleDropThirdDropped}
                    className="min-h-[44px] flex-1 rounded-md border border-accent-red px-3 text-sm font-semibold text-accent-red"
                  >
                    Dropped
                  </button>
                </div>
              </div>
            )}

            {rightPanelMode === "dropThird" && dropThirdStep === "safe_or_out" && (
              <div className="glossy w-full max-w-[320px] rounded-lg border border-accent-red/50 bg-accent-red/10 p-3 text-center">
                <p className="text-sm font-semibold text-white">Dropped third strike — batter safe at 1st?</p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => handleDropThirdResolution(true)}
                    className="min-h-[44px] flex-1 rounded-md bg-accent-green px-3 text-sm font-semibold text-background"
                  >
                    Safe
                  </button>
                  <button
                    onClick={() => handleDropThirdResolution(false)}
                    className="min-h-[44px] flex-1 rounded-md border border-accent-red px-3 text-sm font-semibold text-accent-red"
                  >
                    Thrown Out
                  </button>
                </div>
              </div>
            )}

            {rightPanelMode === "wildPitchK" && (
              <div className="glossy w-full max-w-[320px] rounded-lg border border-accent-amber/50 bg-accent-amber/10 p-3 text-center">
                <p className="text-sm font-semibold text-white">Was this pitch a wild pitch or passed ball?</p>
                <p className="mt-1 text-xs text-accent-amber">The strikeout stands either way — tap a runner on the diamond next if Yes</p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => {
                      setWildPitchKPrompt(false);
                      setPostStrikeoutWildPitch(true);
                    }}
                    className="min-h-[44px] flex-1 rounded-md bg-accent-primary px-3 text-sm font-semibold text-white"
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => setWildPitchKPrompt(false)}
                    className="min-h-[44px] flex-1 rounded-md border border-border px-3 text-sm font-medium text-foreground/70"
                  >
                    No
                  </button>
                </div>
              </div>
            )}

            {rightPanelMode === "sacFly" && sacFlyQueue[0] && state.runners[sacFlyQueue[0]] && (
              <SacFlyPanel
                base={sacFlyQueue[0]}
                runner={state.runners[sacFlyQueue[0]]!}
                onDecide={(decision) => handleSacFlyDecision(sacFlyQueue[0], decision)}
              />
            )}

            {rightPanelMode === "squeeze" && state.runners.third && (
              <div className="glossy w-full max-w-[320px] rounded-lg border border-accent-amber/50 bg-accent-amber/10 p-3 text-center">
                <p className="text-sm font-semibold text-white">Was this a squeeze play?</p>
                <p className="mt-1 text-xs text-accent-amber">{state.runners.third.name} breaks for home on the bunt</p>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => handleSqueezeDecision(true)}
                    className="min-h-[44px] flex-1 rounded-md border border-accent-green/60 text-sm font-medium text-white hover:bg-accent-green/20"
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => handleSqueezeDecision(false)}
                    className="min-h-[44px] flex-1 rounded-md border border-border text-sm font-medium text-white hover:border-accent-primary"
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
              // Section 4 (right-panel redesign): the diamond is one of
              // this screen's two protagonists and must dominate the
              // panel -- h-full (was h-[60%] in a previous batch) lets
              // it claim the middle section's entire flex-1 space, which
              // is now genuinely "everything left after sections 1-3-5"
              // rather than a fraction of it. BaserunnerDiamond's own
              // internals (dot/text sizes, viewBox) are untouched.
              <div className="flex h-full w-full items-center justify-center">
                <BaserunnerDiamond
                  runners={state.runners}
                  pending={state.runnersPendingConfirmation}
                  onBaseTap={(b) => (state.runners[b] ? setRunnerActionMenu(b) : setRunnerPicker(b))}
                />
              </div>
            )}
          </div>

          {/* Section 5: quick actions -- compact, secondary, 40px.
              Everything else now flows from tapping the runner directly
              (see rightPanelMode). Already this compact from an earlier
              batch; unchanged by this redesign beyond the section label. */}
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
          // Fix 8 (baseball-logic-fixes batch, minor tier): no longer
          // confirms immediately -- holds the fielder and asks "was there
          // a third out?" first, since a triple play needs one more
          // runner/type/fielding round before there's anything to confirm.
          onSecondFielding={(f) => setDpWizard((w) => (w ? { ...w, step: "thirdOutAsk", secondFielding: f } : w))}
          onThirdOutAsk={(hasThirdOut) => {
            if (!dpWizard.base || !dpWizard.firstFielding || !dpWizard.secondFielding) return;
            const runner = state.runners[dpWizard.base];
            if (!runner) return;
            if (!hasThirdOut) {
              void handleConfirmDoublePlay({
                base: dpWizard.base,
                runner,
                outType: dpWizard.outType,
                batterFielding: dpWizard.firstFielding,
                secondFielding: dpWizard.secondFielding,
              });
              return;
            }
            setDpWizard((w) => (w ? { ...w, step: "thirdOutRunner" } : w));
          }}
          onChangeThirdBase={(base) => setDpWizard((w) => (w ? { ...w, step: "thirdOutType", thirdBase: base } : w))}
          onChangeThirdType={(outType) => setDpWizard((w) => (w ? { ...w, step: "thirdOutFielding", thirdOutType: outType } : w))}
          onThirdFielding={(f) => {
            if (!dpWizard.base || !dpWizard.firstFielding || !dpWizard.secondFielding) return;
            if (!dpWizard.thirdBase || !dpWizard.thirdOutType) return;
            const runner = state.runners[dpWizard.base];
            const thirdRunner = state.runners[dpWizard.thirdBase];
            if (!runner || !thirdRunner) return;
            void handleConfirmDoublePlay({
              base: dpWizard.base,
              runner,
              outType: dpWizard.outType,
              batterFielding: dpWizard.firstFielding,
              secondFielding: dpWizard.secondFielding,
              thirdOut: { base: dpWizard.thirdBase, runner: thirdRunner, outType: dpWizard.thirdOutType, fielding: f },
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
              {players.map((p) => {
                // Fix 6: same no-re-entry rule as the Substitution panel --
                // a player already substituted out of this game can't come
                // back in to pitch either. Not hidden, just disabled with a
                // reason, so the operator can see why they're missing
                // rather than assuming a roster bug.
                const usedOut = substitutedOutIds.has(p.id);
                return (
                  <button
                    key={p.id}
                    disabled={usedOut}
                    onClick={() => {
                      dispatch({ type: "SET_PITCHER", playerId: p.id });
                      void syncGameState(game.id, { current_pitcher_id: p.id, pitch_count_for_current_pitcher: 0 });
                      setPitcherPickerOpen(false);
                    }}
                    className="rounded-md border border-border px-3 py-2 text-left text-sm text-white hover:border-accent-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border"
                  >
                    #{p.jersey_number ?? "—"} {p.name}
                    {usedOut ? <span className="ml-2 text-[11px] text-accent-red">(already used this game)</span> : null}
                  </button>
                );
              })}
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
          activePlayerIds={activePlayerIds}
          substitutedOutIds={substitutedOutIds}
          onClose={() => dispatch({ type: "SET_PANEL", panel: "substitution", open: false })}
          onConfirm={handleSubstitutionConfirm}
        />
      )}

      {state.endGameConfirmOpen && (
        <ConfirmDialog
          title="End game?"
          message={
            // Fix 10 (baseball-logic-fixes batch, minor tier): flag ending
            // mid-inning -- state.outs is always < 3 while play is live
            // (3 outs triggers the blocking ThreeOutsModal instead, which
            // the operator must clear via its own "End Inning" before
            // reaching this dialog at all), so this only ever fires for a
            // genuine "ending before the half-inning is over" case.
            state.outs < 3
              ? `Warning: only ${state.outs} out${state.outs === 1 ? "" : "s"} recorded this half-inning — ending now leaves it incomplete. This will move to the post-game summary. You can still review before final submit.`
              : "This will move to the post-game summary. You can still review before final submit."
          }
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

      {/* Pitching-mode reactions batch: held back for up to 1.5s by
          inningEndCelebrating so the "INNING OVER" toast/burst plays
          first, per spec ("...THEN the inning-end modal appears on
          top"). Outside that window (hitting mode's own 3rd out, or once
          the celebration timer clears) this is unchanged -- appears the
          instant outs hits 3. */}
      {state.outs >= 3 && !inningEndCelebrating && (
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
// BATTER_IMAGE_VERTICAL_OFFSET_PX shifts the batter image so the green
// zone's top/bottom line up with elbow/knee height. Measured directly off
// /batter-right.png (mirror-identical to -left.png) with the Read tool:
// elbow sits at ~30% of the image's own height from the top, knees at
// ~60%. At a representative render size (image/row height ~600px, zone
// at its max ~280x330 -> 250px-tall green interior after the ring's
// insets), that puts the green zone's own top/bottom at ~29%/~71% of the
// image height -- i.e. the zone (250px) is taller than the actual
// elbow-to-knee span in the artwork (~0.30 of 600px = 180px) by close to
// 70px. **A pure vertical translate cannot satisfy both edges at once**
// when the two spans are different lengths -- shifting to fix the top
// necessarily throws off the bottom by the same amount, and vice versa.
// 30px (shifting the art down) is the midpoint compromise: it splits the
// ~76px of unavoidable mismatch roughly evenly between the two edges
// rather than perfectly satisfying one while leaving the other far off.
// This is tuned to that one reference size, same caveat as every other
// "approximately Npx" constant in this file -- revisit by eye in an
// actual browser once real device sizes are known, not by rederiving the
// math again.
const BATTER_IMAGE_VERTICAL_OFFSET_PX = 30;

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
// plus a further fixed overlap so the visible art overlaps the zone,
// per spec. Sign flips with which side the image is on: the R image
// needs to move left (negative), the L image right (positive). The
// overlap itself was 10px, then doubled to 20px in a follow-up request
// ("the same delta again") to bring it in closer still.
const BATTER_IMAGE_INNER_MARGIN_PCT = 11.5;
const BATTER_IMAGE_OVERLAP_PX = 20;

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
    // Fix 2 (six-fixes batch): the glow (batter-glow-selected, a filter:
    // drop-shadow) was already scoped to just the <img> below, not this
    // wrapper -- and this div never had overflow-hidden either, so there
    // was nothing here actually clipping or widening it. overflow-visible
    // is added anyway, explicitly, per spec, so nothing upstream can
    // silently reintroduce clipping by changing this div's classes later
    // without noticing it once carried this requirement.
    <div className="relative h-full shrink-0 overflow-visible" style={{ opacity: selected ? 1 : 0.5 }}>
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
  onPick: (outcome: PitchOutcome, swing: boolean, isBunt?: boolean) => void;
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
        {/* Fix 3 (baseball-logic-fixes batch): a caught foul tip -- contact
            is possible on any pitch the batter reaches for, in or out of
            the zone, so this is unconditional like Foul/Strike Swinging/In
            Play, not gated by isBallZone the way Strike Looking/Ball are. */}
        <PopupButton label="Foul Tip" color={OUTCOME_COLOR.foul_tip} onClick={() => onPick("foul_tip", true)} />
        {/* Fix 4 (baseball-logic-fixes batch): logged as a plain "foul"
            pitch (same outcome value, no schema change) -- the isBunt flag
            only changes what operator-console.tsx's handler does next
            (auto-strikeout if this is strike 3), it never reaches the DB. */}
        <PopupButton label="Foul Bunt" color={OUTCOME_COLOR.foul} onClick={() => onPick("foul", true, true)} />
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

// Addition 1 (two-additions batch): one runner at a time from
// sacFlyQueue, top base first. "Advanced to [next base]" is omitted for
// a runner on third -- there's no base beyond third to advance to
// without scoring, so only Scored/Held/Out-left-early make sense there.
function SacFlyPanel({
  base,
  runner,
  onDecide,
}: {
  base: Base;
  runner: RunnerState;
  onDecide: (decision: "scored" | "advance" | "held" | "out_early") => void;
}) {
  const nextBase = NEXT_BASE[base];
  return (
    <div className="glossy w-full max-w-[320px] rounded-lg border border-accent-amber/50 bg-accent-amber/10 p-3">
      <p className="text-xs text-accent-amber">
        {runner.name} was on {base} when the ball was caught -- did they advance?
      </p>
      <div className="mt-2 flex flex-col gap-1.5">
        <button
          onClick={() => onDecide("scored")}
          className="min-h-[44px] rounded-md border border-accent-green/60 px-3 text-left text-sm font-medium text-white hover:bg-accent-green/20"
        >
          Scored — RBI (sacrifice fly)
        </button>
        {nextBase && (
          <button
            onClick={() => onDecide("advance")}
            className="min-h-[44px] rounded-md border border-border px-3 text-left text-sm font-medium text-white hover:border-accent-primary"
          >
            Advanced to {nextBase}
          </button>
        )}
        <button
          onClick={() => onDecide("held")}
          className="min-h-[44px] rounded-md border border-border px-3 text-left text-sm font-medium text-white hover:border-accent-primary"
        >
          Held at {base}
        </button>
        <button
          onClick={() => onDecide("out_early")}
          className="min-h-[44px] rounded-md border border-accent-red/60 px-3 text-left text-sm font-medium text-white hover:bg-accent-red/20"
        >
          Out — left early (tag-up violation)
        </button>
      </div>
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
  onThirdOutAsk,
  onChangeThirdBase,
  onChangeThirdType,
  onThirdFielding,
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
  // Fix 8 (baseball-logic-fixes batch, minor tier): the four new steps
  // that generalize this wizard to a triple play -- unused/no-ops for a
  // regular double play, which never leaves the original four steps.
  onThirdOutAsk: (hasThirdOut: boolean) => void;
  onChangeThirdBase: (base: Base) => void;
  onChangeThirdType: (t: OutType) => void;
  onThirdFielding: (f: ResolvedFielder) => void;
  onCancel: () => void;
}) {
  const occupied = (["first", "second", "third"] as Base[]).filter((b) => runners[b]);
  // The runner already picked for the second out can't also be the third.
  const occupiedForThird = occupied.filter((b) => b !== wizard.base);
  const title = wizard.step.startsWith("thirdOut") ? "Triple Play" : "Double Play";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-5">
        <h3 className="font-heading text-lg font-bold text-white">{title}</h3>

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

        {wizard.step === "thirdOutAsk" && (
          <>
            <p className="mt-2 text-sm text-foreground/60">Was there a third out? (Triple Play)</p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => onThirdOutAsk(true)}
                className="min-h-[48px] flex-1 rounded-md bg-accent-primary px-3 text-sm font-semibold text-white"
              >
                Yes
              </button>
              <button
                onClick={() => onThirdOutAsk(false)}
                className="min-h-[48px] flex-1 rounded-md border border-border px-3 text-sm font-medium text-foreground/70"
              >
                No — confirm double play
              </button>
            </div>
          </>
        )}

        {wizard.step === "thirdOutRunner" && (
          <>
            <p className="mt-2 text-sm text-foreground/60">Which runner was the third out?</p>
            <div className="mt-3 flex flex-col gap-2">
              {occupiedForThird.map((b) => (
                <button
                  key={b}
                  onClick={() => onChangeThirdBase(b)}
                  className="rounded-md border border-border px-3 py-2 text-left text-sm text-white hover:border-accent-primary"
                >
                  {runners[b]?.name} ({b})
                </button>
              ))}
              {occupiedForThird.length === 0 && <p className="text-sm text-foreground/40">No other runners on base.</p>}
            </div>
          </>
        )}

        {wizard.step === "thirdOutType" && (
          <>
            <p className="mt-2 text-sm text-foreground/60">Force out or tag out (the third runner)?</p>
            <div className="mt-3 flex gap-2">
              {(["force", "tag"] as OutType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => onChangeThirdType(t)}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm capitalize ${
                    wizard.thirdOutType === t ? "border-accent-primary bg-accent-primary text-white" : "border-border text-foreground/70"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </>
        )}

        {wizard.step === "thirdOutFielding" && (
          <div className="mt-2">
            <FieldingPositionPicker title="Third out — who fielded it?" onSelect={onThirdFielding} resolve={resolve} />
          </div>
        )}

        <button onClick={onCancel} className="mt-4 w-full text-xs text-foreground/50">
          Cancel
        </button>
      </div>
    </div>
  );
}
