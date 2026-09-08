"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Database, PitchOutcome, PitchType, RunnerState } from "@/lib/supabase/types";
import { operatorReducer, UNDO_WINDOW_MS, advanceAllRunnersOneBase } from "@/lib/operator/reducer";
import { RESULT_BUTTON_ORDER, RESULT_IS_OUT, RESULT_LABELS, PITCH_TYPE_LABELS, HIT_TYPE_LABELS } from "@/lib/operator/types";
import { atBatAccuracyRatio, LOW_ACCURACY_THRESHOLD } from "@/lib/pitch-accuracy";
import { loadOperatorStateLocal, saveOperatorStateLocal } from "@/lib/operator/local-storage";
import { withOfflineRetry, onQueueChange, pendingCount } from "@/lib/operator/sync-queue";
import { buildInitialStateFromServer } from "./initial-state";
import {
  confirmAtBat,
  logGameEvent,
  logPitch,
  logStolenBase,
  saveSubstitution,
  startDraftAtBat,
  syncGameState,
  undoAtBat,
} from "./actions";
import { StrikeZoneGrid } from "./strike-zone-grid";
import { FieldDiagram } from "./field-diagram";
import { BaserunnerDiamond } from "./baserunner-diamond";
import { SubstitutionPanel } from "./substitution-panel";
import { PitchCountModal } from "./pitch-count-modal";
import { PostGameSummary } from "./post-game-summary";

type Game = Database["public"]["Tables"]["games"]["Row"];
type Player = Database["public"]["Tables"]["players"]["Row"];
type Lineup = Database["public"]["Tables"]["lineup"]["Row"];
type GameState = Database["public"]["Tables"]["game_state"]["Row"];
type AtBat = Database["public"]["Tables"]["at_bats"]["Row"];
type Pitch = Database["public"]["Tables"]["pitches"]["Row"];
type OpponentPlayer = Database["public"]["Tables"]["opponent_players"]["Row"];

const PITCH_TYPES: PitchType[] = ["fastball", "curveball", "changeup", "slider", "2seam", "other"];
const BASES = ["first", "second", "third"] as const;

export function OperatorConsole({
  game,
  players,
  lineup,
  initialGameState,
  draftAtBat,
  opponentPlayers,
}: {
  game: Game;
  players: Player[];
  lineup: Lineup[];
  initialGameState: GameState;
  draftAtBat: (AtBat & { pitches: Pitch[] }) | null;
  opponentPlayers: OpponentPlayer[];
}) {
  const [state, dispatch] = useReducer(operatorReducer, undefined, () => {
    const local = loadOperatorStateLocal(game.id);
    if (local && local.dirty) return local;
    return buildInitialStateFromServer(game, initialGameState, draftAtBat);
  });

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
  const [runnerPicker, setRunnerPicker] = useState<(typeof BASES)[number] | null>(null);
  const [stolenBasePicker, setStolenBasePicker] = useState(false);
  const [pitcherPickerOpen, setPitcherPickerOpen] = useState(false);

  const battingPlayer = useMemo(
    () => (state.mode === "hitting" ? lineup.find((l) => l.batting_order === state.battingOrderPosition) : undefined),
    [lineup, state.mode, state.battingOrderPosition]
  );
  const battingPlayerInfo = useMemo(
    () => (battingPlayer ? players.find((p) => p.id === battingPlayer.player_id) : undefined),
    [battingPlayer, players]
  );
  const currentPitcher = useMemo(
    () => players.find((p) => p.id === state.currentPitcherId),
    [players, state.currentPitcherId]
  );

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

  async function handlePitchOutcome(outcome: PitchOutcome) {
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
    dispatch({ type: "LOG_PITCH_LOCAL", outcome });
    void withOfflineRetry(`pitch-${atBatId}-${pitchNumber}`, () =>
      logPitch({
        gameId: game.id,
        atBatId,
        pitchNumber,
        pitchType,
        zoneX: zone?.x ?? null,
        zoneY: zone?.y ?? null,
        outcome,
        isPitchingMode: state.mode === "pitching",
      })
    );
  }

  async function handleConfirm() {
    const result = state.suggestedResult;
    const atBatId = state.currentAtBatId;
    if (!result || !atBatId) return;
    const isOut = RESULT_IS_OUT[result];
    const runsScored = state.pendingRunsScored;
    const wasLow = atBatAccuracyRatio(result, state.pendingPitches.length) < LOW_ACCURACY_THRESHOLD;
    const hitType = state.pendingHitType;
    const fieldX = state.fieldTap?.x ?? null;
    const fieldY = state.fieldTap?.y ?? null;
    const rbi = state.pendingRbi;
    const mode = state.mode;

    dispatch({ type: "CONFIRM_LOCAL", atBatId, isOut, runsScored, wasLowAccuracy: wasLow });

    void withOfflineRetry(`confirm-${atBatId}`, async () => {
      await confirmAtBat({ gameId: game.id, atBatId, mode, result, hitType, fieldX, fieldY, rbi, runsScored, isOut });
    });
  }

  async function handleUndo() {
    if (!state.lastConfirmed) return;
    const { atBatId, mode, runsScored } = state.lastConfirmed;
    dispatch({ type: "UNDO_LOCAL" });
    void withOfflineRetry(`undo-${atBatId}`, () =>
      undoAtBat({ gameId: game.id, atBatId, mode, runsScoredToReverse: runsScored })
    );
  }

  function selectRunner(base: (typeof BASES)[number], runner: RunnerState | null) {
    dispatch({ type: "SET_RUNNER", base, runner });
    setRunnerPicker(null);
    void withOfflineRetry(`runners-${game.id}-${Date.now()}`, () =>
      syncGameState(game.id, { runners: { ...state.runners, [base]: runner } })
    );
  }

  function handleQuickEvent(eventType: "wild_pitch" | "passed_ball" | "balk" | "error") {
    const result = advanceAllRunnersOneBase(state.runners);
    dispatch({ type: "ADVANCE_ALL_RUNNERS_LOCAL", result });
    void withOfflineRetry(`event-${game.id}-${Date.now()}`, () =>
      logGameEvent(game.id, {
        eventType,
        inning: state.inning,
        inningHalf: state.inningHalf,
        mode: state.mode,
        runsScored: result.scored.length,
      })
    );
  }

  function handleStolenBase(base: (typeof BASES)[number]) {
    const runner = state.runners[base];
    if (!runner) return;
    const nextBase = base === "first" ? "second" : base === "second" ? "third" : null;
    dispatch({ type: "SET_RUNNER", base, runner: null });
    if (nextBase) dispatch({ type: "SET_RUNNER", base: nextBase, runner });
    setStolenBasePicker(false);
    if (runner.type === "player" && runner.id) {
      void withOfflineRetry(`sb-${game.id}-${Date.now()}`, () => logStolenBase(game.id, runner.id!, state.inning));
    }
  }

  function openEndInning() {
    dispatch({ type: "SET_PANEL", panel: "endInning", open: true });
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
        ? "text-red-400"
        : state.pitchCountForCurrentPitcher >= 75
          ? "text-accent-amber"
          : "text-foreground/60"
      : "text-foreground/60";

  return (
    <div className="min-h-screen bg-background pb-24 text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex rounded-md border border-border p-1 text-xs">
            {(["hitting", "pitching"] as const).map((m) => (
              <button
                key={m}
                onClick={() => dispatch({ type: "SET_MODE", mode: m })}
                className={`rounded px-4 py-1.5 font-semibold uppercase tracking-wide transition ${
                  state.mode === m ? "bg-accent-blue text-white" : "text-foreground/50"
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
          {pendingSync > 0 && (
            <span className="rounded-full bg-accent-amber/20 px-3 py-1 text-xs text-accent-amber">
              {pendingSync} syncing…
            </span>
          )}
          <p className="font-heading text-xl font-bold text-white">
            {game.home_away === "home" ? game.opponent_name : "Us"} {state.opponentScore} &ndash; {state.ourScore}{" "}
            {game.home_away === "home" ? "Us" : game.opponent_name}
          </p>
        </div>
      </header>

      {state.showLowAccuracyWarning && (
        <div className="bg-accent-amber/10 px-4 py-2 text-center text-xs text-accent-amber">
          Low pitch detail — heat map accuracy is reduced
        </div>
      )}
      {banner && <div className="bg-red-500/10 px-4 py-2 text-center text-xs text-red-400">{banner}</div>}

      <div className="grid grid-cols-1 gap-6 p-4 md:grid-cols-2">
        {/* LEFT COLUMN */}
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-border bg-surface p-4">
            {state.mode === "hitting" ? (
              <>
                <p className="text-xs uppercase tracking-wide text-foreground/40">
                  Batting {state.battingOrderPosition} of 9
                </p>
                <p className="font-heading text-3xl font-bold text-white">
                  {battingPlayerInfo ? `#${battingPlayerInfo.jersey_number ?? "—"} ${battingPlayerInfo.name}` : "—"}
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
                  className="font-heading w-full border-b border-border bg-transparent text-3xl font-bold text-white outline-none focus:border-accent-blue"
                />
                <datalist id="opponent-batters">
                  {opponentPlayers.map((p) => (
                    <option key={p.id} value={p.name} />
                  ))}
                </datalist>
                <div className="mt-3 flex items-center justify-between text-xs">
                  <button onClick={() => setPitcherPickerOpen(true)} className="text-accent-blue hover:underline">
                    Pitcher: {currentPitcher ? currentPitcher.name : "Select…"}
                  </button>
                  <span className={pitchCountColor}>{state.pitchCountForCurrentPitcher} pitches</span>
                </div>
              </>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3 rounded-lg border border-border bg-surface p-4 text-center">
            <CountBlock label="Balls" value={state.balls} />
            <CountBlock label="Strikes" value={state.strikes} />
            <CountBlock label="Outs" value={state.outs} />
          </div>

          <div>
            <p className="mb-1.5 text-xs uppercase tracking-wide text-foreground/40">Pitch type</p>
            <div className="flex flex-wrap gap-2">
              {PITCH_TYPES.map((t) => (
                <button
                  key={t}
                  onClick={() => dispatch({ type: "SELECT_PITCH_TYPE", pitchType: state.selectedPitchType === t ? null : t })}
                  className={`min-h-[48px] rounded-full border px-4 text-sm font-medium transition ${
                    state.selectedPitchType === t
                      ? "border-accent-blue bg-accent-blue text-white"
                      : "border-border bg-surface text-foreground/70"
                  }`}
                >
                  {PITCH_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col items-center gap-3">
            <StrikeZoneGrid
              selectedZone={state.selectedZone}
              lastPitchZone={state.lastPitchZone}
              onTap={(x, y) => dispatch({ type: "TAP_ZONE", x, y })}
            />
            <div className="grid w-full max-w-[280px] grid-cols-3 gap-2">
              <OutcomeButton label="Ball" color="#2E6FD4" onClick={() => handlePitchOutcome("ball")} />
              <OutcomeButton label="Strike" color="#E0554F" onClick={() => handlePitchOutcome("strike")} />
              <OutcomeButton label="Foul" color="#EF9F27" onClick={() => handlePitchOutcome("foul")} />
              <OutcomeButton label="HBP" color="#B060F0" onClick={() => handlePitchOutcome("hbp")} />
              <OutcomeButton
                label="In Play"
                color="#1D9E75"
                className="col-span-2"
                onClick={() => handlePitchOutcome("inplay")}
              />
            </div>
          </div>

          {state.awaitingResult && (
            <div className="rounded-lg border border-accent-gold/40 bg-surface p-4">
              <p className="mb-2 text-xs uppercase tracking-wide text-foreground/40">At-bat result</p>
              <div className="grid grid-cols-3 gap-2">
                {RESULT_BUTTON_ORDER.map((r) => (
                  <button
                    key={r}
                    onClick={() => dispatch({ type: "SET_RESULT", result: r })}
                    className={`min-h-[48px] rounded-md border px-2 text-sm font-medium transition ${
                      state.suggestedResult === r
                        ? "border-accent-gold bg-accent-gold/20 text-white"
                        : "border-border bg-background text-foreground/70"
                    }`}
                  >
                    {RESULT_LABELS[r]}
                  </button>
                ))}
              </div>

              <div className="mt-3">
                <p className="mb-1 text-xs uppercase tracking-wide text-foreground/40">Hit type (optional)</p>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(HIT_TYPE_LABELS) as (keyof typeof HIT_TYPE_LABELS)[]).map((ht) => (
                    <button
                      key={ht}
                      onClick={() => dispatch({ type: "SET_HIT_TYPE", hitType: state.pendingHitType === ht ? null : ht })}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        state.pendingHitType === ht ? "border-accent-blue bg-accent-blue text-white" : "border-border text-foreground/60"
                      }`}
                    >
                      {HIT_TYPE_LABELS[ht]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-3 flex gap-6">
                <Stepper label="RBI" value={state.pendingRbi} onChange={(v) => dispatch({ type: "SET_RBI", value: v })} />
                <Stepper
                  label="Runs scored"
                  value={state.pendingRunsScored}
                  onChange={(v) => dispatch({ type: "SET_RUNS_SCORED", value: v })}
                />
              </div>

              <button
                onClick={handleConfirm}
                disabled={!state.suggestedResult}
                className="mt-4 w-full rounded-md bg-accent-green px-4 py-3 text-base font-semibold text-white disabled:opacity-40"
              >
                Confirm At-Bat
              </button>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN */}
        <div className="flex flex-col gap-4">
          <FieldDiagram tap={state.fieldTap} onTap={(x, y) => dispatch({ type: "SET_FIELD_TAP", x, y })} />

          <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-surface p-4">
            <BaserunnerDiamond runners={state.runners} onBaseTap={(b) => setRunnerPicker(b)} />
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
          </div>

          <div className="grid grid-cols-2 gap-2">
            <QuickButton label="Stolen Base" onClick={() => setStolenBasePicker(true)} />
            <QuickButton label="Wild Pitch" onClick={() => handleQuickEvent("wild_pitch")} />
            <QuickButton label="Balk" onClick={() => handleQuickEvent("balk")} />
            <QuickButton label="Passed Ball" onClick={() => handleQuickEvent("passed_ball")} />
            <QuickButton label="Error" onClick={() => handleQuickEvent("error")} />
            <QuickButton label="Substitution" onClick={() => dispatch({ type: "SET_PANEL", panel: "substitution", open: true })} />
          </div>

          {stolenBasePicker && (
            <div className="rounded-lg border border-border bg-surface p-3">
              <p className="mb-2 text-xs uppercase tracking-wide text-foreground/40">Who stole?</p>
              <div className="flex flex-wrap gap-2">
                {BASES.filter((b) => state.runners[b]).map((b) => (
                  <button
                    key={b}
                    onClick={() => handleStolenBase(b)}
                    className="rounded-md border border-border px-3 py-2 text-sm text-white"
                  >
                    {state.runners[b]?.name} ({b})
                  </button>
                ))}
                <button onClick={() => setStolenBasePicker(false)} className="rounded-md border border-border px-3 py-2 text-sm text-foreground/50">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

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
                  className="rounded-md border border-border px-3 py-2 text-left text-sm text-white hover:border-accent-blue"
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

      {state.endInningConfirmOpen && (
        <ConfirmDialog
          title="End half-inning?"
          message={`${state.outs} outs recorded — end this half inning?`}
          confirmLabel="End Inning"
          onConfirm={confirmEndInning}
          onCancel={() => dispatch({ type: "SET_PANEL", panel: "endInning", open: false })}
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

      {state.mode === "pitching" && state.pitchCountForCurrentPitcher >= 100 && !state.pitchCountAck100 && (
        <PitchCountModal
          count={state.pitchCountForCurrentPitcher}
          onAcknowledge={() => {
            dispatch({ type: "ACK_PITCH_COUNT", level: 100 });
            void syncGameState(game.id, { pitch_count_ack_100: true });
          }}
        />
      )}

      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-border bg-surface px-4 py-3">
        <div className="flex gap-2">
          <button
            onClick={openEndInning}
            className="min-h-[48px] rounded-md border border-border px-4 text-sm font-medium text-white"
          >
            End Inning
          </button>
          <button
            onClick={() => dispatch({ type: "SET_PANEL", panel: "endGame", open: true })}
            className="min-h-[48px] rounded-md border border-red-500/50 px-4 text-sm font-medium text-red-400"
          >
            End Game
          </button>
        </div>

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

function CountBlock({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="font-heading text-5xl font-bold text-white">{value}</p>
      <p className="mt-1 text-[11px] uppercase tracking-wide text-foreground/40">{label}</p>
    </div>
  );
}

function OutcomeButton({
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
      className={`min-h-[48px] rounded-full border-2 px-3 text-sm font-semibold text-white transition hover:brightness-125 ${className}`}
    >
      {label}
    </button>
  );
}

function QuickButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="min-h-[48px] rounded-md border border-border bg-surface px-3 text-sm font-medium text-foreground/80 hover:border-accent-blue hover:text-white"
    >
      {label}
    </button>
  );
}

function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-foreground/40">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <button onClick={() => onChange(value - 1)} className="h-8 w-8 rounded border border-border text-white">
          −
        </button>
        <span className="font-heading w-4 text-center text-lg text-white">{value}</span>
        <button onClick={() => onChange(value + 1)} className="h-8 w-8 rounded border border-border text-white">
          +
        </button>
      </div>
    </div>
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
          <button onClick={onConfirm} className="flex-1 rounded-md bg-accent-blue px-4 py-2.5 text-sm font-semibold text-white">
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
  base: "first" | "second" | "third";
  mode: "hitting" | "pitching";
  players: Player[];
  battingPlayerId: string | null;
  runners: { first?: RunnerState | null; second?: RunnerState | null; third?: RunnerState | null };
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
              onClick={() => onSelect({ type: "player", id: p.id, name: p.name })}
              className="rounded border border-border px-2 py-1 text-left text-sm text-white hover:border-accent-blue"
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
          className="flex-1 rounded border border-accent-blue py-1 text-xs text-white"
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
