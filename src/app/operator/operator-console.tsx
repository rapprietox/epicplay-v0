"use client";

import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type {
  AtBatMode,
  AtBatResult,
  BattingHand,
  Database,
  FieldCalibrationPoints,
  FieldingPosition,
  GameEventType,
  HitType,
  InningHalf,
  PitchOutcome,
  PitchType,
  PlayerPositionCalibration,
  RunnerState,
  Runners,
} from "@/lib/supabase/types";
import {
  FIELDER_NUMBER_TO_POSITION,
  FIELDING_POSITION_TO_NUMBER,
  OUT_BASE_LABELS,
  computeGroundBallNotation,
  getFieldZone,
  notationForSingleFielderPlay,
  standardCoveringFielder,
  zoneForPoint,
  type FieldZone,
  type OutBase,
} from "@/lib/field-zones";
import { operatorReducer, UNDO_WINDOW_MS } from "@/lib/operator/reducer";
import { advanceAllRunnersOneBase, advanceOneRunner, isForced, suggestRunnerAdvance } from "@/lib/operator/runner-advance";
import { resolveBattedBallPlay, resolveGroundBallWithRunners } from "@/lib/operator/runner-outcomes";
import { resolveFielder, type ResolvedFielder } from "@/lib/operator/fielding";
import {
  RESULT_IS_OUT,
  RESULT_LABELS,
  BUNT_RESULT_LABELS,
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
  type OperatorState,
  type RunnerQuickAction,
  type ScoredRunner,
  type ScoreMethod,
} from "@/lib/operator/types";
import { atBatAccuracyRatio, runningAccuracy } from "@/lib/pitch-accuracy";
import { resolveGameRules, formatElapsed, checkInningEndBanner, type InningEndBanner } from "@/lib/game-rules";
import { formatAvg, type BattingLine } from "@/lib/stats";
import { loadOperatorStateLocal, saveOperatorStateLocal, clearOperatorStateLocal } from "@/lib/operator/local-storage";
import { nextBattingOrderPosition } from "@/lib/operator/batting-order";
import { withOfflineRetry, onQueueChange, pendingCount } from "@/lib/operator/sync-queue";
import { GAME_NOT_ACTIVE_ERROR } from "@/lib/operator/chain-substitution";
import { buildInitialStateFromServer } from "./initial-state";
import {
  adjustScore,
  confirmAtBat,
  confirmChainSubstitution,
  confirmDoublePlay,
  confirmIntentionalWalk,
  getLineupForGame,
  incrementAtBatRbi,
  logGameEvent,
  logPitch,
  logExtraOut,
  logQuickAtBat,
  logStolenBase,
  markLateArrival,
  setSacrificeType,
  startDraftAtBat,
  syncGameState,
  undoAtBat,
} from "./actions";
import { StrikeZoneGrid, OUTCOME_COLOR, classifyZone } from "./strike-zone-grid";
import { QuickModeGrid, MobileQuickModeGrid, type QuickModeButtonDef } from "./quick-mode-grid";
import { KairosVoiceButton } from "./kairos-voice-button";
import { FieldDiagram } from "./field-diagram";
import { BaserunnerDiamond } from "./baserunner-diamond";
import { Scoreboard } from "./scoreboard";
import { ConfettiBurst, Fireworks, InningEndBurst } from "./celebration";
import { LateArrivalPanel } from "./substitution-panel";
import { ChainSubstitutionModal, type ChainResult } from "./chain-substitution-modal";
import { PitchCountModal } from "./pitch-count-modal";
import { PostGameSummary } from "./post-game-summary";
import { StadiumBackground } from "@/components/stadium-background";

// Urgent mobile fixes, Fix 5: the only Quick Mode results with no
// landing spot to tap -- a strikeout/walk/HBP never puts the ball in
// play at all.
const NO_FIELD_TAP_RESULTS = new Set<AtBatResult>(["strikeout", "walk", "hbp"]);

type Game = Database["public"]["Tables"]["games"]["Row"];
type Season = Database["public"]["Tables"]["seasons"]["Row"];
type Player = Database["public"]["Tables"]["players"]["Row"];
type Lineup = Database["public"]["Tables"]["lineup"]["Row"];
type GameState = Database["public"]["Tables"]["game_state"]["Row"];
type AtBat = Database["public"]["Tables"]["at_bats"]["Row"];
type Pitch = Database["public"]["Tables"]["pitches"]["Row"];
type OpponentPlayer = Database["public"]["Tables"]["opponent_players"]["Row"];

const PITCH_TYPES: PitchType[] = ["fastball", "curveball", "changeup", "slider", "2seam", "other"];
const SCORE_METHODS: ScoreMethod[] = ["hit", "sac_fly", "forced_walk_hbp", "wild_pitch", "passed_ball", "balk", "error"];

// Quick Mode scorekeeper batch: "Batting 3rd of 9" on the batter card.
function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

// Field-zone-validation batch: 'unknown' deliberately has no entry --
// per spec, an incomplete calibration shows no label and no filtering at
// all, as if this feature weren't there.
const FIELD_ZONE_LABEL: Partial<Record<FieldZone, string>> = {
  foul: "📍 Foul territory",
  infield: "📍 Infield",
  outfield: "📍 Outfield",
  homerun: "📍 Beyond the wall — Home Run?",
};

// Runner-actions consolidation: the reasons behind "Advance", replacing
// the standalone Wild Pitch/Passed Ball/Balk/Error (all-runners) buttons
// and the separate Stolen Base quick action -- see handleAdvanceReason.
type AdvanceReason = "stolen_base" | "wild_pitch" | "passed_ball" | "balk" | "error" | "passed_on_hit" | "obstruction" | "sac_bunt";

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
  fieldCalibration2d,
  fieldPositionsCalibration,
  season,
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
  // Feature 1 (fielding-play logging batch): null when the coach hasn't
  // calibrated the 2D field yet (a real, expected state) -- the
  // auto-suggest UI degrades to a plain, unsuggested fielder picker.
  fieldCalibration2d: FieldCalibrationPoints | null;
  // Feature 2 (lineup-status batch): the "positions" calibration row --
  // same nullable-until-calibrated shape, used to place each defensive
  // position's avatar on the chain substitution diagram.
  fieldPositionsCalibration: PlayerPositionCalibration | null;
  // Feature 2 (game-rules batch): null whenever this game has no
  // season_id (a manual/friendly game) -- resolveGameRules treats that
  // the same as "season has no rules set," i.e. no limits at all.
  season: Season | null;
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
    buildInitialStateFromServer(game, initialGameState, draftAtBat, allGamePitches, opponentPitchCountSeed, lineup)
  );

  // Swapping in a recovered localStorage snapshot happens *after* mount
  // instead, once hydration has already matched the server output --
  // this is what the reducer's HYDRATE action is for.
  //
  // Bug fix (feature/lineup-drafts): a dirty snapshot used to be trusted
  // unconditionally -- found while re-testing the Sac Fly/Sac Bunt
  // visibility fix on the dummy game, right after resetting its data
  // directly in the database (deleting at_bats/game_state outside the
  // app entirely). isVisible and UNDO_LOCAL both turned out correct
  // under direct simulation; the actual cause was this effect blindly
  // hydrating a browser's own leftover snapshot from BEFORE that reset
  // -- runners/outs that were real for the old (now-deleted) at-bats,
  // reapplied on top of a freshly reset game, with Undo then faithfully
  // restoring *that* stale pre-at-bat snapshot. `dirty` is set on nearly
  // every local action and nothing ever clears it mid-session (MARK_SAVED
  // is defined but never dispatched), so without this check ANY snapshot
  // from a previous session -- not just a DB reset, any case where the
  // server's own game_state was recreated since -- would be trusted the
  // same way. getOrCreateGameState stamps a fresh game_started_at only
  // when a game_state row is first created, so comparing against it is a
  // simple, reliable "is this snapshot older than the current game
  // session" check -- a snapshot saved before this fix shipped has
  // savedAt stuck at 0 (see below), which safely always counts as stale
  // rather than being trusted by default.
  useEffect(() => {
    const local = loadOperatorStateLocal(game.id);
    if (!local || !local.dirty) return;
    const gameStartedAtMs = initialGameState.game_started_at ? new Date(initialGameState.game_started_at).getTime() : 0;
    if (local.savedAt < gameStartedAtMs) {
      clearOperatorStateLocal(game.id);
      return;
    }
    dispatch({ type: "HYDRATE", state: local });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id]);

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const t = setInterval(() => saveOperatorStateLocal({ ...stateRef.current, savedAt: Date.now() }), 5000);
    return () => clearInterval(t);
  }, []);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  // Feature 2 (game-rules batch): shown right after End Inning, never
  // auto-clears (the operator dismisses it) -- a fresh End Inning tap
  // just replaces whatever was showing, matching autoScoreBanners'
  // "latest wins" spirit without needing a stacked list here.
  const [inningEndBanner, setInningEndBanner] = useState<InningEndBanner | null>(null);
  const [pendingSync, setPendingSync] = useState(0);
  useEffect(() => onQueueChange(setPendingSync), []);
  useEffect(() => setPendingSync(pendingCount()), []);

  const [banner, setBanner] = useState<string | null>(null);
  // Urgent mobile fixes, Fix 5: staged while the field-tap overlay is
  // open -- cleared either by a real tap (resolveQuickFieldTap) or Skip
  // (skipQuickFieldTap), both of which then actually call handleQuickPick.
  const [pendingFieldTapPick, setPendingFieldTapPick] = useState<QuickModeButtonDef | null>(null);
  const [runnerPicker, setRunnerPicker] = useState<Base | null>(null);
  const [runnerActionMenu, setRunnerActionMenu] = useState<Base | null>(null);
  // Urgent mobile fixes, Fix 4: captured at tap time so the menu can be
  // portaled and anchored near the real tap point instead of centered
  // in the right panel, where it was overflowing small phone screens.
  const [runnerActionAnchor, setRunnerActionAnchor] = useState<{ clientX: number; clientY: number; topHalf: boolean; leftHalf: boolean } | null>(
    null
  );
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
  // Feature 1 (lineup-status batch): same optimistic-local-first pattern
  // as substitutionLog above -- lineup itself is a static server-fetched
  // prop, so a player just marked "Add to Reserve" needs a local override
  // to disappear from the Late Arrival list immediately rather than
  // waiting on a reload/revalidation.
  const [lateArrivalIds, setLateArrivalIds] = useState<Set<string>>(new Set());
  // Feature 2 (lineup-status batch): a local, optimistically-updated
  // mirror of the `lineup` prop -- needed because chain substitutions can
  // now change a player's `position` (and, for the in/out pair, their
  // `status`/`batting_order`) mid-game, which the old simple substitution
  // flow never did (same position in, same position out). Every internal
  // read of "who's playing where" below uses this instead of the raw
  // prop so a chain's effects show up immediately, the same
  // optimistic-local-first pattern as substitutionLog/lateArrivalIds.
  const [liveLineup, setLiveLineup] = useState<Lineup[]>(lineup);
  // Loud-substitutions batch: liveLineup/substitutionLog no longer
  // update optimistically the instant a chain resolves -- they wait for
  // confirmChainSubstitution to actually succeed (see
  // runChainSubstitution below). These two track that in-between state:
  // pendingChainSubIds names the rows the lineup strip should show as
  // "Saving…" while the request is in flight (the outgoing player and
  // anyone else whose position is changing -- the incoming player has
  // no visible row to mark pending, since they don't appear in the
  // batting-order strip until the swap actually lands); chainSubError
  // is the one active failure banner, if any (null the rest of the
  // time), carrying its own retry closure when the failure is one a
  // retry could plausibly fix.
  const [pendingChainSubIds, setPendingChainSubIds] = useState<Set<string>>(new Set());
  const [chainSubError, setChainSubError] = useState<{ message: string; retryable: boolean; retry: () => void } | null>(null);
  // Feature 2 (lineup-status batch): the chain-substitution modal opens
  // via the existing SET_PANEL "substitution" reducer action (renamed in
  // spirit, not in code, from the old dropdown-based panel it replaces);
  // Late Arrival is now a separate, standalone modal (it used to be a
  // second internal view of the same panel component) since the two
  // substitution UIs no longer share one component.
  const [lateArrivalOpen, setLateArrivalOpen] = useState(false);
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
  // Feature 1 (fielding-play logging batch): the ground-ball out flow,
  // steps 2-3 (Step 1 -- "who fielded it" -- reuses the existing
  // pendingFielding/SET_FIELDING plumbing, just with a zone-derived
  // suggestion now). Only entered for hitType groundball/bunt with a
  // plain groundout result -- flyouts/lineouts/errors never need a base
  // tap, the catch/error itself is the whole play. fix/dp-fc: there is
  // no "secondOutAsk" step any more -- a second (or third) out on this
  // same play is now always decided by the per-runner outcome queue
  // that follows every confirmed groundout/flyout/lineout, never by a
  // dedicated yes/no question handed off to a separate wizard.
  const [groundOutSubStep, setGroundOutSubStep] = useState<"location" | "confirmFielder" | null>(null);
  const [groundOutInitialFielder, setGroundOutInitialFielder] = useState<ResolvedFielder | null>(null);
  const [groundOutBatterFielder, setGroundOutBatterFielder] = useState<ResolvedFielder | null>(null);
  const [groundOutPendingBase, setGroundOutPendingBase] = useState<OutBase | null>(null);
  // Precomputed the moment enough information exists (a plain groundout
  // needs nothing further once Step 2 resolves; a flyout/lineout/error
  // needs nothing beyond Step 1) -- handleConfirm reads this directly
  // rather than recomputing, so it doesn't need to know which path built it.
  const [pendingNotation, setPendingNotation] = useState<string | null>(null);
  const [pitcherPickerOpen, setPitcherPickerOpen] = useState(false);
  const [opponentPitcherPickerOpen, setOpponentPitcherPickerOpen] = useState(false);
  // Fix 2: two-step pickoff wizard (pick the base, then the result) opened
  // from the quick-actions panel -- separate from the existing per-base
  // "Picked Off" runner quick-action (tap an occupied base -> its menu),
  // which stays as the quick single-tap path and still doesn't log a
  // game_events row (see CLAUDE.md). This one always does, and adds the
  // "attempted, runner safe" outcome that quick-action never had.
  const [pickoffWizard, setPickoffWizard] = useState<{ step: "base" | "result"; base?: Base } | null>(null);
  // Sacrifice-rules batch, extended by fix/dp-fc: shown after a
  // confirmed Ground Out/Fly Out/Line Out/Foul Out OR a bunt out at
  // first, with runners on base and outs below 2 -- asks what happened
  // to each runner on the play, top base first (queue order: third,
  // second, first). "fly"/"bunt" still decide the existing sac-fly/
  // sac-bunt rule exactly as before; "ground" is new (fix/dp-fc) and
  // never produces a sacrifice -- its only job is feeding
  // resolveBattedBallPlay (src/lib/operator/runner-outcomes.ts) so a
  // second or third "Out" decision relabels the play as a double/triple
  // play. See maybeStartRunnerOutcomeQueue (the single trigger, called
  // from both handleConfirm and handleQuickPick) and
  // handleRunnerOutcomeDecision/finalizeRunnerOutcomeQueue below.
  // Cleared automatically once the queue drains or the next batter's
  // first pitch starts a new draft at-bat.
  //
  // Implicit-FC batch: "groundSafe" is a FOURTH kind, started by
  // beginImplicitFcFlow once the operator answers "Safe" to "Was the
  // batter put out?" -- unlike the other three, the batter's own at-bat
  // row may not exist yet when this queue starts (Quick Mode has no
  // draft row at all), so runnerOutcomeAtBatId is allowed to be null for
  // this one kind (see the drain effect below); finalizeRunnerOutcomeQueue
  // creates/updates whatever row is needed once the full picture is known.
  type RunnerOutcomeKind = "fly" | "bunt" | "ground" | "groundSafe";
  const [runnerOutcomeQueue, setRunnerOutcomeQueue] = useState<Base[]>([]);
  const [runnerOutcomeKind, setRunnerOutcomeKind] = useState<RunnerOutcomeKind | null>(null);
  const [runnerOutcomeAtBatId, setRunnerOutcomeAtBatId] = useState<string | null>(null);
  // fix/dp-fc: outs recorded in the half-inning BEFORE this play's own
  // batter-out -- captured at trigger time (maybeStartRunnerOutcomeQueue
  // already requires this to be < 2) so finalizeRunnerOutcomeQueue can
  // tell whether an extra "Out" decision brings the half-inning to 3.
  const [runnerOutcomeOutsBeforePlay, setRunnerOutcomeOutsBeforePlay] = useState(0);
  // Implicit-FC batch: only meaningful for kind "groundSafe" -- the hit
  // type (groundball/bunt) the play started as, needed at finalize time
  // to persist the right hitType on the batter's own at_bats row. Full
  // Mode could read state.pendingHitType directly instead, but Quick
  // Mode has no such state (its hitType always comes from the tapped
  // button), so this is captured once at queue-start for both.
  const [runnerOutcomeHitType, setRunnerOutcomeHitType] = useState<HitType | null>(null);
  // Implicit-FC batch: only meaningful for kind "groundSafe" -- a
  // snapshot of `runners` taken when the queue started, so finalize can
  // revert every local SET_RUNNER/advance the operator made while
  // answering if the final decision turns out to be "record nothing"
  // (batter safe, nobody out -- see resolveGroundBallWithRunners).
  const [runnerOutcomeRunnersBeforePlay, setRunnerOutcomeRunnersBeforePlay] = useState<Runners | null>(null);
  // fix/dp-fc: every decision is collected here, not applied immediately
  // -- the DB-side effects (score bump + RBI + game_events for a scored
  // runner, a real extra at_bats row for an out) only ever fire once the
  // whole queue drains and the FINAL out count for the play is known.
  // That's what lets the third-out rule ("a run only counts if the out
  // that ended the inning wasn't a force") apply correctly regardless of
  // which base was asked about first -- nothing is scored, then
  // un-scored; it's decided once, with the full picture. `runners` in
  // local state still updates immediately per decision (removed either
  // way) so the diamond stays responsive while the queue is still open.
  const [runnerOutcomeOutBases, setRunnerOutcomeOutBases] = useState<{ base: Base; runner: RunnerState }[]>([]);
  const [runnerOutcomeScoredBases, setRunnerOutcomeScoredBases] = useState<{ base: Base; runner: RunnerState }[]>([]);
  // "bunt" sacrifice iff at least one runner advanced/scored AND nobody
  // was put out -- still needs "did anything move" separately from "did
  // anything score," since a scoreless-but-advanced bunt can still be a
  // sac bunt.
  const [runnerOutcomeAnyMoved, setRunnerOutcomeAnyMoved] = useState(false);
  // Bug fix (feature/lineup-drafts): whether the most recently confirmed
  // Quick Mode play was a bunted groundout -- plain UI state, not
  // threaded through the shared reducer. Drives AdvanceReasonMenu's own
  // "Sac Bunt" option (see ADVANCE_REASONS below): offering it as a
  // manual-advance reason only right after an actual bunt is what "the
  // right reasons for the play" means here -- showing it permanently
  // alongside Stolen Base/Wild Pitch/etc. regardless of what just
  // happened would be the same kind of clutter this fix is otherwise
  // trying to cut down on.
  const [lastQuickPickWasSacBunt, setLastQuickPickWasSacBunt] = useState(false);
  // Sacrifice-rules batch: the new standalone Quick Mode "Bunt" button
  // asks how the play ended before anything is logged -- see onBunt/
  // handleBuntOutcome and BuntOutcomePrompt below.
  const [buntOutcomePrompt, setBuntOutcomePrompt] = useState(false);
  // Quick Mode scorekeeper batch: "which runner" picker for Stolen Base
  // as a direct button rather than going through the per-runner action
  // menu. Mirrors the runnerPicker/runnerActionMenu pattern already used
  // elsewhere rather than inventing a new shape. fix/dp-fc: the
  // "doublePlay" variant is gone -- Quick Mode double plays are now
  // derived the same way Full Mode's are, via the per-runner outcome
  // queue after a confirmed Ground Out, not a dedicated base picker.
  const [quickRunnerPrompt, setQuickRunnerPrompt] = useState<"stolenBase" | null>(null);
  // Implicit-FC batch: "Was the batter put out?" -- the new preliminary
  // question asked whenever a plain Ground Out (or a bunt's "Out at
  // First"/"Safe") is picked with a runner on base and outs below 2,
  // before anything is dispatched or persisted. "Out at First" just
  // continues exactly what used to happen unconditionally (see
  // finishPickResult / proceedQuickGroundOutAsOut); "Safe" opens the
  // per-runner queue (kind "groundSafe") that derives a fielder's choice.
  // groundOutQuickPendingDef carries the originating Quick Mode button
  // (null in Full Mode, which has no equivalent -- state.pendingHitType
  // already has everything Full Mode needs) across the question.
  const [groundOutBatterPromptOpen, setGroundOutBatterPromptOpen] = useState(false);
  const [groundOutQuickPendingDef, setGroundOutQuickPendingDef] = useState<QuickModeButtonDef | null>(null);
  // Implicit-FC batch: replaces the old single fcOutRunner -- the
  // per-runner queue can mark up to 2 runners "Out" even with the batter
  // safe (same two-extra-outs ceiling confirmDoublePlay already supports
  // for a triple play), each becoming its own logExtraOut row merged
  // into the same lastConfirmed via APPEND_EXTRA_OUT. Captured here
  // (Full Mode only -- Quick Mode's groundSafe finalize persists
  // directly, never going through handleConfirm) since the runners are
  // already removed from state.runners by the time Confirm At-Bat runs.
  const [fcOutRunners, setFcOutRunners] = useState<RunnerState[]>([]);
  // Quick Mode scorekeeper batch: which batting-order slots have already
  // batted this half-inning, for the lineup strip's "completed" marker --
  // derived locally from battingOrderPosition transitions (there's no
  // server-side "who's batted this inning" signal to read), reset on
  // every inning/half change. An Undo that goes back to a previous batter
  // won't retroactively un-mark them here until the next inning change --
  // a minor, documented display-only edge case.
  const [battedThisHalfInning, setBattedThisHalfInning] = useState<Set<number>>(new Set());
  const [lineupStripCollapsed, setLineupStripCollapsed] = useState(false);
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
  // Bug fix: an opposing batter with no name typed (the free-text
  // "Opposing batter…" field, see opponent-batters datalist above) fell
  // back to the literal string "Batter" -- fine for one runner, but with
  // two nameless opponents on base at once (e.g. a walk following an
  // earlier un-named single) both dots on the diamond read "•Batter,"
  // indistinguishable. This ref counts up across the whole game, every
  // time currentBatterRunner() actually resolves a nameless opponent
  // batter (its five one-shot handler call sites -- pickResult, the
  // hit-runner-confirm drain effect, handleIntentionalWalk,
  // handleQuickPick, handleQuickDoublePlay -- each fires exactly once per
  // real batter), so each nameless opponent gets its own "Opp #N" instead
  // of colliding on one shared label. Deliberately NOT consumed by the
  // IBB confirm dialog's own preview text (see ibbConfirmOpen below),
  // which is a render-time JSX read that would otherwise burn through
  // numbers on every re-render while the dialog stays open.
  const opponentBatterSeqRef = useRef(0);

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

  // Quick Mode scorekeeper batch: lineup strip "completed" tracking (see
  // battedThisHalfInning's own comment above). Marks the *previous*
  // batting-order slot done the instant the order advances past it.
  const prevBattingOrderRef = useRef<number | null>(null);
  useEffect(() => {
    if (state.mode === "hitting" && prevBattingOrderRef.current !== null && prevBattingOrderRef.current !== state.battingOrderPosition) {
      const finished = prevBattingOrderRef.current;
      setBattedThisHalfInning((s) => (s.has(finished) ? s : new Set(s).add(finished)));
    }
    prevBattingOrderRef.current = state.battingOrderPosition;
  }, [state.battingOrderPosition, state.mode]);
  useEffect(() => {
    setBattedThisHalfInning(new Set());
  }, [state.inning, state.inningHalf]);

  useEffect(() => {
    if (state.currentAtBatId) {
      setRunnerOutcomeQueue([]);
      setRunnerOutcomeKind(null);
      setRunnerOutcomeAtBatId(null);
      setBuntOutcomePrompt(false);
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
    // Feature 1 (fielding-play logging batch): same reasoning -- a
    // ground-out flow left mid-resolution (operator abandoned it, or it
    // already finished and confirmed) shouldn't leak into the next batter.
    setGroundOutSubStep(null);
    setGroundOutInitialFielder(null);
    setGroundOutBatterFielder(null);
    setGroundOutPendingBase(null);
    setPendingNotation(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.currentAtBatId]);

  // Bug fix (feature/lineup-drafts): self-corrects a game already stuck
  // in the wrong mode for its current inning_half -- the exact state
  // this fix found a real test game in (home team batting the top
  // half). Runs on mount (covers a reload of an already-wrong game) and
  // every inning_half change thereafter, as a second line of defense
  // alongside confirmEndInning's own explicit SET_MODE dispatch. Synced
  // to the server too, not just the local reducer, so a reload doesn't
  // pull the wrong mode straight back down from game_state.
  useEffect(() => {
    const correct = correctModeForHalf(state.inningHalf);
    if (state.mode === correct) return;
    dispatch({ type: "SET_MODE", mode: correct });
    void withOfflineRetry(`mode-autocorrect-${game.id}-${Date.now()}`, () => syncGameState(game.id, { mode: correct }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.inningHalf, game.home_away]);

  // Pitcher auto-default, the general-purpose catch-all: covers both "the
  // game starts in pitching mode" (a home game's very first half-inning,
  // before confirmEndInning's own default ever gets a chance to run) and
  // "the page loads/reloads with no pitcher set while already in pitching
  // mode" (a stale snapshot, a different device, or game_state predating
  // this feature) -- any case where mode is pitching and currentPitcherId
  // is still null, regardless of how that state was reached. Runs on
  // mount and whenever mode/currentPitcherId/the lineup change, so it
  // also catches a reload that lands mid-inning with no pitcher. A no-op
  // once a pitcher is set, from here or anywhere else (confirmEndInning,
  // the Pitcher Picker, or the substitution default in handleChainResolved).
  useEffect(() => {
    if (state.mode !== "pitching" || state.currentPitcherId) return;
    const defaultPitcher = liveLineup.find((l) => l.status === "starting" && l.position === "P");
    if (!defaultPitcher) return;
    dispatch({ type: "SET_PITCHER", playerId: defaultPitcher.player_id });
    void withOfflineRetry(`pitcher-autodefault-${game.id}-${Date.now()}`, () =>
      syncGameState(game.id, { current_pitcher_id: defaultPitcher.player_id, pitch_count_for_current_pitcher: 0 })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.mode, state.currentPitcherId, liveLineup]);

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

  // Feature 1 (lineup-status batch): the Late Arrival panel's own list --
  // anyone still marked absent in lineup, minus anyone this session has
  // already checked in (lateArrivalIds, regardless of which option was
  // picked -- "Out of Game" still removes them from this specific list
  // for the rest of the session, since re-opening the same prompt for an
  // already-resolved check-in wouldn't do anything new).
  const absentPlayerIds = useMemo(
    () => new Set(liveLineup.filter((l) => l.status === "absent" && !lateArrivalIds.has(l.player_id)).map((l) => l.player_id)),
    [liveLineup, lateArrivalIds]
  );
  const absentPlayers = useMemo(
    () => players.filter((p) => absentPlayerIds.has(p.id)),
    [players, absentPlayerIds]
  );

  // Feature 2 (game-rules batch): resolved once per game/season pair --
  // neither changes mid-game, so this doesn't need to be in the reducer.
  const gameRules = useMemo(() => resolveGameRules(game, season), [game, season]);
  // Elapsed/remaining time reuses the existing 250ms `now` ticker (the
  // same one driving the 30s Undo countdown) rather than a second
  // interval. game_started_at is null only in the split-second before
  // getOrCreateGameState's insert lands -- initialGameState is always
  // already-created by the time this component renders, so this is
  // effectively never null in practice, but the type is honest about it.
  const elapsedMs = initialGameState.game_started_at ? now - new Date(initialGameState.game_started_at).getTime() : 0;
  const remainingMs = gameRules.timeLimitMinutes !== null ? gameRules.timeLimitMinutes * 60_000 - elapsedMs : null;

  // Feature 2 (lineup-status batch): "who's at each defensive position
  // right now" for the chain substitution diagram, and "who's available
  // on the bench" (reserve or checked-in late arrival, not absent, not
  // currently on the field) to drag from. Both derive from liveLineup so
  // they reflect chain substitutions the instant they resolve.
  const currentDefense = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const l of liveLineup) {
      if (l.status === "starting" && l.position) map[l.position] = l.player_id;
    }
    return map;
  }, [liveLineup]);
  const benchPlayerIds = useMemo(
    () => new Set(liveLineup.filter((l) => l.status === "reserve" || l.status === "late_arrival").map((l) => l.player_id)),
    [liveLineup]
  );

  // Feature 1 (fielding-play logging batch): which fielder position the
  // tapped field spot falls in, per the coach's saved calibration -- null
  // whenever there's no field tap yet or the team hasn't calibrated the
  // 2D field, both real states the fielder-suggestion UI needs to degrade
  // gracefully for (falls back to a plain, unsuggested picker).
  const suggestedFielderPosition = useMemo(() => {
    if (!state.fieldTap || !fieldCalibration2d) return null;
    return FIELDER_NUMBER_TO_POSITION[zoneForPoint(state.fieldTap.x, state.fieldTap.y, fieldCalibration2d)];
  }, [state.fieldTap, fieldCalibration2d]);

  // Field-zone-validation batch: 'unknown' both when there's no tap yet
  // and when the team hasn't calibrated the 4 newer optional points
  // (getFieldZone itself returns 'unknown' for that second case) -- both
  // degrade the same way, "no filtering, show all options as normal,"
  // per spec.
  const fieldZone: FieldZone = useMemo(() => {
    if (!state.fieldTap || !fieldCalibration2d) return "unknown";
    return getFieldZone(state.fieldTap.x, state.fieldTap.y, fieldCalibration2d);
  }, [state.fieldTap, fieldCalibration2d]);

  const battingPlayer = useMemo(
    () => (state.mode === "hitting" ? liveLineup.find((l) => l.batting_order === state.battingOrderPosition) : undefined),
    [liveLineup, state.mode, state.battingOrderPosition]
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

  // Opponent pitcher intelligence batch: the operator-set/corrected
  // opposing pitcher (SET_OPPONENT_PITCHER), distinct from
  // opponentPitcherInfo's static roster-position guess above -- this is
  // the one actually persisted onto at_bats.opponent_pitcher_id, so
  // scouting data can be attributed to a real, specific opposing player
  // rather than assumed from their photo-import position tag.
  const currentOpponentPitcher = useMemo(
    () => opponentPlayers.find((p) => p.id === state.currentOpponentPitcherId),
    [opponentPlayers, state.currentOpponentPitcherId]
  );

  // Fix 7 (six-fixes batch, appended after): "on deck" is just the next
  // slot in the batting order, wrapping from the last position back to
  // the first. Fix (batting-order gap bug): now shares
  // nextBattingOrderPosition with the reducer's own advancement instead
  // of a second, hand-rolled copy of the same gap-aware logic -- the two
  // disagreeing (this one silently fell back to the *first* real slot
  // whenever state.battingOrderPosition itself wasn't a real slot, which
  // used to happen whenever the reducer's old, gap-unaware arithmetic
  // landed on a vacated batting_order number) was the exact bug where
  // the on-deck panel kept showing the player who had just batted.
  const onDeckPlayerInfo = useMemo(() => {
    if (state.mode !== "hitting" || liveLineup.length === 0) return undefined;
    // Feature 1 (lineup-status batch): lineup now also holds reserve/
    // absent rows with no batting order at all -- only rows actually in
    // the batting order belong in this rotation.
    const occupiedSlots = liveLineup.map((l) => l.batting_order).filter((n): n is number => n !== null);
    const nextPos = nextBattingOrderPosition(occupiedSlots, state.battingOrderPosition);
    const onDeckSlot = liveLineup.find((l) => l.batting_order === nextPos);
    return onDeckSlot ? players.find((p) => p.id === onDeckSlot.player_id) : undefined;
  }, [liveLineup, players, state.mode, state.battingOrderPosition]);

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
    if (state.opponentBatterName) return { type: "opponent", id: null, name: state.opponentBatterName };
    opponentBatterSeqRef.current += 1;
    return { type: "opponent", id: null, name: `Opp #${opponentBatterSeqRef.current}` };
  }

  function syncRunners(next: Runners) {
    void withOfflineRetry(`runners-${game.id}-${Date.now()}`, () => syncGameState(game.id, { runners: next }));
  }

  function resolve(position: FieldingPosition): ResolvedFielder {
    return resolveFielder(position, state.mode, liveLineup, players, opponentPlayers);
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
      opponent_pitcher_id: state.mode === "hitting" ? state.currentOpponentPitcherId : null,
      outs_before: state.outs,
      risp_before: Boolean(state.runners.second || state.runners.third),
    });
    dispatch({ type: "START_DRAFT_LOCAL", atBatId: id });
    return id;
  }

  // KAIROS batch: `voiceOverride` lets a voice-confirmed pitch supply its
  // own pitch type/zone directly, instead of the usual SELECT_PITCH_TYPE/
  // TAP_ZONE dispatches this function otherwise reads from state --
  // dispatching those and then synchronously reading `state` in the same
  // tick would still see the pre-dispatch (stale) values, since a
  // reducer dispatch doesn't update `state` until the next render. Every
  // existing tap-driven call site omits this and is unaffected.
  async function handlePitchOutcome(outcome: PitchOutcome, swing: boolean, voiceOverride?: { pitchType: PitchType | null; zone: { x: number; y: number } }) {
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
    const pitchType = voiceOverride ? voiceOverride.pitchType : state.selectedPitchType;
    const zone = voiceOverride ? voiceOverride.zone : state.selectedZone;

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

  // KAIROS batch, Tool 6: voice-logged pitch -- sets pitch type/zone via
  // the same dispatches a manual tap sequence would, then re-passes them
  // as handlePitchOutcome's voiceOverride so its own synchronous reads
  // don't see stale pre-dispatch state (see that function's own comment).
  function handleVoicePitch(pitch: { pitchType: PitchType | null; outcome: PitchOutcome; swing: boolean | null; zoneX: number; zoneY: number }) {
    if (state.outs >= 3) return;
    dispatch({ type: "SELECT_PITCH_TYPE", pitchType: pitch.pitchType });
    dispatch({ type: "TAP_ZONE", x: pitch.zoneX, y: pitch.zoneY });
    const swing = pitch.swing ?? (pitch.outcome === "ball" || pitch.outcome === "hbp" ? false : true);
    void handlePitchOutcome(pitch.outcome, swing, { pitchType: pitch.pitchType, zone: { x: pitch.zoneX, y: pitch.zoneY } });
  }

  // KAIROS batch, Tool 6: voice-logged finished at-bat result. Ensures a
  // draft exists first (a voice command can be the very first thing
  // said for a new batter, with no prior pitch taps), then sets fielding/
  // hit-type state ahead of pickResult -- from there it's exactly the
  // same suggested-runner-movement flow (including the hit-runner
  // confirm queue) a manual tap through the sequential flow would reach,
  // never bypassed just because the result came in by voice.
  async function handleVoiceAtBatResult(input: { result: AtBatResult; hitType: HitType | null; fieldedByPosition: FieldingPosition | null }) {
    if (state.outs >= 3) return;
    setBanner(null);
    try {
      await ensureDraftAtBat();
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "Could not start at-bat -- check connection and try again");
      return;
    }
    if (input.fieldedByPosition) {
      const fielder = resolve(input.fieldedByPosition);
      dispatch({ type: "SET_FIELDING", position: input.fieldedByPosition, playerId: fielder.playerId, opponentPlayerId: fielder.opponentPlayerId });
    }
    if (input.hitType) dispatch({ type: "SET_HIT_TYPE", hitType: input.hitType });
    pickResult(input.result);
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
  // Implicit-FC batch: a plain Ground Out is no longer automatically "the
  // batter is out" -- with a runner on base and outs below 2, the defense
  // might instead have let the batter reach while retiring a runner (a
  // fielder's choice), so "Was the batter put out?" has to be answered
  // first (see resolveGroundOutBatterPrompt/beginImplicitFcFlow below)
  // before anything is dispatched. Bases empty or 2 outs: nobody to make
  // a choice about, so this falls straight through to finishPickResult,
  // unchanged from before this batch.
  function pickResult(result: AtBatResult, baseRunners: Runners = state.runners) {
    if (result === "groundout" && anyRunnerOnBase() && state.outs < 2) {
      setGroundOutBatterPromptOpen(true);
      return;
    }
    finishPickResult(result, baseRunners);
  }

  function finishPickResult(result: AtBatResult, baseRunners: Runners = state.runners) {
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

  // Implicit-FC batch: resolves "Was the batter put out?" -- "Out at
  // First" just continues exactly what an unconditional Ground Out pick
  // used to do (finishPickResult in Full Mode, or the old unconditional
  // startQuickPick behavior in Quick Mode); "Safe" opens the per-runner
  // queue that derives a fielder's choice (or nothing) from what happens
  // to the runners. wasOut's two branches are symmetric across both
  // modes -- which mode we're in only matters for HOW the eventual
  // result gets persisted (see beginImplicitFcFlow/finalizeRunnerOutcomeQueue).
  function resolveGroundOutBatterPrompt(wasOut: boolean) {
    setGroundOutBatterPromptOpen(false);
    const quickDef = groundOutQuickPendingDef;
    setGroundOutQuickPendingDef(null);
    if (wasOut) {
      if (game.logging_mode === "quick") {
        if (quickDef) proceedQuickGroundOutAsOut(quickDef);
        return;
      }
      finishPickResult("groundout", state.runners);
      return;
    }
    const hitType = game.logging_mode === "quick" ? quickDef?.hitType ?? null : state.pendingHitType;
    beginImplicitFcFlow(hitType);
  }

  // Implicit-FC batch: starts the per-runner Scored/Advanced/Stayed/Out
  // queue for a ground ball where the batter is already known to be
  // SAFE (either just answered in the prompt above, or already known
  // from Bunt's own "Safe" button) -- reuses the exact same queue/UI
  // every Ground Out/Fly Out/Line Out/bunt-out already shares, just
  // under the new "groundSafe" kind, which finalizeRunnerOutcomeQueue
  // below knows means "nothing has been persisted yet; decide fielder's
  // choice vs. nothing once every runner has an answer."
  function beginImplicitFcFlow(hitType: HitType | null) {
    const order: Base[] = ["third", "second", "first"];
    const queue = order.filter((b) => state.runners[b]);
    if (queue.length === 0) return;
    setRunnerOutcomeKind("groundSafe");
    setRunnerOutcomeAtBatId(game.logging_mode === "quick" ? null : state.currentAtBatId);
    setRunnerOutcomeHitType(hitType);
    setRunnerOutcomeOutsBeforePlay(state.outs);
    setRunnerOutcomeRunnersBeforePlay(state.runners);
    setRunnerOutcomeOutBases([]);
    setRunnerOutcomeScoredBases([]);
    setRunnerOutcomeAnyMoved(false);
    setRunnerOutcomeQueue(queue);
  }

  // Feature 1 (fielding-play logging batch): Step 1's "who fielded it?"
  // confirm -- replaces the old bare FieldingPositionPicker call site.
  // Still just SET_FIELDING for every result (flyout/lineout/error keep
  // working exactly as before, no scorebook detour needed since the catch
  // itself is the whole play); a plain groundball/bunt groundout
  // additionally kicks off Step 2 (where the batter's own out was made).
  function handlePrimaryFielderConfirmed(f: ResolvedFielder) {
    dispatch({ type: "SET_FIELDING", position: f.position, playerId: f.playerId, opponentPlayerId: f.opponentPlayerId });
    const isGroundBallOut =
      state.suggestedResult === "groundout" && (state.pendingHitType === "groundball" || state.pendingHitType === "bunt");
    if (isGroundBallOut) {
      setGroundOutInitialFielder(f);
      setGroundOutSubStep("location");
    }
  }

  function anyRunnerOnBase(): boolean {
    return Boolean(state.runners.first || state.runners.second || state.runners.third);
  }

  // Bug fix (feature/lineup-drafts): which side bats is always fully
  // determined by home_away + inning_half -- the away team bats the top
  // half, the home team bats the bottom, every inning, no exceptions.
  // Previously the HITTING/PITCHING toggle let the operator pick either
  // mode regardless of inning_half, which is how this exact game (home,
  // started correctly in pitching for the top half) ended up with our
  // own players batting in the top half instead of the opponent -- see
  // the toggle buttons and the auto-correct effect below, both of which
  // now key off this single function instead of leaving mode as a free
  // choice. confirmEndInning already computed this inline (as
  // weAreHitting); reused here instead of duplicating the formula.
  function correctModeForHalf(inningHalf: InningHalf): AtBatMode {
    return (game.home_away === "home") === (inningHalf === "bottom") ? "hitting" : "pitching";
  }

  // Step 2: where the batter's own out was made.
  function handleGroundOutLocation(base: OutBase) {
    setGroundOutPendingBase(base);
    setGroundOutSubStep("confirmFielder");
  }

  // Step 2's fielder confirm (who's credited with the putout at that
  // base) -- either finalizes a plain groundout right here, or (if
  // runners are on base with fewer than 2 outs) asks Step 3.
  // fix/dp-fc: always finalizes the plain groundout notation immediately
  // -- there's no more "was there another out?" branch here. A second
  // (or third) out on this same play is now entirely the per-runner
  // outcome queue's job, asked after this at-bat confirms (see
  // maybeStartRunnerOutcomeQueue), same as it already was for fly/line
  // outs. extraOutFielders stays an empty array unconditionally: the new
  // queue doesn't collect a fielder for an extra out (no fielding chain
  // question any more), only who was out.
  function handleGroundOutFielderConfirmed(f: ResolvedFielder) {
    setGroundOutBatterFielder(f);
    finalizeGroundOutNotation(f, []);
  }

  function finalizeGroundOutNotation(batterFielder: ResolvedFielder, extraOutFielders: number[]) {
    if (!groundOutInitialFielder) return;
    setPendingNotation(
      computeGroundBallNotation({
        initialFielder: FIELDING_POSITION_TO_NUMBER[groundOutInitialFielder.position],
        batterOutFielder: FIELDING_POSITION_TO_NUMBER[batterFielder.position],
        extraOutFielders,
      })
    );
    setGroundOutSubStep(null);
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
    // Feature 1 (fielding-play logging batch): for a plain groundball/bunt
    // groundout, fielded_by_position means putout credit (who's actually
    // credited with recording the out, e.g. 1B catching the relay and
    // stepping on the bag) -- that's groundOutBatterFielder (Step 2), not
    // state.pendingFielding (Step 1, who fielded the ball -- gets an
    // assist if that's a different fielder, tracked only in the notation
    // string, not a separate DB column). Every other fielded result
    // (flyout/lineout/error) has just the one fielder, and Step 1's *is*
    // the putout credit there (the catch/error is the whole play).
    const fielding = groundOutBatterFielder ?? state.pendingFielding;
    const scoredRunners = voidRuns ? [] : state.scoredThisAtBat;
    const batterName = battingPlayerInfo?.name ?? "Batter";
    // Feature 1 (fielding-play logging batch): a plain groundball/bunt
    // groundout already computed this via the Step 2-3 flow (pendingNotation);
    // every other fielded result (flyout/lineout/error) only ever needed
    // Step 1's single fielder, so it's computed fresh here instead of
    // routing those simpler cases through the multi-step flow at all.
    const scorebookNotation =
      pendingNotation ?? (fielding ? notationForSingleFielderPlay(result, hitType, FIELDING_POSITION_TO_NUMBER[fielding.position]) : null);

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
      [RESULT_LABELS[result], hitType ? HIT_TYPE_LABELS[hitType] : null, fielding?.position ?? null, scorebookNotation].filter(Boolean).join(" — ")
    );
    // Sacrifice-rules batch: the same per-runner outcome queue covers
    // both a fly/line/foul out and a bunt out at first now -- see
    // maybeStartRunnerOutcomeQueue's own comment for the exact trigger.
    maybeStartRunnerOutcomeQueue({ atBatId, result, hitType, outsBeforePlay: state.outs, runnersBeforePlay: state.runners });
    // Fix 5 (baseball-logic-fixes batch): a plain caught strikeout (not
    // dropped-third-strike-safe, which already covers "the catcher
    // couldn't handle it" via its own Fix 2 prompt) with runners on base
    // -- ask whether the pitch that ended the at-bat also got away enough
    // to let someone else advance.
    if (result === "strikeout" && (state.runners.first || state.runners.second || state.runners.third)) {
      setWildPitchKPrompt(true);
    }

    // Implicit-FC batch: captured before clearing it for the next at-bat
    // -- fcOutRunners isn't touched by CONFIRM_LOCAL itself, so it's
    // still exactly what beginImplicitFcFlow/finalizeRunnerOutcomeQueue
    // set once the per-runner queue decided who (0, 1, or 2 runners)
    // was put out.
    const fcExtraOutRunners = result === "fc" ? fcOutRunners : [];
    setFcOutRunners([]);

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
        scorebookNotation,
      });

      // Implicit-FC batch: the batter's own fc row never carries these
      // outs (the batter is always safe at first) -- a separate at_bats
      // row per runner who WAS put out (0, 1, or 2), exactly the same
      // per-out-row shape confirmDoublePlay already uses for a double/
      // triple play, just without relabeling the batter's own result.
      for (const runner of fcExtraOutRunners) {
        const { atBatId: extraAtBatId } = await logExtraOut({
          gameId: game.id,
          mode,
          playerId: runner.type === "player" ? runner.id : null,
          pitcherId: mode === "pitching" ? state.currentPitcherId : null,
          inning: state.inning,
          inningHalf: state.inningHalf,
          result: "fc",
        });
        dispatch({ type: "APPEND_EXTRA_OUT", atBatId: extraAtBatId });
      }
      if (fcExtraOutRunners.length > 0) {
        setSummaryFlash(`Fielder's Choice — ${fcExtraOutRunners.map((r) => r.name).join(", ")} out`);
        void withOfflineRetry(`fc-state-${game.id}-${Date.now()}`, () =>
          syncGameState(game.id, { outs: Math.min(3, state.outs + fcExtraOutRunners.length) })
        );
      } else if (result === "fc") {
        setSummaryFlash("Fielder's Choice");
      }
    });
  }


  async function handleUndo() {
    if (!state.lastConfirmed) return;
    const { atBatId, secondAtBatId, thirdAtBatId, mode, runsScored, runnersBeforeAtBat, pitchesThisAtBat, battingOrderPosition } =
      state.lastConfirmed;
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
      undoAtBat({
        gameId: game.id,
        atBatId,
        secondAtBatId,
        thirdAtBatId,
        mode,
        runsScoredToReverse: runsScored,
        restoreBattingOrderPosition: mode === "hitting" ? battingOrderPosition : null,
      })
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
  // Feature 2 (lineup-status batch): replaces the old dropdown-based
  // Loud-substitutions batch: this used to apply the chain to liveLineup
  // optimistically and fire confirmChainSubstitution through the silent
  // offline-retry queue (void withOfflineRetry(...), result never
  // checked) -- a coach saw the lineup strip update instantly no matter
  // what the server call actually did, including when it failed outright
  // (a permanent "game not active" rejection was dropped with zero
  // trace) or kept failing forever in the background queue (a generic,
  // easy-to-miss "N syncing…" chip, named to nothing in particular).
  // Rewritten so the strip only ever shows what's actually saved:
  // handleChainResolved itself now only closes the panel and kicks off
  // runChainSubstitution, which awaits the real result before touching
  // liveLineup/substitutionLog at all.
  function handleChainResolved(result: ChainResult) {
    dispatch({ type: "SET_PANEL", panel: "substitution", open: false });
    void runChainSubstitution(result);
  }

  async function runChainSubstitution(result: ChainResult) {
    // Rows the lineup strip should show as "Saving…" while this is in
    // flight -- the outgoing player (still visible, about to be
    // replaced) and anyone else whose position is changing. The
    // incoming player has no row to mark pending: a bench/reserve
    // player has no batting_order, so they don't appear in the
    // batting-order strip at all until the swap actually lands.
    const pendingIds = new Set<string>();
    if (result.outgoingPlayerId) pendingIds.add(result.outgoingPlayerId);
    for (const move of result.positionMoves) pendingIds.add(move.playerId);
    setPendingChainSubIds(pendingIds);
    setChainSubError(null);

    const nameOf = (id: string | null) => (id ? players.find((p) => p.id === id)?.name ?? "Player" : "Player");
    const subLabel = result.outgoingPlayerId
      ? `${nameOf(result.incomingPlayerId)} for ${nameOf(result.outgoingPlayerId)}`
      : nameOf(result.incomingPlayerId);

    try {
      // Awaited directly -- deliberately NOT routed through
      // withOfflineRetry/the silent queue, per the request. A network
      // blip is just another failure this surfaces with a Retry button,
      // not a reason to queue it invisibly.
      await confirmChainSubstitution(game.id, {
        incomingPlayerId: result.incomingPlayerId,
        entryPosition: result.entryPosition,
        outgoingPlayerId: result.outgoingPlayerId,
        positionMoves: result.positionMoves,
        reason: result.reason,
        inning: state.inning,
        inningHalf: state.inningHalf,
        chainNote: result.chainNote,
      });

      // Success: re-read the lineup from the database and replace the
      // local mirror wholesale, instead of trusting an optimistic patch
      // applied before the write was even sent -- the strip always
      // shows what the database actually holds now, not a guess of
      // what the write probably did.
      const freshLineup = await getLineupForGame(game.id);
      setLiveLineup(freshLineup);
      setPendingChainSubIds(new Set());

      if (result.outgoingPlayerId) {
        setSubstitutionLog((log) => [...log, { player_out_id: result.outgoingPlayerId!, player_in_id: result.incomingPlayerId }]);
      }

      // Pitcher auto-default: a substitution can change who plays P too
      // (the incoming player entering right at P, or an existing player
      // getting moved there as part of the same chain) -- keep
      // current_pitcher_id in sync with that the instant it happens,
      // same reasoning as the end-of-inning default above. Only acts when
      // this chain actually places someone new at P; a sub that leaves P
      // untouched (the far more common case) is a no-op here. Now gated
      // on the substitution having actually saved -- deriving this from
      // a chain that never landed would be wrong, not just optimistic.
      const newPitcherId =
        result.entryPosition === "P" ? result.incomingPlayerId : result.positionMoves.find((m) => m.position === "P")?.playerId ?? null;
      if (newPitcherId && newPitcherId !== state.currentPitcherId) {
        dispatch({ type: "SET_PITCHER", playerId: newPitcherId });
        void withOfflineRetry(`subpitcher-${game.id}-${Date.now()}`, () =>
          syncGameState(game.id, { current_pitcher_id: newPitcherId, pitch_count_for_current_pitcher: 0 })
        );
      }

      if (!result.outgoingPlayerId) return;
      const occupiedBase = (["first", "second", "third"] as Base[]).find(
        (b) => state.runners[b]?.type === "player" && state.runners[b]?.id === result.outgoingPlayerId
      );
      if (!occupiedBase) return;

      const incoming = players.find((p) => p.id === result.incomingPlayerId);
      const newRunner: RunnerState = {
        type: "player",
        id: result.incomingPlayerId,
        name: incoming?.name ?? "Pinch runner",
        jersey: incoming?.jersey_number ? String(incoming.jersey_number) : null,
      };
      dispatch({ type: "SET_RUNNER", base: occupiedBase, runner: newRunner });
      syncRunners({ ...state.runners, [occupiedBase]: newRunner });
    } catch (err) {
      setPendingChainSubIds(new Set());
      // Re-read the lineup on failure too, not just success: a failure
      // partway through confirmChainSubstitution (the outgoing player's
      // slot cleared, then the incoming write itself failed) leaves a
      // real partial state in the database -- the strip should show
      // that honestly rather than keep displaying stale pre-attempt
      // data while a red "didn't save" banner contradicts it. Best-
      // effort: if even this fails (likely the same outage that just
      // failed the substitution), fall back to leaving liveLineup as-is
      // rather than let a second error here hide the first.
      try {
        setLiveLineup(await getLineupForGame(game.id));
      } catch {
        // Nothing better to do -- the error banner below still reports
        // the original failure regardless.
      }
      const message = err instanceof Error ? err.message : "Something went wrong.";
      // GAME_NOT_ACTIVE_ERROR is the one error requireOperatorGame throws
      // that will never succeed on a later retry (see chain-substitution.ts) --
      // every other failure (a network blip, a transient DB error, a
      // zero-row update) is worth offering a retry for.
      const permanent = message === GAME_NOT_ACTIVE_ERROR;
      setChainSubError({
        message: permanent ? `${subLabel} didn't save — ${message}` : `${subLabel} didn't save. ${message}`,
        retryable: !permanent,
        retry: () => void runChainSubstitution(result),
      });
    }
  }

  // Feature 1 (lineup-status batch): "Add to Reserve" or "Out of Game" --
  // either way the player drops off the Late Arrival list for the rest of
  // this session (lateArrivalIds), since re-prompting about an
  // already-resolved check-in has nothing new to ask. Feature 2 also
  // updates liveLineup's own status for an "Add to Reserve" check-in --
  // without it the chain modal's bench (which reads liveLineup, not
  // lateArrivalIds) would never see them as available to sub in.
  function handleLateArrival(playerId: string, addToReserve: boolean) {
    setLateArrivalIds((prev) => new Set(prev).add(playerId));
    if (addToReserve) {
      setLiveLineup((prev) => prev.map((l) => (l.player_id === playerId ? { ...l, status: "late_arrival" } : l)));
    }
    void withOfflineRetry(`latearrival-${game.id}-${Date.now()}`, () =>
      markLateArrival(game.id, { playerId, addToReserve, inning: state.inning, inningHalf: state.inningHalf })
    );
    setLateArrivalOpen(false);
  }

  // Bug fix (feature/lineup-drafts): shared by every ad-hoc (outside the
  // at-bat review flow) path where a runner scores with no upcoming
  // Confirm At-Bat to carry the run through -- the ad-hoc "Scored" tap
  // (any ScoreMethod), a sac fly/squeeze decision, and now a stolen base
  // from third (stealing home). Previously only the ad-hoc "Scored" tap
  // had this; a steal of home went through a completely different early
  // return in applyRunnerAction below that never bumped the score at
  // all, on screen OR in the database. Dispatched once, synchronously,
  // right at the call site -- not from adjustScore's own (fire-and-
  // forget, no success callback) completion -- so it can't double count.
  function bumpScoreAdHoc() {
    if (state.awaitingResult) return;
    dispatch({
      type: "SET_SCORE",
      ourScore: state.mode === "hitting" ? state.ourScore + 1 : state.ourScore,
      opponentScore: state.mode === "pitching" ? state.opponentScore + 1 : state.opponentScore,
    });
    void withOfflineRetry(`score-${game.id}-${Date.now()}`, () => adjustScore(game.id, state.mode, 1));
  }

  function applyRunnerAction(base: Base, action: RunnerQuickAction, scoreMethod?: ScoreMethod, forced?: boolean) {
    const runner = state.runners[base];
    if (!runner) return;

    if (action === "scored" && !scoreMethod) {
      setRunnerActionMenu(null);
      setRunnerActionAnchor(null);
      setScoreMethodPrompt({ base, runner });
      return;
    }

    dispatch({ type: "APPLY_RUNNER_ACTION", base, action, scoreMethod, forced });
    setRunnerActionMenu(null);
    setRunnerActionAnchor(null);
    setScoreMethodPrompt(null);

    if (action === "advance" || action === "stolen_base") {
      const advanced = advanceOneRunner(state.runners, base);
      syncRunners(advanced.runners);
      if (action === "stolen_base" && runner.type === "player" && runner.id) {
        void withOfflineRetry(`sb-${game.id}-${Date.now()}`, () => logStolenBase(game.id, runner.id!, state.inning));
      }
      // Bug fix: advancing off third (a steal of home, or a plain
      // "Advance" tapped on a runner already on third) means
      // advanceOneRunner reports them scored -- see its own base ===
      // "third" branch -- but this early return never used to check
      // that at all. No RBI either way (advanceOneRunner's "scored" here
      // carries no ScoreMethod/game_events concept -- stolen_base is
      // already excluded from RBI eligibility, same as every other
      // non-batted-ball way a runner reaches home).
      //
      // Run-attribution batch: also logs a runner_scored event with the
      // scorer attributed, so this run (previously credited to the team
      // score only) counts toward the player's own R too -- reuses
      // bumpScoreAdHoc for the score bump itself (its own awaitingResult
      // check is what keeps this from double-counting a run that's really
      // part of an in-progress at-bat review, same reasoning as every
      // other ad-hoc path below), so the score is bumped exactly once and
      // the event is logged exactly once, never both or neither.
      if (advanced.scored.length > 0 && !state.awaitingResult) {
        const scorer = advanced.scored[0];
        bumpScoreAdHoc();
        void withOfflineRetry(`event-${game.id}-${Date.now()}`, () =>
          logGameEvent(game.id, {
            eventType: "runner_scored",
            inning: state.inning,
            inningHalf: state.inningHalf,
            mode: state.mode,
            runsScored: 1,
            scorerPlayerId: scorer.type === "player" ? scorer.id : null,
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
    // wild_pitch/balk -> pitcher, passed_ball -> catcher; "error" (no
    // picker in this sub-menu) is logged without a guessed fielder.
    const fielder = eventType === "wild_pitch" || eventType === "balk" ? resolve("P") : eventType === "passed_ball" ? resolve("C") : null;

    if (!state.awaitingResult) {
      // Ad-hoc, outside the at-bat review flow -- confirmAtBat's runsScored
      // already covers the in-review case (RBI included), so this only
      // fires when there's no upcoming Confirm At-Bat to carry the run.
      // RBI isn't attributed here -- there's no "current batter" in an
      // ad-hoc context to credit it to. bumpScoreAdHoc's own awaitingResult
      // check is what keeps this from double-counting a run that's really
      // part of an in-progress at-bat review -- called exactly once here,
      // never from the mid-review branch below.
      bumpScoreAdHoc();
      // Run-attribution batch: this ad-hoc case has no at_bats row anywhere
      // that will ever carry this run, so it's the one place a missing
      // game_events type would mean losing attribution entirely --
      // "runner_scored" is the fallback for every scoreMethod with no more
      // specific SCORE_METHOD_EVENT mapping (sac_fly, hit, forced_walk_hbp,
      // obstruction), so every ad-hoc "Scored" tap now leaves an
      // attributable record, not just the ones that already had a
      // wild_pitch/balk/passed_ball/error/squeeze_play cause. Exactly one
      // event logged per call, matching the exactly-one score bump above.
      void withOfflineRetry(`event-${game.id}-${Date.now()}`, () =>
        logGameEvent(game.id, {
          eventType: eventType ?? "runner_scored",
          inning: state.inning,
          inningHalf: state.inningHalf,
          mode: state.mode,
          runsScored: 1,
          scorerPlayerId: runner.type === "player" ? runner.id : null,
          playerId: fielder?.playerId ?? null,
          opponentPlayerId: fielder?.opponentPlayerId ?? null,
        })
      );
    } else if (eventType) {
      // Mid-review (an at-bat is still open): no scorer/runs attribution
      // here, since CONFIRM_LOCAL is what will credit this run (onto the
      // batter's own at_bats row, via scoredThisAtBat) once that at-bat
      // confirms. Attributing it here too would double-count the same run
      // under two different players -- so this branch and the one above
      // are mutually exclusive, and together log the event exactly once.
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
        // Run-attribution batch, corrected during the Nov 7 merge:
        // advanceRunnerWithMethod dispatches APPLY_RUNNER_ACTION("advance"),
        // which (per the reducer) always appends any scored runner to
        // state.scoredThisAtBat regardless of whether an at-bat is
        // currently open -- that entry is always picked up by a future
        // CONFIRM_LOCAL (the currently-open at-bat in the normal case; the
        // next batter's, in the rarer postStrikeoutWildPitch case below),
        // which is what actually credits the run to both games.our_score
        // and the crediting batter's own at_bats.runs_scored. Unlike the
        // ad-hoc applyRunnerAction("scored")/stolen-base paths above (which
        // call bumpScoreAdHoc immediately and so need their own
        // attributed event to credit the real scorer), nothing here ever
        // bumps the score directly -- so logging scorerPlayerId/runsScored
        // on this event too would double-count the same run under two
        // different players once that future at-bat confirms. No scorer
        // attribution for this reason, same as before run-attribution.
        void withOfflineRetry(`event-${game.id}-${Date.now()}`, () =>
          logGameEvent(game.id, {
            eventType: reason,
            inning: state.inning,
            inningHalf: state.inningHalf,
            mode: state.mode,
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
      advanceRunnerWithMethod(base, reason);
      const eventFielder = reason === "wild_pitch" ? resolve("P") : resolve("C");
      // See the matching comment above -- same reasoning, same no-scorer-
      // attribution fix.
      void withOfflineRetry(`event-${game.id}-${Date.now()}`, () =>
        logGameEvent(game.id, {
          eventType: reason,
          inning: state.inning,
          inningHalf: state.inningHalf,
          mode: state.mode,
          playerId: eventFielder?.playerId ?? null,
          opponentPlayerId: eventFielder?.opponentPlayerId ?? null,
        })
      );
      return;
    }

    if (reason === "balk") {
      // Not a ball -- the count is untouched, only the runner moves.
      advanceRunnerWithMethod(base, "balk");
      setSummaryFlash("Balk — runner advances");
      const fielderP = resolve("P");
      // See the wild-pitch/passed-ball comment above -- balk never bumps
      // the score directly either, so no scorer attribution here.
      void withOfflineRetry(`event-${game.id}-${Date.now()}`, () =>
        logGameEvent(game.id, {
          eventType: "balk",
          inning: state.inning,
          inningHalf: state.inningHalf,
          mode: state.mode,
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
      advanceRunnerWithMethod(base, "error");
      // See the wild-pitch/passed-ball comment above -- same reasoning.
      void withOfflineRetry(`event-${game.id}-${Date.now()}`, () =>
        logGameEvent(game.id, {
          eventType: "error",
          inning: state.inning,
          inningHalf: state.inningHalf,
          mode: state.mode,
          playerId: fielder.playerId,
          opponentPlayerId: fielder.opponentPlayerId,
        })
      );
      return;
    }

    // "Sac Bunt" -- a manual correction to a runner's position after a
    // bunt play, for whenever the operator wants to adjust by hand
    // instead of (or after) the runnerOutcomeQueue's own per-runner
    // questions. RBI-eligible like sac_fly if it scores them, same
    // "batter's own action drove the run in" logic; no separate
    // game_events row, same as sac_fly/hit/forced_walk_hbp.
    if (reason === "sac_bunt") {
      advanceRunnerWithMethod(base, "sac_bunt");
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

  // Sacrifice-rules batch, extended by fix/dp-fc: the single trigger for
  // the per-runner outcome queue, called right after an at-bat confirms
  // (from both handleConfirm and handleQuickPick) -- never before,
  // since outcome-based sacrifice/double-play rules need the play's own
  // result/hitType already decided. Fires for a fly/line/foul out
  // (result "flyout"/"lineout" -- a foul out is stored as "flyout" too,
  // see CLAUDE.md), a bunt out at first (result "groundout" with hitType
  // "bunt"), or now ANY other groundout too (fix/dp-fc's "ground" kind,
  // what makes a double/triple play derivable from a plain Ground Out),
  // only when a runner is on base and outs are below 2 (the out just
  // recorded would otherwise end the inning before any runner could
  // legally do anything else). Queue order is top base first (third,
  // second, first), per spec.
  function maybeStartRunnerOutcomeQueue(params: { atBatId: string; result: AtBatResult; hitType: HitType | null; outsBeforePlay: number; runnersBeforePlay: Runners }) {
    if (params.outsBeforePlay >= 2) return;
    const isFlyType = params.result === "flyout" || params.result === "lineout";
    const isGroundType = params.result === "groundout";
    if (!isFlyType && !isGroundType) return;
    const order: Base[] = ["third", "second", "first"];
    const queue = order.filter((b) => params.runnersBeforePlay[b]);
    if (queue.length === 0) return;
    const kind: RunnerOutcomeKind = isFlyType ? "fly" : params.hitType === "bunt" ? "bunt" : "ground";
    setRunnerOutcomeKind(kind);
    setRunnerOutcomeAtBatId(params.atBatId);
    setRunnerOutcomeOutsBeforePlay(params.outsBeforePlay);
    setRunnerOutcomeOutBases([]);
    setRunnerOutcomeScoredBases([]);
    setRunnerOutcomeAnyMoved(false);
    setRunnerOutcomeQueue(queue);
  }

  // One runner's outcome, popped from runnerOutcomeQueue regardless of
  // which way it's decided. fix/dp-fc: "scored" and "out" no longer
  // apply their DB-side effects (score bump/RBI/game_events for a score,
  // a real extra at_bats row for an out) immediately -- they're
  // collected here and applied all at once, with the full picture, once
  // the queue drains (finalizeRunnerOutcomeQueue below). `runners`
  // itself still updates immediately either way (SET_RUNNER, local-only)
  // so the diamond stays responsive while the queue is still open.
  // "Advanced" is unambiguous regardless of what else happens on this
  // play, so it still applies immediately via the existing
  // applyRunnerAction path.
  type RunnerOutcomeDecision = "scored" | "advanced" | "stayed" | "out";
  function handleRunnerOutcomeDecision(base: Base, decision: RunnerOutcomeDecision) {
    const runner = state.runners[base];
    setRunnerOutcomeQueue((q) => q.filter((b) => b !== base));
    if (!runner) return;

    if (decision === "stayed") return;

    if (decision === "out") {
      setRunnerOutcomeOutBases((bs) => [...bs, { base, runner }]);
      dispatch({ type: "SET_RUNNER", base, runner: null });
      setSummaryFlash(runnerOutcomeKind === "fly" ? `${runner.name} — Out, left base early` : `${runner.name} — Out`);
      return;
    }

    if (decision === "scored") {
      setRunnerOutcomeScoredBases((bs) => [...bs, { base, runner }]);
      setRunnerOutcomeAnyMoved(true);
      dispatch({ type: "SET_RUNNER", base, runner: null });
      setSummaryFlash(`${runner.name} scores`);
      return;
    }

    // advanced
    setRunnerOutcomeAnyMoved(true);
    applyRunnerAction(base, "advance");
    setSummaryFlash(`${runner.name} advances to ${NEXT_BASE[base]}`);
  }

  // fix/dp-fc: once the queue fully drains, apply everything at once,
  // now that the FULL outcome of the play is known:
  //  - "ground": 1 or 2 extra outs relabels the play Double Play/Triple
  //    Play (resolveBattedBallPlay) and persists the extra out(s) via
  //    confirmDoublePlay (reused as-is -- it already accepts null
  //    fielding, since this flow never collects a fielder for the extra
  //    out). inningEndedOnForce is the third-out rule: a run voided
  //    because the out that brought the half-inning to 3 was a force.
  //  - "fly"/"bunt": unchanged sacrifice determination (never produces
  //    an extra out -- a doubled-off/appealed runner on a fly ball is a
  //    tag play, never a force, so it can never retroactively cancel
  //    another runner's run the way a ground-ball force can).
  // Every "scored" decision's score bump/RBI/game_events, and every
  // "out" decision's real at_bats row, happens exactly once, right here
  // -- nothing was applied optimistically while the queue was still open.
  // Bug 2 fix (fix/dp-fc follow-up): this used to `return` right after
  // the fly/bunt sacrifice check, before ever reaching the outBases
  // persistence block below -- so a runner marked "Out" on a Fly
  // Out/Line Out/Foul Out (or a bunt) was removed from the diamond
  // locally (handleRunnerOutcomeDecision's SET_RUNNER) but the extra
  // out was never actually logged: no second at_bats row, no
  // APPEND_EXTRA_OUT, no outs bump, no double-play relabeling. "ground"
  // was never affected -- it already fell through to the persistence
  // block unconditionally. Restructured so sacrifice determination
  // (fly/bunt-only) and outs/labeling/third-out-rule/persistence (every
  // kind) are two independent steps instead of one early-returning
  // branch.
  async function finalizeRunnerOutcomeQueue() {
    const kind = runnerOutcomeKind;
    const atBatId = runnerOutcomeAtBatId;
    if (!kind) return;
    if (kind !== "groundSafe" && !atBatId) return;
    const outBases = runnerOutcomeOutBases;
    const scoredBases = runnerOutcomeScoredBases;
    const anyMoved = runnerOutcomeAnyMoved;
    const outsBeforePlay = runnerOutcomeOutsBeforePlay;
    const hitType = runnerOutcomeHitType;
    const runnersBeforePlay = runnerOutcomeRunnersBeforePlay;
    setRunnerOutcomeKind(null);
    setRunnerOutcomeAtBatId(null);
    setRunnerOutcomeOutBases([]);
    setRunnerOutcomeScoredBases([]);

    // Implicit-FC batch: unlike the other three kinds, nothing has been
    // persisted yet -- see finalizeImplicitFc for the full decision
    // (fielder's choice vs. recording nothing at all).
    if (kind === "groundSafe") {
      await finalizeImplicitFc({ outBases, scoredBases, outsBeforePlay, hitType, runnersBeforePlay });
      return;
    }
    if (!atBatId) return;

    if (kind === "fly" || kind === "bunt") {
      const isSacrifice = kind === "fly" ? scoredBases.length > 0 : anyMoved && outBases.length === 0;
      if (isSacrifice) {
        void withOfflineRetry(`sactype-${atBatId}`, () => setSacrificeType(game.id, atBatId, kind));
        setBanner(
          kind === "fly"
            ? "Counted as a sacrifice fly: a run scored, so this is not an at-bat."
            : "Counted as a sacrifice bunt: a runner moved up, so this is not an at-bat."
        );
      }
    }

    // Outs/labeling/third-out rule, shared by every kind. A fly/line out
    // is never a force (isGroundoutForce only cares whether the result
    // is literally "groundout"), so "flyout" is a safe stand-in for
    // kind "fly" here -- resolveBattedBallPlay never distinguishes
    // flyout from lineout beyond that, and the single-out label it
    // would otherwise pick was already shown by handleConfirm/
    // handleQuickPick before this queue even started.
    const play = resolveBattedBallPlay({
      result: kind === "fly" ? "flyout" : "groundout",
      outsBeforePlay: runnerOutcomeOutsBeforePlay,
      decisions: Object.fromEntries([...outBases.map((o) => [o.base, "out"]), ...scoredBases.map((s) => [s.base, "scored"])]),
    });

    if (play.inningEndedOnForce && scoredBases.length > 0) {
      setBanner(`${scoredBases.length > 1 ? "Runs" : "Run"} did not count — the 3rd out was a force play (rule 5.09)`);
    } else {
      for (const { base, runner } of scoredBases) {
        // Implicit-FC batch: rule 9.04(a)(2) -- no RBI is ever credited on
        // a play where the batter grounds into a (now always-derived)
        // double or triple play, run or no run. Only applies to kind
        // "ground" (batterOut always true there) -- "bunt"'s own
        // squeeze-play/sac-bunt RBI rules are unaffected, since a bunt
        // double play wasn't part of what was asked for here.
        const method: ScoreMethod =
          kind === "fly"
            ? "sac_fly"
            : kind === "bunt"
              ? (base === "third" ? "squeeze_play" : "sac_bunt")
              : play.isDoublePlay || play.isTriplePlay
                ? "double_play"
                : "hit";
        void creditAdHocRun(atBatId, runner, method);
      }
    }

    if (outBases.length > 0) {
      try {
        const { secondAtBatId, thirdAtBatId } = await confirmDoublePlay({
          gameId: game.id,
          atBatId,
          mode: state.mode,
          inning: state.inning,
          inningHalf: state.inningHalf,
          pitcherId: state.mode === "pitching" ? state.currentPitcherId : null,
          hitType: state.pendingHitType,
          fieldX: null,
          fieldY: null,
          scorebookNotation: pendingNotation,
          batterFielding: null,
          secondOutRunner: { type: outBases[0].runner.type, id: outBases[0].runner.id },
          outType: "force",
          secondOutFielding: null,
          thirdOut: outBases[1]
            ? { runner: { type: outBases[1].runner.type, id: outBases[1].runner.id }, outType: "force", fielding: null }
            : undefined,
        });
        dispatch({ type: "APPEND_EXTRA_OUT", atBatId: secondAtBatId });
        if (thirdAtBatId) dispatch({ type: "APPEND_EXTRA_OUT", atBatId: thirdAtBatId });
        setSummaryFlash(`${play.resultLabel} — ${outBases.map((o) => o.runner.name).join(", ")} out`);
        void withOfflineRetry(`dp-state-${game.id}-${Date.now()}`, () =>
          syncGameState(game.id, { outs: Math.min(3, state.outs + outBases.length) })
        );
      } catch (err) {
        setBanner(err instanceof Error ? err.message : "Failed to log the extra out -- check connection and try again");
      }
    }
  }

  // Implicit-FC batch: the groundSafe-kind decision finalizeRunnerOutcomeQueue
  // defers to -- nothing has been persisted for this play yet (the batter
  // was never confirmed out, so there's no "groundout" row to append an
  // extra out onto). resolveGroundBallWithRunners decides between three
  // outcomes: "record nothing" (batter safe, nobody out -- revert the
  // local runner movements and tell the operator to use 1B/Error
  // instead), a fielder's choice (batter safe, at least one runner out),
  // or (implicitly, never reached here since batterOut is always false
  // for this kind) a double/triple play.
  async function finalizeImplicitFc(ctx: {
    outBases: { base: Base; runner: RunnerState }[];
    scoredBases: { base: Base; runner: RunnerState }[];
    outsBeforePlay: number;
    hitType: HitType | null;
    runnersBeforePlay: Runners | null;
  }) {
    const { outBases, scoredBases, outsBeforePlay, hitType, runnersBeforePlay } = ctx;
    const decisions: Partial<Record<Base, RunnerOutcomeDecision>> = Object.fromEntries([
      ...outBases.map((o) => [o.base, "out"] as const),
      ...scoredBases.map((s) => [s.base, "scored"] as const),
    ]);
    const play = resolveGroundBallWithRunners({ batterOut: false, outsBeforePlay, decisions });

    if (play.recordNothing) {
      const revert = runnersBeforePlay ?? state.runners;
      dispatch({ type: "APPLY_HIT_RUNNER_DECISION", runners: revert, scoredAdd: [] });
      syncRunners(revert);
      setBanner("If the batter reached safely with nobody out, record it as a hit (1B) or an Error.");
      return;
    }

    const method: ScoreMethod = outsBeforePlay < 2 ? "fielders_choice" : "fielders_choice_2out";
    let creditScored = scoredBases;
    let runsScored = creditScored.length;
    if (play.inningEndedOnForce && creditScored.length > 0) {
      setBanner(`${creditScored.length > 1 ? "Runs" : "Run"} did not count — the 3rd out was a force play (rule 5.09)`);
      creditScored = [];
      runsScored = 0;
    } else {
      setBanner("Counted as a fielder's choice: the batter reached because a runner was put out. It's an at-bat, not a hit.");
    }
    const rbi = SCORE_METHOD_AWARDS_RBI[method] ? runsScored : 0;
    const outRunners = outBases.map((o) => o.runner);
    const batter = currentBatterRunner();
    const finalRunners: Runners = { ...state.runners, first: batter };
    const scoredRunnerEntries: ScoredRunner[] = creditScored.map(({ runner }) => ({ runner, method }));

    if (game.logging_mode === "quick") {
      try {
        const { atBatId: fcAtBatId } = await logQuickAtBat({
          gameId: game.id,
          mode: state.mode,
          playerId: state.mode === "hitting" ? (battingPlayer?.player_id ?? null) : null,
          pitcherId: state.mode === "pitching" ? state.currentPitcherId : null,
          inning: state.inning,
          inningHalf: state.inningHalf,
          battingOrderPosition: state.mode === "hitting" ? state.battingOrderPosition : null,
          result: "fc",
          hitType,
          rbi,
          runsScored,
          opponentPitcherId: state.mode === "hitting" ? state.currentOpponentPitcherId : null,
          outsBefore: outsBeforePlay,
          rispBefore: Boolean(runnersBeforePlay?.second || runnersBeforePlay?.third),
          fieldX: null,
          fieldY: null,
        });
        dispatch({
          type: "QUICK_CONFIRM_LOCAL",
          atBatId: fcAtBatId,
          result: "fc",
          runners: finalRunners,
          scored: scoredRunnerEntries,
          outsRecorded: 0,
          runnersBeforeAtBat: runnersBeforePlay ?? state.runners,
        });
        syncRunners(finalRunners);

        for (const outRunner of outRunners) {
          const { atBatId: extraAtBatId } = await logExtraOut({
            gameId: game.id,
            mode: state.mode,
            playerId: outRunner.type === "player" ? outRunner.id : null,
            pitcherId: state.mode === "pitching" ? state.currentPitcherId : null,
            inning: state.inning,
            inningHalf: state.inningHalf,
            result: "fc",
          });
          dispatch({ type: "APPEND_EXTRA_OUT", atBatId: extraAtBatId });
        }
        if (outRunners.length > 0) {
          setSummaryFlash(`Fielder's Choice — ${outRunners.map((r) => r.name).join(", ")} out`);
          void withOfflineRetry(`fc-state-${game.id}-${Date.now()}`, () =>
            syncGameState(game.id, { outs: Math.min(3, outsBeforePlay + outRunners.length) })
          );
        } else {
          setSummaryFlash("Fielder's Choice");
        }
      } catch (err) {
        setBanner(err instanceof Error ? err.message : "Failed to log at-bat -- check connection and try again");
      }
      return;
    }

    // Full Mode: dispatch SET_RESULT and let the existing runnerConfirm /
    // auto-confirm-effect / handleConfirm pipeline persist it onto the
    // already-open draft at-bat -- handleConfirm's own fcOutRunners-driven
    // extra-out persistence (see above) takes it from here.
    setFcOutRunners(outRunners);
    dispatch({ type: "SET_RESULT", result: "fc", suggestion: finalRunners, scored: scoredRunnerEntries, hasMovement: true });
    syncRunners(finalRunners);
  }

  // fix/dp-fc: the ad-hoc run-crediting every "Scored" decision needs --
  // factored out of the old handleRunnerOutcomeDecision so both the
  // fly/bunt sacrifice path and the new ground/force-out path above can
  // share it. Same mechanism the diamond's own ad-hoc "Scored" action
  // already uses once an at-bat is no longer open (bumpScoreAdHoc-style
  // score update + a game_events row for the player's own run, plus the
  // RBI written directly onto the batter's already-confirmed row).
  function creditAdHocRun(atBatId: string, runner: RunnerState, method: ScoreMethod) {
    bumpScoreAdHoc();
    const eventType = SCORE_METHOD_EVENT[method] ?? "runner_scored";
    void withOfflineRetry(`event-${game.id}-${Date.now()}-${runner.id ?? runner.name}`, () =>
      logGameEvent(game.id, {
        eventType,
        inning: state.inning,
        inningHalf: state.inningHalf,
        mode: state.mode,
        runsScored: 1,
        scorerPlayerId: runner.type === "player" ? runner.id : null,
      })
    );
    if (SCORE_METHOD_AWARDS_RBI[method]) {
      void withOfflineRetry(`runout-rbi-${atBatId}-${runner.id ?? runner.name}`, () => incrementAtBatRbi(game.id, atBatId, 1));
    }
  }

  useEffect(() => {
    if (runnerOutcomeQueue.length > 0 || !runnerOutcomeKind) return;
    // Implicit-FC batch: kind "groundSafe" may have no at-bat id yet
    // (Quick Mode has no draft row to point at) -- every other kind
    // always has one (maybeStartRunnerOutcomeQueue only ever fires after
    // the batter's own row is already confirmed).
    if (runnerOutcomeKind !== "groundSafe" && !runnerOutcomeAtBatId) return;
    void finalizeRunnerOutcomeQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runnerOutcomeQueue.length, runnerOutcomeKind, runnerOutcomeAtBatId]);

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
        outsBefore: state.outs,
        rispBefore: Boolean(state.runners.second || state.runners.third),
      });
      dispatch({ type: "CONFIRM_INTENTIONAL_WALK", atBatId, runners: suggestion, runsScored, runnersBeforeAtBat });
      syncRunners(suggestion);
      setSummaryFlash(`Intentional Walk — ${batter.name} to 1st`);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "Failed to log intentional walk -- check connection and try again");
    }
  }

  // Quick Mode batch: one tap, one already-confirmed at-bat -- no draft,
  // no pitches. Sacrifice-rules batch: nothing here moves runners by
  // default any more, even for a bunt -- suggestRunnerAdvance's plain
  // "groundout" case (no movement) now applies uniformly, and the
  // runnerOutcomeQueue triggered below is what actually decides whether
  // anyone scored/advanced, for ANY qualifying flyout/lineout/bunt-out,
  // not just ones tapped through a since-removed "sac" button.
  async function handleQuickPick(
    pick: { label: string; result: AtBatResult; hitType: HitType | null; scorebookNotation?: string },
    fieldSpot: { x: number; y: number } | null
  ) {
    if (state.outs >= 3) return;
    setBanner(null);
    const batter = currentBatterRunner();
    const { runners: suggestion, scored } = suggestRunnerAdvance(state.runners, batter, pick.result);
    const method: ScoreMethod = resultToScoreMethod(pick.result);
    const runsScored = scored.length;
    const rbi = SCORE_METHOD_AWARDS_RBI[method] ? runsScored : 0;
    const outsRecorded = RESULT_IS_OUT[pick.result] ? 1 : 0;
    const runnersBeforeAtBat = state.runners;
    const isBuntGroundout = pick.hitType === "bunt" && pick.result === "groundout";

    try {
      const { atBatId } = await logQuickAtBat({
        gameId: game.id,
        mode: state.mode,
        playerId: state.mode === "hitting" ? (battingPlayer?.player_id ?? null) : null,
        pitcherId: state.mode === "pitching" ? state.currentPitcherId : null,
        inning: state.inning,
        inningHalf: state.inningHalf,
        battingOrderPosition: state.mode === "hitting" ? state.battingOrderPosition : null,
        result: pick.result,
        hitType: pick.hitType,
        rbi,
        runsScored,
        opponentPitcherId: state.mode === "hitting" ? state.currentOpponentPitcherId : null,
        scorebookNotation: pick.scorebookNotation ?? null,
        outsBefore: state.outs,
        rispBefore: Boolean(state.runners.second || state.runners.third),
        fieldX: fieldSpot?.x ?? null,
        fieldY: fieldSpot?.y ?? null,
      });
      dispatch({
        type: "QUICK_CONFIRM_LOCAL",
        atBatId,
        result: pick.result,
        runners: suggestion,
        scored: scored.map((r) => ({ runner: r, method })),
        outsRecorded,
        runnersBeforeAtBat,
      });
      syncRunners(suggestion);
      setSummaryFlash(`${pick.label}${runsScored > 0 ? ` — ${runsScored} run${runsScored === 1 ? "" : "s"}` : ""}`);
      setLastQuickPickWasSacBunt(isBuntGroundout);

      maybeStartRunnerOutcomeQueue({ atBatId, result: pick.result, hitType: pick.hitType, outsBeforePlay: state.outs, runnersBeforePlay: state.runners });
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "Failed to log at-bat -- check connection and try again");
    }
  }

  // Urgent mobile fixes, Fix 5: a ball in play (anything except
  // strikeout/walk/HBP, none of which have a landing spot) now stages
  // the pick and shows a one-tap field diagram before actually logging
  // it, instead of logging immediately on the grid tap. "Skip" (or
  // tapping nothing) still logs the at-bat -- field_x/field_y just stay
  // null, same as any other at-bat nobody tapped a location for.
  //
  // Implicit-FC batch: the plain "Ground Out"/"GO" quick button (and
  // Bunt's own "Out at First", which also ends up here via
  // handleBuntOutcome) used to fall straight through to handleQuickPick,
  // always treating the batter as out. Intercepted here the same way
  // pickResult intercepts it for Full Mode, so both grids and both modes
  // now ask "Was the batter put out?" first when there's a runner on
  // base and outs below 2 -- see resolveGroundOutBatterPrompt/
  // beginImplicitFcFlow above.
  function startQuickPick(def: QuickModeButtonDef) {
    if (state.outs >= 3) return;
    if (def.result === "groundout" && anyRunnerOnBase() && state.outs < 2) {
      setGroundOutQuickPendingDef(def);
      setGroundOutBatterPromptOpen(true);
      return;
    }
    proceedQuickGroundOutAsOut(def);
  }

  // Implicit-FC batch: what startQuickPick used to do unconditionally
  // for every result -- factored out so "Out at First" (answered in the
  // new prompt) can resume exactly here, skipping the question it
  // already answered.
  function proceedQuickGroundOutAsOut(def: QuickModeButtonDef) {
    if (NO_FIELD_TAP_RESULTS.has(def.result)) {
      void handleQuickPick(def, null);
      return;
    }
    setPendingFieldTapPick(def);
  }

  function resolveQuickFieldTap(x: number, y: number) {
    if (!pendingFieldTapPick) return;
    const pick = pendingFieldTapPick;
    setPendingFieldTapPick(null);
    void handleQuickPick(pick, { x, y });
  }

  function skipQuickFieldTap() {
    if (!pendingFieldTapPick) return;
    const pick = pendingFieldTapPick;
    setPendingFieldTapPick(null);
    void handleQuickPick(pick, null);
  }

  // Sacrifice-rules batch: Quick Mode's new standalone "Bunt" button asks
  // how the play ended first (matching Full Mode's own bunt result step,
  // see BUNT_RESULT_LABELS) instead of carrying a pre-decided result --
  // the picked outcome then flows through the exact same startQuickPick
  // pipeline (field-tap step included) every other ball-in-play result
  // already uses.
  //
  // Implicit-FC batch: the 4th "FC" option is gone -- removing the
  // standalone Fielder's Choice button means a bunt where the batter
  // reaches but a runner is retired needs a new way to be represented,
  // or it would become a silent gap (no button left could express it).
  // "Safe," with a runner on base and outs below 2, now opens the same
  // implicit-FC queue a plain Ground Out does (batterOut already known
  // false, so the preliminary question is skipped) instead of recording
  // an unconditional bunt single -- a runner marked "Out" there is what
  // derives the fielder's choice. "Out at First" is unchanged (still
  // routes through startQuickPick, which will itself ask "Was the
  // batter put out?" again for a runner-on-base/outs-below-2 bunt --
  // mildly redundant with having just tapped "Out at First," but safe,
  // and keeps one unconditional entry point for every groundout/bunt
  // combination instead of two).
  function handleBuntOutcome(outcome: "out_at_first" | "safe" | "error") {
    setBuntOutcomePrompt(false);
    if (outcome === "safe" && anyRunnerOnBase() && state.outs < 2) {
      beginImplicitFcFlow("bunt");
      return;
    }
    const def: QuickModeButtonDef =
      outcome === "out_at_first"
        ? { label: "Bunt — Out at First", result: "groundout", hitType: "bunt" }
        : outcome === "safe"
          ? { label: "Bunt — Safe", result: "single", hitType: "bunt" }
          : { label: "Bunt — Error", result: "error", hitType: "bunt" };
    startQuickPick(def);
  }

  // Quick Mode scorekeeper batch: Stolen Base as its own direct button --
  // applyRunnerAction's "stolen_base" branch was already generic/safe to
  // call outside the draft/confirm lifecycle (it just moves the runner
  // and logs to the standalone stolen_bases table), so this is only ever
  // the base picker in front of it, not new scoring logic.
  function handleQuickStolenBase(base: Base) {
    setQuickRunnerPrompt(null);
    applyRunnerAction(base, "stolen_base");
  }

  // Quick Mode scorekeeper batch: standalone all-runners Wild Pitch/Passed
  // Ball/Balk -- reintroduced for Quick Mode only (full mode replaced
  // these with a per-runner AdvanceReasonMenu; see the Runner-actions
  // consolidation note in CLAUDE.md). Deliberately does NOT log a "ball"
  // pitches row or bump any pitch count the way full mode's wild-pitch/
  // passed-ball advance reason does -- Quick Mode has no per-at-bat pitch
  // count to add one to in the first place (that's the whole premise of
  // the mode), so this only moves runners and logs the game_events row.
  function handleQuickAllRunnersEvent(eventType: "wild_pitch" | "passed_ball" | "balk") {
    if (!state.runners.first && !state.runners.second && !state.runners.third) return;
    const { runners: advanced, scored } = advanceAllRunnersOneBase(state.runners);
    dispatch({ type: "ADVANCE_ALL_RUNNERS_LOCAL", runners: advanced, runsScored: scored.length });
    syncRunners(advanced);
    const fielder = eventType === "passed_ball" ? resolve("C") : resolve("P");
    // Run-attribution batch: at most one runner ever scores here (only a
    // runner starting from 3rd can cross home on a one-base advance).
    const scorer = scored[0];
    void withOfflineRetry(`event-${game.id}-${Date.now()}`, () =>
      logGameEvent(game.id, {
        eventType,
        inning: state.inning,
        inningHalf: state.inningHalf,
        mode: state.mode,
        runsScored: scored.length,
        scorerPlayerId: scorer?.type === "player" ? scorer.id : null,
        playerId: fielder?.playerId ?? null,
        opponentPlayerId: fielder?.opponentPlayerId ?? null,
      })
    );
    const label = eventType === "wild_pitch" ? "Wild Pitch" : eventType === "passed_ball" ? "Passed Ball" : "Balk";
    setSummaryFlash(`${label} — all runners advance${scored.length > 0 ? ` — ${scored.length} run${scored.length === 1 ? "" : "s"}` : ""}`);
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
    // Feature 2 (game-rules batch): computed from the PRE-dispatch
    // inning/half (an inning is "completed" once its bottom half ends --
    // ending a top half means the previous inning, not this one, was the
    // last one fully finished). Never blocks the dispatch below; this is
    // purely informational, per spec ("the operator always decides").
    const completedInnings = state.inningHalf === "bottom" ? state.inning : state.inning - 1;
    setInningEndBanner(checkInningEndBanner(gameRules, completedInnings, elapsedMs));

    dispatch({ type: "END_INNING_LOCAL" });
    const nextHalf = state.inningHalf === "top" ? "bottom" : "top";
    const nextInning = state.inningHalf === "bottom" ? state.inning + 1 : state.inning;
    const nextMode = correctModeForHalf(nextHalf);
    dispatch({ type: "SET_MODE", mode: nextMode });

    // Pitcher auto-default: nothing previously defaulted current_pitcher_id
    // to anyone, so a half-inning logged start to finish without ever
    // tapping the Pitcher Picker (a small, easy-to-miss "P: Select…" link)
    // left every one of its at-bats with pitcher_id null -- not a picker
    // bug (it always correctly wrote whatever was explicitly selected),
    // just nothing ever selected anything on its own. The lineup's own
    // position="P" starter is exactly who's actually pitching the instant
    // a half-inning flips to pitching mode, so default to them here. An
    // explicit mid-inning change still goes through the Pitcher Picker
    // completely unchanged, and always overrides this afterward.
    const defaultPitcher = nextMode === "pitching" ? liveLineup.find((l) => l.status === "starting" && l.position === "P") : null;
    if (defaultPitcher) dispatch({ type: "SET_PITCHER", playerId: defaultPitcher.player_id });

    void withOfflineRetry(`endinning-${game.id}-${Date.now()}`, () =>
      syncGameState(game.id, {
        inning: nextInning,
        inning_half: nextHalf,
        outs: 0,
        runners: {},
        current_at_bat_id: null,
        mode: nextMode,
        ...(defaultPitcher ? { current_pitcher_id: defaultPitcher.player_id, pitch_count_for_current_pitcher: 0 } : {}),
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
  type FlowStep = "pitch" | "field" | "hitType" | "result" | "hitRunners" | "fielding" | "groundOut" | "runnerConfirm";
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
          // Feature 1 (fielding-play logging batch): a plain groundball/
          // bunt groundout's Step 2-3 (where was the out made, was there
          // another out) block auto-confirm the same way "fielding" does
          // -- groundOutSubStep is only ever non-null for exactly that
          // case (see handlePrimaryFielderConfirmed).
          : groundOutSubStep !== null
            ? "groundOut"
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
  // Safety change (pre-main-merge): a play that appended an extra out
  // (double play, triple play, fielder's choice -- the one thing these
  // three share is a non-null secondAtBatId, set by APPEND_EXTRA_OUT)
  // can Undo-skip a batter, a known issue accepted for now rather than
  // fixed here. Narrowest possible mitigation: just don't offer Undo for
  // that specific play, so the broken path can't be taken -- Undo for
  // every other play, and Undo after the 3rd out, are untouched.
  const undoHasExtraOut = state.lastConfirmed !== null && state.lastConfirmed.secondAtBatId !== null;
  const undoActive = state.lastConfirmed !== null && undoRemaining > 0 && !state.currentAtBatId && !undoHasExtraOut;
  const undoBlockedForExtraOut = state.lastConfirmed !== null && undoRemaining > 0 && !state.currentAtBatId && undoHasExtraOut;

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
    | "runnerOutcome"
    | "buntOutcome"
    | "quickRunnerPrompt"
    | "runnerPicker"
    | "runnerAction"
    | "outReason"
    | "advanceReason"
    | "advanceError"
    | "flow"
    | "diamond";
  const FLOW_STEPS_IN_RIGHT_PANEL = new Set<FlowStep>(["field", "hitType", "result", "hitRunners", "fielding", "groundOut", "runnerConfirm"]);
  const rightPanelMode: RightPanelMode = dropThirdStep
    ? "dropThird"
    : wildPitchKPrompt
    ? "wildPitchK"
    : runnerOutcomeQueue.length > 0
    ? "runnerOutcome"
    : buntOutcomePrompt
      ? "buntOutcome"
      : quickRunnerPrompt
        ? "quickRunnerPrompt"
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
          {/* Bug fix (feature/lineup-drafts): which side bats is fully
              determined by home_away + inning_half, never a free choice
              -- the wrong mode's button is disabled rather than letting
              a tap put the game in an invalid state (which is how our
              own players ended up batting the top half of a home game).
              The auto-correct effect above already keeps state.mode in
              sync, so in practice only the correct button is ever
              enabled; disabled here too as the actual enforcement, not
              just a visual hint. */}
          {(["hitting", "pitching"] as const).map((m) => {
            const allowed = m === correctModeForHalf(state.inningHalf);
            return (
              <button
                key={m}
                disabled={!allowed}
                title={!allowed ? `${game.home_away === "home" ? "Home" : "Away"} team bats the ${state.inningHalf} half -- this mode isn't available right now.` : undefined}
                onClick={() => dispatch({ type: "SET_MODE", mode: m })}
                className={`min-h-[36px] rounded px-3 font-heading font-semibold uppercase tracking-wide transition disabled:cursor-not-allowed disabled:opacity-30 ${
                  state.mode === m
                    ? m === "hitting"
                      ? "bg-accent-green text-background"
                      : "bg-accent-amber text-background"
                    : "text-foreground/50"
                }`}
              >
                {m}
              </button>
            );
          })}
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
        {/* Opponent pitcher intelligence batch: tappable in hitting mode
            only -- opens a picker to set/correct who's actually pitching
            for them, since that's what now gets persisted onto
            at_bats.opponent_pitcher_id (see confirmAtBat/handleQuickPick).
            currentOpponentPitcher (operator-set) wins over
            opponentPitcherInfo (the static roster-position guess) once
            it's been picked. */}
        {state.mode === "hitting" ? (
          <button
            type="button"
            onClick={() => setOpponentPitcherPickerOpen(true)}
            className="truncate text-center font-mono text-[13px] text-foreground/60 underline decoration-dotted"
          >
            {(currentOpponentPitcher ?? opponentPitcherInfo)?.name ?? "OPP. PITCHER"}
            {/* Quick Mode scorekeeper batch: no pitch count in this mode
                (no pitches are ever logged to count) -- the pitcher's name
                still matters for opponent_pitcher_id attribution/picking. */}
            {game.logging_mode !== "quick" && <> · {state.opponentPitchCount} pitches</>}
          </button>
        ) : (
          <p className={`truncate text-center font-mono text-[13px] ${game.logging_mode === "quick" ? "text-foreground/60" : pitchCountColor}`}>
            {currentPitcher?.name ?? "—"}
            {game.logging_mode !== "quick" && <> · {state.pitchCountForCurrentPitcher} pitches</>}
          </p>
        )}

        <div className="flex items-center gap-2">
          {/* Feature 2 (game-rules batch): elapsed time, always shown once
              the game has started (which is always, by the time this
              screen renders); remaining time only when a limit is set,
              turning red inside the new-inning threshold as an ambient
              hint mirroring the End Inning banner below -- still never
              blocks anything. */}
          <span
            className={`font-mono text-[11px] ${
              remainingMs !== null && remainingMs / 60_000 <= gameRules.newInningThresholdMinutes ? "text-accent-red" : "text-foreground/50"
            }`}
            title="Game timer"
          >
            {formatElapsed(elapsedMs)}
            {remainingMs !== null && ` · ${formatElapsed(remainingMs)} left`}
          </span>

          {/* KAIROS batch, Tool 6: full mode only -- handleVoicePitch/
              handleVoiceAtBatResult are built around the pitch-by-pitch
              draft/confirm flow (ensureDraftAtBat, pickResult), which
              Quick Mode deliberately doesn't have at all. A voice
              equivalent for Quick Mode's flat outcome buttons would need
              its own, simpler parsing scheme this batch didn't build --
              flagged as out of scope rather than silently wired into a
              flow it doesn't match. */}
          {game.logging_mode !== "quick" && (
            <KairosVoiceButton gameId={game.id} disabled={state.outs >= 3} onConfirmPitch={handleVoicePitch} onConfirmAtBatResult={(input) => void handleVoiceAtBatResult(input)} />
          )}

          {/* Right-panel redesign: the floating B/S/O readout that used to
              live here is gone -- the scoreboard's own B/S/O line (right
              panel, Section 2) is now the only place those counts are
              shown, so this bar is just mode toggle + batter/pitcher info +
              the timer + the dashboard exit. */}
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
        {/* Loud-substitutions batch: replaces total silence (a permanent
            "game not active" rejection) or an indefinitely-retrying,
            unnamed "N syncing…" chip with a banner that names the
            substitution, says plainly whether a retry can help, and
            offers one when it can. Persists until retried/dismissed/
            superseded -- unlike summaryFlash, this never auto-clears,
            since an unsaved substitution isn't a "fyi," it's a problem
            that needs a decision. */}
        {chainSubError && (
          <div className="glossy pointer-events-auto flex min-h-[48px] w-full max-w-[380px] items-center gap-2 rounded-md border border-accent-red/50 bg-accent-red/15 px-3 py-2">
            <p className="flex-1 text-left text-xs font-semibold text-accent-red">{chainSubError.message}</p>
            {chainSubError.retryable && (
              <button
                type="button"
                onClick={chainSubError.retry}
                className="shrink-0 rounded bg-accent-red px-2 py-1 text-[11px] font-bold text-white"
              >
                Retry
              </button>
            )}
            <button
              type="button"
              onClick={() => setChainSubError(null)}
              aria-label="Dismiss"
              className="shrink-0 text-xs text-accent-red/70"
            >
              ✕
            </button>
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
        {/* Feature 2 (game-rules batch): shown after End Inning, per the
            three-way check in checkInningEndBanner -- purely
            informational (the spec is explicit the operator is never
            blocked), so it's just a dismissible strip, not a modal. */}
        {inningEndBanner && (
          <button
            onClick={() => setInningEndBanner(null)}
            className={`pointer-events-auto min-h-[36px] max-w-[380px] rounded-md px-3 py-1.5 text-left text-xs font-semibold shadow-lg ${
              inningEndBanner.kind === "next_inning_ok" ? "bg-accent-green text-background" : "bg-accent-red text-white"
            }`}
          >
            {inningEndBanner.message}
          </button>
        )}
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
        {/* LEFT PANEL. Quick Mode scorekeeper batch: Quick Mode's own
            lineup-strip + result-grid replaces the strike zone entirely,
            but the RIGHT PANEL below (batter card, scoreboard, on-deck,
            diamond, and every runner-action/sac-fly/squeeze/double-play/
            pickoff/substitution popup) is now IDENTICAL between the two
            modes -- previously that whole right panel only rendered
            inside this file's full-mode branch, which is why Quick Mode
            used to be "just a basic button grid" with none of that
            machinery reachable. Sharing it is what gives Quick Mode full
            baserunning/substitution/pickoff support for free instead of a
            second, parallel implementation. */}
        {game.logging_mode === "quick" ? (
          <QuickModeLeftPanel
            state={state}
            game={game}
            teamName={teamName}
            battingPlayerInfo={battingPlayerInfo}
            lineup={liveLineup}
            players={players}
            seasonBattingLines={seasonBattingLines}
            battedThisHalfInning={battedThisHalfInning}
            pendingChainSubIds={pendingChainSubIds}
            collapsed={lineupStripCollapsed}
            onToggleCollapsed={() => setLineupStripCollapsed((c) => !c)}
            onPick={startQuickPick}
            onStolenBase={() => setQuickRunnerPrompt("stolenBase")}
            onIbb={() => setIbbConfirmOpen(true)}
            onBunt={() => setBuntOutcomePrompt(true)}
            onWildPitch={() => handleQuickAllRunnersEvent("wild_pitch")}
            onPassedBall={() => handleQuickAllRunnersEvent("passed_ball")}
            onBalk={() => handleQuickAllRunnersEvent("balk")}
          />
        ) : (
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
        )}

        {/* RIGHT PANEL -- what happens after contact. p-1.5 (was p-2) --
            refinement pass, ~25% tighter, applied throughout this panel.
            Quick Mode scorekeeper batch: this whole panel, unchanged, now
            also renders for Quick Mode -- see the left-panel comment
            above. */}
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
                      {battingPlayerInfo?.position ?? "—"} · {battingHandBadge} · Batting {ordinal(state.battingOrderPosition)} of 9
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
              showBallsStrikes={game.logging_mode !== "quick"}
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

            {rightPanelMode === "runnerOutcome" && runnerOutcomeQueue[0] && state.runners[runnerOutcomeQueue[0]] && runnerOutcomeKind && (
              <RunnerOutcomePanel
                base={runnerOutcomeQueue[0]}
                runner={state.runners[runnerOutcomeQueue[0]]!}
                kind={runnerOutcomeKind}
                onDecide={(decision) => handleRunnerOutcomeDecision(runnerOutcomeQueue[0], decision)}
              />
            )}

            {rightPanelMode === "buntOutcome" && (
              <BuntOutcomePrompt onDecide={handleBuntOutcome} onCancel={() => setBuntOutcomePrompt(false)} />
            )}

            {rightPanelMode === "quickRunnerPrompt" && quickRunnerPrompt && (
              <div className="glossy w-full max-w-[320px] rounded-lg border border-accent-primary/50 bg-surface p-3 text-center">
                <p className="text-sm font-semibold text-white">Which runner stole a base?</p>
                <div className="mt-3 flex flex-col gap-2">
                  {(["third", "second", "first"] as Base[])
                    .filter((b) => state.runners[b])
                    .map((b) => (
                      <button
                        key={b}
                        onClick={() => handleQuickStolenBase(b)}
                        className="min-h-[44px] rounded-md border border-border px-3 text-left text-sm text-white hover:border-accent-primary"
                      >
                        {state.runners[b]!.name} ({b})
                      </button>
                    ))}
                </div>
                <button onClick={() => setQuickRunnerPrompt(null)} className="mt-3 text-xs text-foreground/40 hover:text-white">
                  Cancel
                </button>
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

            {/* Urgent mobile fixes, Fix 4: this used to render inline,
                centered in this panel -- which overflowed small phone
                screens since it was never anchored or boundary-checked.
                Moved to RunnerActionMenuPortal (below, near-identical
                technique to strike-zone-grid.tsx's PopupPortal), so it's
                omitted from this slot entirely now; nothing else needs
                to render here in its place, the portal floats on top
                regardless of what else the right panel is showing. */}
            {rightPanelMode === "runnerAction" && runnerActionMenu && state.runners[runnerActionMenu] && runnerActionAnchor && (
              <RunnerActionMenuPortal
                anchor={runnerActionAnchor}
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
                    setRunnerActionAnchor(null);
                    return;
                  }
                  if (a === "advance") {
                    setAdvanceReasonPrompt({ base: runnerActionMenu, runner: state.runners[runnerActionMenu]! });
                    setRunnerActionMenu(null);
                    setRunnerActionAnchor(null);
                    return;
                  }
                  applyRunnerAction(runnerActionMenu, a);
                }}
                onClose={() => {
                  setRunnerActionMenu(null);
                  setRunnerActionAnchor(null);
                }}
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
                showSacBunt={lastQuickPickWasSacBunt}
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
                    {/* Field-zone-validation batch: shown on both this step
                        and the result step below -- the field diagram
                        itself is only on screen for the instant of the tap
                        (flowStep jumps straight to hitType once
                        state.fieldTap is set), so the label needs to
                        persist through the rest of this at-bat's in-play
                        decisions to actually be seen. */}
                    {FIELD_ZONE_LABEL[fieldZone] && (
                      <p className="mb-2 text-center text-xs font-semibold text-accent-gold">{FIELD_ZONE_LABEL[fieldZone]}</p>
                    )}
                    <p className="mb-2 text-center text-xs uppercase tracking-wide text-foreground/40">What kind of hit?</p>
                    <div className="flex flex-wrap justify-center gap-2">
                      {(Object.keys(HIT_TYPE_LABELS) as HitType[])
                        // Outfield: "remove Bunt from hit type options" -- a
                        // bunt can't travel that far, so it's not a real
                        // choice out there.
                        .filter((ht) => !(fieldZone === "outfield" && ht === "bunt"))
                        .map((ht) => (
                          <button
                            key={ht}
                            onClick={() => handleHitTypeTap(ht)}
                            className={`min-h-[48px] rounded-full border-2 px-4 text-sm font-semibold text-white transition hover:bg-accent-primary/20 ${
                              // Home run zone: "auto-select HR" is a strong
                              // suggestion, not an auto-confirm -- HR already
                              // auto-skips straight to confirming once
                              // tapped (Fix 4), which would leave no real
                              // window to override; highlighting it here
                              // costs the operator nothing (still one tap,
                              // same as any other hit type) while keeping
                              // "operator can override if needed" genuinely
                              // true.
                              fieldZone === "homerun" && ht === "hr"
                                ? "border-accent-gold bg-accent-gold/10 shadow-[0_0_10px_rgba(240,192,96,0.4)]"
                                : "border-accent-primary"
                            }`}
                          >
                            {HIT_TYPE_LABELS[ht]}
                          </button>
                        ))}
                    </div>
                  </div>
                )}

                {flowStep === "result" && state.pendingHitType && (
                  <div className="w-full max-w-[320px]">
                    {FIELD_ZONE_LABEL[fieldZone] && (
                      <p className="mb-2 text-center text-xs font-semibold text-accent-gold">{FIELD_ZONE_LABEL[fieldZone]}</p>
                    )}
                    <p className="mb-2 text-center text-xs uppercase tracking-wide text-foreground/40">
                      {HIT_TYPE_LABELS[state.pendingHitType]} — result
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {/* Foul territory: "Foul Out / Error only," regardless
                          of hit type -- a foul ball can never become a hit,
                          so nothing HIT_TYPE_RESULT_OPTIONS would normally
                          offer applies. "Foul Out" isn't its own AtBatResult
                          in this schema (a caught foul ball is scored
                          exactly like a caught fly ball -- same out, same
                          box score effect), so this relabels the existing
                          "flyout" result rather than adding a new schema
                          value the request's own "no database changes"
                          note would've contradicted. */}
                      {fieldZone === "foul"
                        ? (["flyout", "error"] as AtBatResult[]).map((r) => (
                            <button
                              key={r}
                              onClick={() => pickResult(r)}
                              className="min-h-[48px] rounded-md border border-border bg-background px-2 text-sm font-medium text-foreground/70 transition hover:border-accent-gold hover:text-white"
                            >
                              {r === "flyout" ? "Foul Out" : RESULT_LABELS[r]}
                            </button>
                          ))
                        : HIT_TYPE_RESULT_OPTIONS[state.pendingHitType]
                            // Infield: "remove HR from result options" -- an
                            // infield hit physically can't clear the wall.
                            .filter((r) => !(fieldZone === "infield" && r === "hr"))
                            .map((r) => (
                              <button
                                key={r}
                                onClick={() => pickResult(r)}
                                className="min-h-[48px] rounded-md border border-border bg-background px-2 text-sm font-medium text-foreground/70 transition hover:border-accent-gold hover:text-white"
                              >
                                {/* Sacrifice-rules batch: the same
                                    underlying results (groundout/single/
                                    error) are relabeled in "how it
                                    ended" terms for a bunt -- see
                                    BUNT_RESULT_LABELS. */}
                                {state.pendingHitType === "bunt" ? BUNT_RESULT_LABELS[r] ?? RESULT_LABELS[r] : RESULT_LABELS[r]}
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
                  <FielderSuggestionPanel
                    title="Who made the play?"
                    suggestedPosition={suggestedFielderPosition}
                    onSelect={handlePrimaryFielderConfirmed}
                    resolve={resolve}
                  />
                )}

                {flowStep === "groundOut" && groundOutSubStep === "location" && (
                  <OutLocationPicker title="Where was the out made?" onSelect={handleGroundOutLocation} />
                )}

                {flowStep === "groundOut" && groundOutSubStep === "confirmFielder" && groundOutPendingBase && groundOutInitialFielder && (
                  <FielderSuggestionPanel
                    title={`Out at ${OUT_BASE_LABELS[groundOutPendingBase]} — who covered it?`}
                    suggestedPosition={
                      FIELDER_NUMBER_TO_POSITION[
                        standardCoveringFielder(groundOutPendingBase, FIELDING_POSITION_TO_NUMBER[groundOutInitialFielder.position])
                      ]
                    }
                    onSelect={handleGroundOutFielderConfirmed}
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
                  onBaseTap={(b, e) => {
                    if (state.runners[b]) {
                      setRunnerActionMenu(b);
                      setRunnerActionAnchor({
                        clientX: e.clientX,
                        clientY: e.clientY,
                        topHalf: e.clientY < window.innerHeight / 2,
                        leftHalf: e.clientX < window.innerWidth / 2,
                      });
                    } else {
                      setRunnerPicker(b);
                    }
                  }}
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
          {undoBlockedForExtraOut && <span className="text-[11px] text-accent-amber">To fix this play, tell the coach.</span>}
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

      {/* Implicit-FC batch: "Was the batter put out?" -- a plain modal
          (not anchored to a tap point, same treatment the other
          full-screen wizards here get), replacing the old "which runner
          was put out, or No one out" wizard. "Out at First" resumes the
          plain groundout flow; "Safe" opens the per-runner queue that
          derives a fielder's choice (or nothing) -- see
          resolveGroundOutBatterPrompt/beginImplicitFcFlow. */}
      {groundOutBatterPromptOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-5 text-center">
            <h3 className="font-heading text-lg font-bold text-white">Was the batter put out?</h3>
            <div className="mt-4 flex flex-col gap-2">
              <button
                onClick={() => resolveGroundOutBatterPrompt(true)}
                className="min-h-[44px] rounded-md bg-accent-primary px-3 text-sm font-semibold text-white"
              >
                Out at First
              </button>
              <button
                onClick={() => resolveGroundOutBatterPrompt(false)}
                className="min-h-[44px] rounded-md border border-border px-3 text-sm font-medium text-white hover:border-accent-primary"
              >
                Safe
              </button>
            </div>
          </div>
        </div>
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

      {opponentPitcherPickerOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-xs rounded-lg border border-border bg-surface p-4">
            <p className="mb-2 text-xs uppercase tracking-wide text-foreground/40">Who&apos;s pitching for them?</p>
            <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
              {opponentPlayers.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    dispatch({ type: "SET_OPPONENT_PITCHER", opponentPlayerId: p.id });
                    void withOfflineRetry(`oppitcher-${game.id}-${Date.now()}`, () =>
                      syncGameState(game.id, { current_opponent_pitcher_id: p.id })
                    );
                    setOpponentPitcherPickerOpen(false);
                  }}
                  className="rounded-md border border-border px-3 py-2 text-left text-sm text-white hover:border-accent-primary"
                >
                  #{p.jersey_number ?? "—"} {p.name}
                  {p.position === "P" && <span className="ml-2 text-[11px] text-accent-green">(roster: P)</span>}
                </button>
              ))}
              {opponentPlayers.length === 0 && (
                <p className="px-1 text-xs text-foreground/40">No opponent roster imported for this game yet.</p>
              )}
            </div>
            <button onClick={() => setOpponentPitcherPickerOpen(false)} className="mt-3 w-full text-xs text-foreground/50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {state.substitutionPanelOpen && (
        <ChainSubstitutionModal
          players={players}
          currentDefense={currentDefense}
          benchPlayerIds={benchPlayerIds}
          fieldPositionsCalibration={fieldPositionsCalibration}
          inning={state.inning}
          outs={state.outs}
          onClose={() => dispatch({ type: "SET_PANEL", panel: "substitution", open: false })}
          onResolved={handleChainResolved}
          onOpenLateArrival={() => {
            dispatch({ type: "SET_PANEL", panel: "substitution", open: false });
            setLateArrivalOpen(true);
          }}
        />
      )}

      {lateArrivalOpen && (
        <LateArrivalPanel absentPlayers={absentPlayers} onLateArrival={handleLateArrival} onClose={() => setLateArrivalOpen(false)} />
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
          message={`Intentional walk — ${
            state.mode === "hitting" ? battingPlayerInfo?.name ?? "Batter" : state.opponentBatterName || "the batter"
          } awarded 1st base?`}
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
          // Bug 2 fix (fix/dp-fc follow-up): this modal is a fixed,
          // z-[60] full-screen overlay -- the bottom bar's own Undo
          // button (z-10) is completely covered by it the instant outs
          // hits 3, with no way past it except End Inning. undoActive/
          // undoRemaining/handleUndo are unchanged; this just gives the
          // same control a second, reachable home for as long as the
          // 30s window (or state.lastConfirmed) is still open.
          undoActive={undoActive}
          undoRemaining={undoRemaining}
          onUndo={handleUndo}
          undoBlockedForExtraOut={undoBlockedForExtraOut}
        />
      )}

      {/* Urgent mobile fixes, Fix 5. */}
      {pendingFieldTapPick && <QuickFieldTapModal label={pendingFieldTapPick.label} onTap={resolveQuickFieldTap} onSkip={skipQuickFieldTap} />}
    </div>
  );
}

// Urgent mobile fixes, Fix 5: a lighter-weight version of Full Mode's
// own field-tap step -- one FieldDiagram (same field-2d.png component,
// same 0-100 tap math, so this builds the exact same spray-chart data),
// a Skip button for "too fast to see" or "don't know," and nothing
// else. Quick Mode never asks for hit type/fielding credit the way
// Full Mode does -- this is deliberately just the one piece (location)
// the request asked for.
function QuickFieldTapModal({ label, onTap, onSkip }: { label: string; onTap: (x: number, y: number) => void; onSkip: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#030A06]/95 p-4">
      <div className="glossy w-full max-w-sm rounded-lg border border-accent-primary/50 bg-card p-4 text-center">
        <p className="font-heading text-lg font-bold text-white">{label} — where did it land?</p>
        <p className="mt-1 text-xs text-foreground/50">Tap the spot on the field, or skip if you&apos;re not sure.</p>
        <div className="mt-3 flex justify-center">
          <FieldDiagram tap={null} onTap={onTap} />
        </div>
        <button
          type="button"
          onClick={onSkip}
          className="mt-3 min-h-[48px] w-full rounded-md border border-border text-sm font-medium text-foreground/70 hover:border-accent-primary hover:text-white"
        >
          Skip
        </button>
      </div>
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

// Quick Mode scorekeeper batch: the whole left panel when
// game.logging_mode === "quick" -- lineup strip on top, the expanded
// result grid, then the Quick-Mode-only special-play buttons (Double
// Play / Stolen Base / IBB / Wild Pitch / Passed Ball / Balk -- Pickoff
// and Substitution stay where they already were, in the shared right
// panel's Section 5). Everything about baserunning/scoring itself
// (diamond, sac-fly/squeeze prompts, runner-action menus) lives in the
// shared right panel this component's sibling renders -- see the
// caller's own comment on why that panel is no longer full-mode-only.
function QuickModeLeftPanel({
  state,
  game,
  teamName,
  battingPlayerInfo,
  lineup,
  players,
  seasonBattingLines,
  battedThisHalfInning,
  pendingChainSubIds,
  collapsed,
  onToggleCollapsed,
  onPick,
  onStolenBase,
  onIbb,
  onBunt,
  onWildPitch,
  onPassedBall,
  onBalk,
}: {
  state: OperatorState;
  game: Game;
  teamName: string;
  battingPlayerInfo: Player | undefined;
  lineup: Lineup[];
  players: Player[];
  seasonBattingLines: Record<string, BattingLine>;
  battedThisHalfInning: Set<number>;
  // Loud-substitutions batch: player ids whose lineup row is mid-save
  // (a chain substitution awaiting confirmChainSubstitution) -- shown
  // as "Saving…" in place of their usual on-deck/at-bat/done markers,
  // so the strip never implies a swap has landed before it actually has.
  pendingChainSubIds: Set<string>;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onPick: (def: QuickModeButtonDef) => void;
  onStolenBase: () => void;
  onIbb: () => void;
  onBunt: () => void;
  onWildPitch: () => void;
  onPassedBall: () => void;
  onBalk: () => void;
}) {
  const anyRunnerOnBase = Boolean(state.runners.first || state.runners.second || state.runners.third);
  // batting_order is nullable (bench/reserve players aren't in it) -- the
  // lineup strip only ever shows the 9 real batting slots.
  const slots = lineup.filter((l): l is Lineup & { batting_order: number } => l.batting_order !== null).sort((a, b) => a.batting_order - b.batting_order);
  // Fix (batting-order gap bug): shares nextBattingOrderPosition with
  // the reducer and the on-deck panel instead of a third, hand-rolled
  // `(position % 9) + 1` that assumed a dense 1-9 lineup -- this is
  // what used to mark the wrong row "ON DECK" (or no row at all) once a
  // lineup had a gap in its batting_order numbers.
  const nextBattingOrder = nextBattingOrderPosition(slots.map((s) => s.batting_order), state.battingOrderPosition);
  // Launch-audit Fix 9: a one-tap glossary for the standard-scorekeeping
  // abbreviations (K/Kl/BB/HBP/FC/SAC) the Quick Mode buttons use with
  // no other in-product explanation. An inline expand block, not an
  // absolutely-positioned popup -- this panel's own wrapper below is
  // overflow-hidden, which would silently clip a floating popover the
  // same way an earlier batch's strike-zone popup was clipped before it
  // got portaled out; a push-down block has no such risk and still
  // satisfies "one tap to open, one tap to close, doesn't interrupt
  // logging."
  const [showGlossary, setShowGlossary] = useState(false);

  return (
    <div className="flex flex-col overflow-hidden border-b border-border p-2 md:border-b-0 md:border-r">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <p className="text-[15px] uppercase tracking-[0.08em] text-[#7AB893]">Quick Mode — scorekeeper</p>
          <button
            type="button"
            onClick={() => setShowGlossary((s) => !s)}
            title="What do these abbreviations mean?"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-[11px] font-bold text-foreground/50 hover:border-accent-primary hover:text-white"
          >
            ?
          </button>
        </div>
        {/* Urgent mobile fixes, Fix 6: the batter name used to share one
            11px line with the inning/outs info -- split so the name
            itself can hit the requested 24px minimum without also
            blowing up the smaller supporting info next to it. */}
        <div className="text-right">
          <p className="font-heading text-[24px] font-bold leading-tight text-white">
            {state.mode === "hitting"
              ? `#${battingPlayerInfo?.jersey_number ?? "—"} ${battingPlayerInfo?.name ?? "Batter"}`
              : state.opponentBatterName || "Opposing batter"}
          </p>
          <p className="text-[11px] text-foreground/50">
            {state.inningHalf.toUpperCase()} {state.inning} · {state.outs} out{state.outs === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      {showGlossary && (
        <div className="mt-1.5 shrink-0 rounded-md border border-border bg-surface/60 p-2 text-[11px] text-foreground/70">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
            <dt className="font-semibold text-white">K</dt>
            <dd>Strikeout swinging</dd>
            <dt className="font-semibold text-white">Kl</dt>
            <dd>Strikeout looking</dd>
            <dt className="font-semibold text-white">BB</dt>
            <dd>Walk (base on balls)</dd>
            <dt className="font-semibold text-white">HBP</dt>
            <dd>Hit by pitch</dd>
            <dt className="font-semibold text-white">SF</dt>
            <dd>Sacrifice fly — a run scored on a fly/line/foul out</dd>
            <dt className="font-semibold text-white">SH</dt>
            <dd>Sacrifice bunt — a runner moved up on a bunt out, nobody out</dd>
          </dl>
          <p className="mt-1.5 text-foreground/50">
            Fly Out, Line Out, Foul Out, and Bunt ask what happened to any runner on base (outs below 2) and mark SF/SH
            on the scorebook automatically -- never a button you tap yourself.
          </p>
          <p className="mt-1.5 text-foreground/50">
            There&apos;s no FC button either: a Ground Out (or a bunt) where the batter is safe and a runner is put
            out is counted as a fielder&apos;s choice automatically.
          </p>
        </div>
      )}

      {/* Batting order / lineup strip -- collapsible, current batter
          highlighted, next batter marked "on deck," already-batted-this-
          half-inning slots marked done. Hitting mode only -- opponent
          batters (mode === "pitching") have no lineup/batting-order
          concept here, same as the on-deck strip in the shared right
          panel. */}
      {state.mode === "hitting" && (
        <div className="mt-2 shrink-0 rounded-md border border-border bg-surface/60">
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="flex min-h-[36px] w-full items-center justify-between px-2 text-xs font-semibold uppercase tracking-wide text-foreground/60"
          >
            Lineup
            <span>{collapsed ? "▾" : "▴"}</span>
          </button>
          {!collapsed && (
            <div className="max-h-[140px] overflow-y-auto px-2 pb-2">
              {slots.map((slot) => {
                const p = players.find((pl) => pl.id === slot.player_id);
                const isCurrent = slot.batting_order === state.battingOrderPosition;
                const isOnDeck = !isCurrent && slot.batting_order === nextBattingOrder;
                const done = battedThisHalfInning.has(slot.batting_order) && !isCurrent;
                const isSaving = pendingChainSubIds.has(slot.player_id);
                const line = p ? seasonBattingLines[p.id] : undefined;
                return (
                  <div
                    key={slot.id}
                    className={`flex items-center gap-2 rounded px-1.5 py-1 text-xs ${
                      isSaving
                        ? "bg-accent-amber/10 text-accent-amber opacity-70"
                        : isCurrent
                          ? "bg-accent-green/15 text-white"
                          : isOnDeck
                            ? "bg-accent-primary/10 text-white"
                            : "text-foreground/60"
                    }`}
                  >
                    <span className="w-4 shrink-0 text-right font-mono text-foreground/40">{slot.batting_order}</span>
                    <span className="w-6 shrink-0 font-mono">#{p?.jersey_number ?? "—"}</span>
                    <span className="min-w-0 flex-1 truncate">{p?.name ?? "—"}</span>
                    {/* Loud-substitutions batch: while a chain substitution
                        involving this player is mid-save, replace every
                        other marker with a plain "Saving…" -- there's
                        nothing else worth showing about a row whose real
                        state is still in flight. */}
                    {isSaving ? (
                      <span className="shrink-0 text-[10px] font-bold text-accent-amber">Saving…</span>
                    ) : (
                      <>
                        {line && <span className="shrink-0 font-mono text-[10px] text-foreground/40">{formatAvg(line.avg)}</span>}
                        {isCurrent && <span className="shrink-0 text-[10px] font-bold text-accent-green">AT BAT</span>}
                        {isOnDeck && <span className="shrink-0 text-[10px] font-bold text-accent-primary">ON DECK</span>}
                        {done && <span className="shrink-0 text-accent-green">✓</span>}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="mt-2 flex-1 overflow-y-auto pb-2">
        {/* Urgent mobile fixes, Fix 1: a dense 4x4 grid of the most
            common outcomes (including Double Play/IBB, which used to
            live further down the page) so a phone screen shows every
            common play with no scrolling. Less common actions move to
            a small "More" strip right below it -- still on this same
            screen, just not in the primary no-scroll view. */}
        <div className="sm:hidden">
          <MobileQuickModeGrid
            onPick={onPick}
            onIbb={onIbb}
            onBunt={onBunt}
            disabled={state.outs >= 3}
            runners={state.runners}
            outs={state.outs}
          />
          <p className="mb-1 mt-3 text-[10px] font-semibold uppercase tracking-wide text-foreground/40">More</p>
          <div className="flex flex-wrap gap-3">
            <QuickButton
              label="Foul Out"
              onClick={() => onPick({ label: "Foul Out", result: "flyout", hitType: null, scorebookNotation: "Foul Out" })}
              disabled={state.outs >= 3}
              className="flex-1"
            />
            <QuickButton label="Stolen Base" onClick={onStolenBase} disabled={!anyRunnerOnBase} className="flex-1" />
            <QuickButton label="Wild Pitch" onClick={onWildPitch} disabled={!anyRunnerOnBase} className="flex-1" />
            <QuickButton label="Passed Ball" onClick={onPassedBall} disabled={!anyRunnerOnBase} className="flex-1" />
            <QuickButton label="Balk" onClick={onBalk} disabled={!anyRunnerOnBase} className="flex-1" />
          </div>
        </div>

        {/* Desktop/tablet: unchanged from before this batch. */}
        <div className="hidden sm:block">
          <QuickModeGrid onPick={onPick} onBunt={onBunt} disabled={state.outs >= 3} runners={state.runners} outs={state.outs} />

          <p className="mb-1 mt-3 text-[10px] font-semibold uppercase tracking-wide text-foreground/40">Special plays</p>
          <div className="flex flex-wrap gap-2">
            <QuickButton label="Stolen Base" onClick={onStolenBase} disabled={!anyRunnerOnBase} className="flex-1" />
            <QuickButton label="IBB" onClick={onIbb} disabled={state.outs >= 3} className="flex-1" />
            <QuickButton label="Wild Pitch" onClick={onWildPitch} disabled={!anyRunnerOnBase} className="flex-1" />
            <QuickButton label="Passed Ball" onClick={onPassedBall} disabled={!anyRunnerOnBase} className="flex-1" />
            <QuickButton label="Balk" onClick={onBalk} disabled={!anyRunnerOnBase} className="flex-1" />
          </div>
        </div>
      </div>

      <p className="shrink-0 text-center text-[11px] text-foreground/40">
        {teamName} {state.ourScore} – {game.opponent_name} {state.opponentScore}
      </p>
    </div>
  );
}

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
function QuickButton({
  label,
  onClick,
  disabled = false,
  className = "",
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      // Urgent mobile fixes, Fix 6: 48px minimum on mobile (h-12); the
      // existing h-10 (40px) compact-footer sizing -- a deliberate
      // exception to this app's usual 48px tap-target rule, see the
      // Pickoff/Substitution row's own history -- still applies from
      // the sm breakpoint up, unchanged.
      className={`h-12 sm:h-10 rounded-md border border-border bg-surface px-3 text-sm font-medium text-foreground/80 hover:border-accent-primary hover:text-white disabled:cursor-not-allowed disabled:opacity-30 ${className}`}
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
// Urgent mobile fixes, Fix 4. Same technique as strike-zone-grid.tsx's
// PopupPortal: portaled straight to <body>, position: fixed in real
// viewport pixels, anchored on whichever side of the tap point keeps
// it on-screen (below/above by topHalf, left/right-anchored by
// leftHalf), then a post-render getBoundingClientRect() check nudges it
// back in if it still overflows -- a pure CSS quadrant guess can't know
// the menu's actual rendered size, only measuring it after paint can
// guarantee "always fully visible." 16px margin per spec (strike-zone's
// own popup used 8px for a smaller popup; this one asked for 16px
// explicitly).
function RunnerActionMenuPortal({
  anchor,
  base,
  runner,
  onAction,
  onClose,
}: {
  anchor: { clientX: number; clientY: number; topHalf: boolean; leftHalf: boolean };
  base: Base;
  runner: RunnerState;
  onAction: (action: RunnerQuickAction) => void;
  onClose: () => void;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  const [nudge, setNudge] = useState({ dx: 0, dy: 0 });

  useLayoutEffect(() => {
    setNudge({ dx: 0, dy: 0 });
    const el = popupRef.current;
    if (!el) return;
    const margin = 16;
    const rect = el.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    if (rect.left < margin) dx = margin - rect.left;
    else if (rect.right > window.innerWidth - margin) dx = window.innerWidth - margin - rect.right;
    if (rect.top < margin) dy = margin - rect.top;
    else if (rect.bottom > window.innerHeight - margin) dy = window.innerHeight - margin - rect.bottom;
    if (dx !== 0 || dy !== 0) setNudge({ dx, dy });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor.clientX, anchor.clientY, anchor.topHalf, anchor.leftHalf]);

  if (typeof document === "undefined") return null;

  const gap = 8;
  const baseTransform = `translate(${anchor.leftHalf ? "0" : "-100%"}, ${anchor.topHalf ? `${gap}px` : `calc(-100% - ${gap}px)`})`;

  return createPortal(
    <div
      ref={popupRef}
      className="fixed z-50"
      style={{
        left: anchor.clientX,
        top: anchor.clientY,
        transform: `${baseTransform} translate(${nudge.dx}px, ${nudge.dy}px)`,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <RunnerQuickActionMenu base={base} runner={runner} onAction={onAction} onClose={onClose} />
    </div>,
    document.body
  );
}

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

// Sacrifice-rules batch: one runner at a time from runnerOutcomeQueue,
// top base first -- replaces SacFlyPanel (fly/line/foul outs only) and
// the standalone squeeze-play yes/no prompt (bunts only, third base
// only) with the one shared "Scored, Advanced, Stayed, Out" question the
// spec asks for, labeled per kind. "Advanced" is omitted for a runner on
// third -- there's no base beyond third to advance to without scoring.
function RunnerOutcomePanel({
  base,
  runner,
  kind,
  onDecide,
}: {
  base: Base;
  runner: RunnerState;
  kind: "fly" | "bunt" | "ground" | "groundSafe";
  onDecide: (decision: "scored" | "advanced" | "stayed" | "out") => void;
}) {
  const nextBase = NEXT_BASE[base];
  const prompt =
    kind === "fly"
      ? "was on {base} when the ball was caught -- what happened?"
      : kind === "bunt"
        ? "was on {base} on the bunt -- what happened?"
        : "was on {base} on the ground ball -- what happened?";
  // fix/dp-fc: "ground" never labels Scored as a sacrifice (a productive
  // groundout is just a normal RBI, not a sac fly/squeeze/sac bunt) and
  // never labels Out as a tag-up violation (a force out on a ground
  // ball, never a tag play) -- see resolveBattedBallPlay/
  // finalizeRunnerOutcomeQueue for how those two decisions actually get
  // applied once the whole queue drains.
  const scoredLabel = kind === "fly" ? "sacrifice fly" : kind === "bunt" ? (base === "third" ? "squeeze play" : "sacrifice bunt") : null;
  return (
    <div className="glossy w-full max-w-[320px] rounded-lg border border-accent-amber/50 bg-accent-amber/10 p-3">
      <p className="text-xs text-accent-amber">
        {runner.name} {prompt.replace("{base}", base)}
      </p>
      <div className="mt-2 flex flex-col gap-1.5">
        <button
          onClick={() => onDecide("scored")}
          className="min-h-[44px] rounded-md border border-accent-green/60 px-3 text-left text-sm font-medium text-white hover:bg-accent-green/20"
        >
          Scored — RBI{scoredLabel ? ` (${scoredLabel})` : ""}
        </button>
        {nextBase && (
          <button
            onClick={() => onDecide("advanced")}
            className="min-h-[44px] rounded-md border border-border px-3 text-left text-sm font-medium text-white hover:border-accent-primary"
          >
            Advanced to {nextBase}
          </button>
        )}
        <button
          onClick={() => onDecide("stayed")}
          className="min-h-[44px] rounded-md border border-border px-3 text-left text-sm font-medium text-white hover:border-accent-primary"
        >
          Stayed at {base}
        </button>
        <button
          onClick={() => onDecide("out")}
          className="min-h-[44px] rounded-md border border-accent-red/60 px-3 text-left text-sm font-medium text-white hover:bg-accent-red/20"
        >
          Out{kind === "fly" ? " — left early (tag-up violation)" : ""}
        </button>
      </div>
    </div>
  );
}

// Sacrifice-rules batch: the new standalone Quick Mode "Bunt" button's
// first question -- how did the play end. "Out at First" is the only
// outcome that can go on to become a sacrifice bunt (via
// runnerOutcomeQueue); the other three always record normally with
// hitType "bunt" and are never sacrifices, per spec.
function BuntOutcomePrompt({
  onDecide,
  onCancel,
}: {
  onDecide: (outcome: "out_at_first" | "safe" | "error") => void;
  onCancel: () => void;
}) {
  return (
    <div className="glossy w-full max-w-[320px] rounded-lg border border-accent-amber/50 bg-accent-amber/10 p-3">
      <p className="text-sm font-semibold text-white">Bunt — how did it end?</p>
      <div className="mt-2 flex flex-col gap-1.5">
        <button
          onClick={() => onDecide("out_at_first")}
          className="min-h-[44px] rounded-md border border-border px-3 text-left text-sm font-medium text-white hover:border-accent-primary"
        >
          Out at First
        </button>
        <button
          onClick={() => onDecide("safe")}
          className="min-h-[44px] rounded-md border border-border px-3 text-left text-sm font-medium text-white hover:border-accent-primary"
        >
          Safe
        </button>
        <button
          onClick={() => onDecide("error")}
          className="min-h-[44px] rounded-md border border-border px-3 text-left text-sm font-medium text-white hover:border-accent-primary"
        >
          Error
        </button>
      </div>
      <button onClick={onCancel} className="mt-3 text-xs text-foreground/40 hover:text-white">
        Cancel
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

// Bug fix (feature/lineup-drafts): "Sac Bunt" was missing entirely --
// the only one of these 7 that actually described what happened when a
// runner advanced off the Sac Bunt button was "Passed on Hit" (the
// generic catch-all), which is why it looked like "the only choice."
// Listed first (not appended last) so it's the most visible option
// right when it's actually relevant -- see showSacBunt below for when
// that is.
const ADVANCE_REASONS: { value: AdvanceReason; label: string }[] = [
  { value: "sac_bunt", label: "Sac Bunt" },
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
  showSacBunt,
  onSelect,
  onClose,
}: {
  base: Base;
  runner: RunnerState;
  // Bug fix (feature/lineup-drafts): "the right reasons for the play" --
  // Sac Bunt only makes sense as a reason immediately after an actual
  // Sac Bunt was just logged (lastQuickPickWasSacBunt in
  // operator-console.tsx), not permanently alongside the other 6
  // context-free reasons. The other 6 keep their existing always-shown
  // behavior -- narrowing those too would be a much bigger change than
  // this fix asked for.
  showSacBunt: boolean;
  onSelect: (reason: AdvanceReason) => void;
  onClose: () => void;
}) {
  const reasons = showSacBunt ? ADVANCE_REASONS : ADVANCE_REASONS.filter((r) => r.value !== "sac_bunt");
  return (
    <div className="glossy w-full min-w-[200px] max-w-xs rounded-md border border-accent-primary/40 bg-background p-3">
      <p className="mb-2 text-xs text-foreground/50">
        {runner.jersey ? `#${runner.jersey} ` : ""}
        {runner.name} on {base} advances — why?
      </p>
      <div className="grid grid-cols-2 gap-2">
        {reasons.map((r) => (
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

// Feature 1 (fielding-play logging batch): wraps FieldingPositionPicker
// with an auto-suggested confirm/change step, reused for both Step 1
// ("who made the play?" -- suggested from the field-tap zone) and the
// ground-out flow's "who covered this base?" (suggested from the
// standard-coverage table). `suggestedPosition` null means either no
// field tap yet or no field calibration saved for this team -- both real
// states, so this falls back to the plain, unsuggested picker rather than
// showing a suggestion card with nothing to suggest.
function FielderSuggestionPanel({
  title,
  suggestedPosition,
  resolve,
  onSelect,
}: {
  title: string;
  suggestedPosition: FieldingPosition | null;
  resolve: (position: FieldingPosition) => ResolvedFielder;
  onSelect: (fielder: ResolvedFielder) => void;
}) {
  const [changing, setChanging] = useState(false);
  if (!suggestedPosition || changing) {
    return <FieldingPositionPicker title={changing ? "Pick the fielder" : title} onSelect={onSelect} resolve={resolve} />;
  }
  const suggested = resolve(suggestedPosition);
  return (
    <div className="w-full max-w-[320px] rounded-lg border border-accent-gold/40 bg-surface p-3 text-center">
      <p className="text-xs uppercase tracking-wide text-foreground/40">{title}</p>
      <p className="font-heading mt-2 text-xl font-bold text-white">
        {suggestedPosition} — {suggested.name}?
      </p>
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => onSelect(suggested)}
          className="min-h-[44px] flex-1 rounded-md bg-accent-primary px-3 text-sm font-semibold text-white"
        >
          Confirm
        </button>
        <button
          onClick={() => setChanging(true)}
          className="min-h-[44px] flex-1 rounded-md border border-border px-3 text-sm font-medium text-foreground/70"
        >
          Change
        </button>
      </div>
    </div>
  );
}

// Feature 1: Step 2/3/4's "where was the out made?" -- every base plus
// "Tag" for a tag out away from a base, per spec.
function OutLocationPicker({ title, onSelect }: { title: string; onSelect: (base: OutBase) => void }) {
  const bases: OutBase[] = ["first", "second", "third", "home", "tag"];
  return (
    <div className="w-full max-w-[320px] rounded-lg border border-border bg-surface p-3">
      <p className="mb-2 text-center text-xs uppercase tracking-wide text-foreground/40">{title}</p>
      <div className="grid grid-cols-2 gap-2">
        {bases.map((b) => (
          <button
            key={b}
            onClick={() => onSelect(b)}
            className="min-h-[48px] rounded-md border border-border bg-background px-2 text-sm font-medium text-white hover:border-accent-gold"
          >
            {OUT_BASE_LABELS[b]}
          </button>
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
  undoActive,
  undoRemaining,
  onUndo,
  undoBlockedForExtraOut,
}: {
  hits: number;
  runs: number;
  errors: number;
  onEndInning: () => void;
  // Bug 2 fix (fix/dp-fc follow-up): a mistake on the very last out
  // (the one that just ended the half-inning) used to be unfixable --
  // this full-screen overlay has no way past it except End Inning, and
  // the bottom bar's own Undo lives underneath it, unreachable. Same
  // undoActive/undoRemaining the bottom bar already computes; onUndo is
  // the same handleUndo.
  undoActive: boolean;
  undoRemaining: number;
  onUndo: () => void;
  // Safety change (pre-main-merge): same undoBlockedForExtraOut the
  // bottom bar computes -- this modal's own Undo button needs the same
  // "not for a double/triple play or fielder's choice" restriction, or
  // the 3rd-out overlay would reopen the exact skip-a-batter path the
  // bottom bar was just closed off from.
  undoBlockedForExtraOut: boolean;
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
        {undoActive && (
          <button
            onClick={onUndo}
            className="mt-4 w-full min-h-[48px] rounded-md border border-accent-amber px-4 text-sm font-semibold text-accent-amber"
          >
            Undo last play ({Math.ceil(undoRemaining / 1000)}s)
          </button>
        )}
        {undoBlockedForExtraOut && <p className="mt-4 text-xs text-accent-amber">To fix this play, tell the coach.</p>}
        <button
          onClick={onEndInning}
          className="mt-3 w-full min-h-[48px] rounded-md bg-accent-green px-4 text-base font-semibold text-background"
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
