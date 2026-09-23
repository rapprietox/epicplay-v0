"use client";

import { useState } from "react";
import type { Database, PlayerPositionCalibration, SubReason } from "@/lib/supabase/types";

type Player = Database["public"]["Tables"]["players"]["Row"];

const REASONS: { value: SubReason; label: string }[] = [
  { value: "tactical", label: "Tactical" },
  { value: "injury", label: "Injury" },
  { value: "ejection", label: "Ejection" },
  { value: "defensive", label: "Defensive" },
  { value: "pinch_hit", label: "Pinch hit" },
  { value: "pinch_run", label: "Pinch run" },
];

const DEFENSIVE_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"] as const;

export interface ChainResult {
  incomingPlayerId: string;
  entryPosition: string;
  outgoingPlayerId: string | null;
  positionMoves: { playerId: string; position: string }[];
  reason: SubReason;
  chainNote: string;
}

// Feature 2 (lineup-status batch): the full chain state machine. Only
// one of `mover`/`menu` is ever active at a time -- `menu` asks "sub in
// here, or move [occupant] first?" for whoever was just dropped on an
// occupied position; choosing "move first" clears the menu and arms
// `mover` (the displaced player, the only valid drag target until they
// land somewhere). See the batch's own design notes: `entryPosition`
// stays fixed for the whole chain -- the incoming player always ends up
// there, no matter how many hops the chain takes, because each hop's
// mover inherits the position of whoever they're replacing (or vacate
// their own position for the mover behind them), so the ORIGINAL
// position is the one and only spot never re-filled until the incoming
// player finally lands there at chain end.
interface ActiveChain {
  incomingPlayerId: string;
  entryPosition: string;
  // Committed hops for players who changed position but never left the
  // game (never includes the incoming/outgoing pair -- those are tracked
  // by the fields above/the eventual outgoingPlayerId instead).
  movements: { playerId: string; from: string; to: string }[];
  mover: string | null;
  moverFrom: string | null;
  menu: { askingPlayerId: string; askingFrom: string | null; target: string; occupant: string } | null;
}

interface Finalizing {
  incomingPlayerId: string;
  entryPosition: string;
  outgoingPlayerId: string | null;
  positionMoves: { playerId: string; position: string }[];
}

export function ChainSubstitutionModal({
  players,
  currentDefense,
  benchPlayerIds,
  fieldPositionsCalibration,
  inning,
  outs,
  onClose,
  onResolved,
  onOpenLateArrival,
}: {
  players: Player[];
  // Feature 2: who's at each of the 9 defensive positions right now --
  // live, substitution-aware state the parent (operator-console.tsx)
  // owns and updates as chains resolve; this modal only ever reads it
  // (plus its own in-progress chain preview) and hands back a finished
  // ChainResult for the parent to persist and apply.
  currentDefense: Record<string, string | null>;
  benchPlayerIds: Set<string>;
  fieldPositionsCalibration: PlayerPositionCalibration | null;
  inning: number;
  outs: number;
  onClose: () => void;
  onResolved: (result: ChainResult) => void;
  onOpenLateArrival: () => void;
}) {
  const [chain, setChain] = useState<ActiveChain | null>(null);
  const [finalizing, setFinalizing] = useState<Finalizing | null>(null);
  const [reason, setReason] = useState<SubReason>("tactical");
  const [dragOverPosition, setDragOverPosition] = useState<string | null>(null);
  const [draggingBenchId, setDraggingBenchId] = useState<string | null>(null);

  function playerName(playerId: string | null): string {
    if (!playerId) return "—";
    const p = players.find((pl) => pl.id === playerId);
    return p ? `#${p.jersey_number ?? "—"} ${p.name}` : "Player";
  }

  function cancel() {
    setChain(null);
    setFinalizing(null);
    setDragOverPosition(null);
  }

  // The chain-in-progress preview: currentDefense overlaid with whatever
  // this chain has committed so far, purely for display -- nothing here
  // is real until the whole chain resolves and onResolved fires.
  function previewOccupant(position: string): string | null {
    if (!chain) return currentDefense[position] ?? null;
    if (chain.mover && chain.moverFrom === position) return null; // vacated, about to move
    const committed = chain.movements.find((m) => m.to === position);
    if (committed) return committed.playerId;
    const vacatedByCommitted = chain.movements.find((m) => m.from === position);
    if (vacatedByCommitted) return null;
    return currentDefense[position] ?? null;
  }

  function handleDropOnPosition(target: string) {
    setDragOverPosition(null);
    const occupant = previewOccupant(target);

    if (!chain) {
      // First drop of a fresh chain -- must be a bench player.
      const incoming = draggingBenchId;
      setDraggingBenchId(null);
      if (!incoming) return;
      if (!occupant) {
        // Landing directly on an open position -- nobody to displace at
        // all, a simple placement rather than a real chain.
        setFinalizing({ incomingPlayerId: incoming, entryPosition: target, outgoingPlayerId: null, positionMoves: [] });
        return;
      }
      setChain({
        incomingPlayerId: incoming,
        entryPosition: target,
        movements: [],
        mover: null,
        moverFrom: null,
        menu: { askingPlayerId: incoming, askingFrom: null, target, occupant },
      });
      return;
    }

    // Mid-chain -- only the current mover can be dragged, per spec.
    if (!chain.mover || chain.moverFrom === target) return;

    if (!occupant) {
      // Terminal: mover lands on an open spot. Nobody displaced this
      // hop -- the open slot absorbs them, so no one goes to the bench.
      const movements = [...chain.movements, { playerId: chain.mover, from: chain.moverFrom!, to: target }];
      setChain(null);
      setFinalizing({
        incomingPlayerId: chain.incomingPlayerId,
        entryPosition: chain.entryPosition,
        outgoingPlayerId: null,
        positionMoves: movements.map((m) => ({ playerId: m.playerId, position: m.to })),
      });
      return;
    }

    // Occupied -- ask the same sub-in/move-first question for this spot.
    setChain({ ...chain, menu: { askingPlayerId: chain.mover, askingFrom: chain.moverFrom, target, occupant } });
  }

  function resolveMenuSubIn() {
    if (!chain || !chain.menu) return;
    const { askingPlayerId, askingFrom, target, occupant } = chain.menu;
    const movements =
      askingPlayerId === chain.incomingPlayerId
        ? chain.movements // the very first step -- incoming lands at entryPosition via the dedicated field, no separate movement entry
        : [...chain.movements, { playerId: askingPlayerId, from: askingFrom!, to: target }];
    setChain(null);
    setFinalizing({
      incomingPlayerId: chain.incomingPlayerId,
      entryPosition: chain.entryPosition,
      outgoingPlayerId: occupant,
      positionMoves: movements.map((m) => ({ playerId: m.playerId, position: m.to })),
    });
  }

  function resolveMenuMoveFirst() {
    if (!chain || !chain.menu) return;
    const { askingPlayerId, askingFrom, target, occupant } = chain.menu;
    const movements =
      askingPlayerId === chain.incomingPlayerId ? chain.movements : [...chain.movements, { playerId: askingPlayerId, from: askingFrom!, to: target }];
    setChain({ ...chain, movements, mover: occupant, moverFrom: target, menu: null });
  }

  function confirmFinal() {
    if (!finalizing) return;
    const incomingName = playerName(finalizing.incomingPlayerId);
    const parts = [`${incomingName} → ${finalizing.entryPosition} position.`];
    for (const m of finalizing.positionMoves) {
      parts.push(`${playerName(m.playerId)} → ${m.position}.`);
    }
    if (finalizing.outgoingPlayerId) {
      parts.push(`${playerName(finalizing.outgoingPlayerId)} → bench.`);
    }
    const reasonLabel = REASONS.find((r) => r.value === reason)?.label ?? reason;
    parts.push(`Reason: ${reasonLabel}. Inning ${inning}, ${outs} out${outs === 1 ? "" : "s"}.`);
    onResolved({ ...finalizing, reason, chainNote: parts.join(" ") });
    setFinalizing(null);
  }

  const benchPlayers = players.filter((p) => benchPlayerIds.has(p.id));
  const inChainMode = chain !== null || finalizing !== null;
  const positionLocations = fieldPositionsCalibration;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="glossy flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="font-heading text-lg font-semibold uppercase tracking-wide text-white">Substitution</h3>
          <div className="flex items-center gap-2">
            {inChainMode && (
              <button
                type="button"
                onClick={cancel}
                title="Cancel chain"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-accent-red/50 text-sm font-bold text-accent-red hover:bg-accent-red/10"
              >
                ×
              </button>
            )}
            <button
              type="button"
              onClick={onOpenLateArrival}
              className="rounded-md border border-accent-amber/50 px-2 py-1 text-[11px] font-semibold text-accent-amber hover:bg-accent-amber/10"
            >
              Late Arrival
            </button>
            <button type="button" onClick={onClose} className="text-xs text-foreground/50 hover:text-white">
              Close
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <p className="mb-2 text-xs text-foreground/50">
            {!inChainMode
              ? "Drag a bench player onto an occupied position to start a substitution."
              : chain?.menu
                ? `${playerName(chain.menu.askingPlayerId)} → ${chain.menu.target}, currently ${playerName(chain.menu.occupant)}.`
                : chain?.mover
                  ? `Drag ${playerName(chain.mover)} to another position.`
                  : "Pick a reason to confirm."}
          </p>

          {!positionLocations && (
            <p className="mb-2 rounded-md border border-accent-amber/40 bg-accent-amber/10 px-3 py-2 text-xs text-accent-amber">
              Field positions aren&apos;t calibrated -- substitutions still work, the diagram just won&apos;t show exact spots.
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_180px]">
            <div
              className="glossy relative aspect-square w-full overflow-hidden rounded-lg border border-border bg-background"
              style={{ backgroundImage: "url('/field-2d.png')", backgroundSize: "cover", backgroundPosition: "center" }}
            >
              {DEFENSIVE_POSITIONS.map((pos) => {
                const loc = positionLocations?.[pos];
                if (!loc) return null;
                const occupantId = previewOccupant(pos);
                const isMover = chain?.mover === occupantId && chain.moverFrom === pos;
                const isDragOver = dragOverPosition === pos;
                return (
                  <div
                    key={pos}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverPosition(pos);
                    }}
                    onDragLeave={() => setDragOverPosition((d) => (d === pos ? null : d))}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleDropOnPosition(pos);
                    }}
                    className="absolute -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `${loc.x}%`, top: `${loc.y}%` }}
                  >
                    {occupantId ? (
                      <div
                        draggable={isMover}
                        onDragStart={(e) => {
                          // Native HTML5 DnD needs a real payload set here
                          // for some browsers (Firefox in particular) to
                          // fire drop events at all -- matching the same
                          // pattern lineup-builder.tsx already uses,
                          // though this component tracks the in-progress
                          // mover via chain.mover rather than reading it
                          // back, since only one player is ever draggable
                          // at a time mid-chain.
                          e.dataTransfer.setData("text/plain", occupantId);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        className={`flex h-9 w-9 items-center justify-center rounded-full border-2 border-background text-xs font-bold text-background shadow-lg ${
                          isMover ? "chain-amber-glow cursor-grab" : ""
                        }`}
                        style={{ backgroundColor: isMover ? "#EF9F27" : "#F0C060" }}
                        title={playerName(occupantId)}
                      >
                        {players.find((p) => p.id === occupantId)?.jersey_number ?? "?"}
                      </div>
                    ) : (
                      <div
                        className={`flex h-9 w-9 items-center justify-center rounded-full border-2 border-dashed text-[9px] font-semibold text-foreground/40 ${
                          isDragOver ? "border-accent-gold bg-accent-gold/10" : "border-border"
                        }`}
                      >
                        {pos}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div>
              <p className="text-xs uppercase tracking-wide text-foreground/40">Bench</p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {benchPlayers.map((p) => {
                  const isIncomingWaiting = chain?.incomingPlayerId === p.id;
                  return (
                    <li key={p.id}>
                      <div
                        draggable={!inChainMode}
                        onDragStart={(e) => {
                          setDraggingBenchId(p.id);
                          e.dataTransfer.setData("text/plain", p.id);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragEnd={() => setDraggingBenchId(null)}
                        className={`rounded-md border px-2 py-1.5 text-xs text-white ${
                          isIncomingWaiting
                            ? "chain-green-glow border-accent-green bg-accent-green/10"
                            : inChainMode
                              ? "cursor-not-allowed border-border bg-background/20 opacity-40"
                              : "cursor-grab border-border bg-background/40 hover:border-accent-primary active:cursor-grabbing"
                        }`}
                      >
                        #{p.jersey_number ?? "—"} {p.name}
                        {isIncomingWaiting && (
                          <p className="mt-0.5 text-[9px] text-accent-green">Waiting to take {chain?.entryPosition}</p>
                        )}
                      </div>
                    </li>
                  );
                })}
                {benchPlayers.length === 0 && <li className="text-xs text-foreground/30">No one on the bench.</li>}
              </ul>
            </div>
          </div>

          {finalizing && (
            <div className="mt-4 rounded-md border border-accent-gold/40 bg-accent-gold/5 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground/50">Confirm substitution</p>
              <p className="mt-1 text-sm text-white">
                {playerName(finalizing.incomingPlayerId)} → {finalizing.entryPosition}
                {finalizing.positionMoves.map((m) => ` · ${playerName(m.playerId)} → ${m.position}`).join("")}
                {finalizing.outgoingPlayerId ? ` · ${playerName(finalizing.outgoingPlayerId)} → bench` : ""}
              </p>
              <label className="mt-3 flex flex-col gap-1 text-xs text-foreground/50">
                Reason
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value as SubReason)}
                  className="rounded-md border border-border bg-background px-3 py-2 text-sm text-white"
                >
                  {REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={confirmFinal}
                className="mt-3 w-full min-h-[44px] rounded-md bg-accent-primary px-4 text-sm font-semibold text-white"
              >
                Confirm
              </button>
            </div>
          )}

          {chain?.menu && (
            <div className="mt-4 rounded-md border border-accent-gold/40 bg-accent-gold/5 p-3">
              <p className="text-sm text-white">
                {playerName(chain.menu.askingPlayerId)} → {chain.menu.target}, currently {playerName(chain.menu.occupant)}.
              </p>
              <div className="mt-3 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={resolveMenuSubIn}
                  className="min-h-[44px] rounded-md bg-accent-primary px-4 text-sm font-semibold text-white"
                >
                  Sub in here
                </button>
                <button
                  type="button"
                  onClick={resolveMenuMoveFirst}
                  className="min-h-[44px] rounded-md border border-accent-amber/50 px-4 text-sm font-medium text-accent-amber hover:bg-accent-amber/10"
                >
                  Move {playerName(chain.menu.occupant)} to another position first
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
