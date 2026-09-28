"use client";

import { useState } from "react";
import { useSpeechRecognition } from "@/lib/kairos/use-speech-recognition";
import { parseVoicePitchCommand } from "./actions";
import type { VoiceCommand } from "@/lib/anthropic";
import type { AtBatResult, FieldingPosition, HitType, PitchOutcome, PitchType } from "@/lib/supabase/types";

// KAIROS batch, Tool 6. zone_row/zone_col (coarse thirds) map onto the
// exact center points of the strike zone's own 3x3 thirds -- same
// boundaries zoneIndexFromCoords already buckets a real tap into
// (33.33/66.67), so a voice-logged pitch lands in the same zone a manual
// tap at that same coarse spot would have.
const ROW_Y: Record<"top" | "middle" | "bottom", number> = { top: 16.7, middle: 50, bottom: 83.3 };
const COL_X: Record<"left" | "middle" | "right", number> = { left: 16.7, middle: 50, right: 83.3 };

export function KairosVoiceButton({
  gameId,
  disabled,
  onConfirmPitch,
  onConfirmAtBatResult,
}: {
  gameId: string;
  disabled?: boolean;
  onConfirmPitch: (pitch: { pitchType: PitchType | null; outcome: PitchOutcome; swing: boolean | null; zoneX: number; zoneY: number }) => void;
  onConfirmAtBatResult: (result: { result: AtBatResult; hitType: HitType | null; fieldedByPosition: FieldingPosition | null }) => void;
}) {
  const [parsing, setParsing] = useState(false);
  const [command, setCommand] = useState<VoiceCommand | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { supported, listening, start, stop } = useSpeechRecognition((transcript) => {
    setError(null);
    setParsing(true);
    parseVoicePitchCommand(gameId, transcript)
      .then((result) => setCommand(result))
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't reach KAIROS -- try again?"))
      .finally(() => setParsing(false));
  });

  if (!supported) return null;

  function confirm() {
    if (!command) return;
    if (command.kind === "pitch") {
      onConfirmPitch({
        pitchType: command.pitch_type,
        outcome: command.outcome,
        swing: command.swing,
        zoneX: command.zone_col ? COL_X[command.zone_col] : 50,
        zoneY: command.zone_row ? ROW_Y[command.zone_row] : 50,
      });
    } else if (command.kind === "at_bat_result") {
      onConfirmAtBatResult({ result: command.result, hitType: command.hit_type, fieldedByPosition: command.fielded_by_position });
    }
    setCommand(null);
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => (listening ? stop() : start())}
        title="KAIROS voice logging"
        className={`flex h-9 w-9 items-center justify-center rounded-full border text-base transition disabled:opacity-30 ${
          listening ? "animate-pulse border-accent-red bg-accent-red/20 text-accent-red" : "border-accent-green/50 text-accent-green hover:bg-accent-green/10"
        }`}
      >
        🎤
      </button>

      {(parsing || command || error) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="glossy w-full max-w-sm rounded-lg border-l-4 border-l-accent-green bg-surface p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-accent-green">
              <span style={{ filter: "drop-shadow(0 0 4px #2ECC71)" }}>⚾</span> KAIROS
            </p>
            {parsing && <p className="mt-2 text-sm text-foreground/60">Listening…</p>}
            {error && <p className="mt-2 text-sm text-accent-red">{error}</p>}
            {command && command.kind === "unclear" && <p className="mt-2 text-sm text-foreground/70">{command.message}</p>}
            {command && command.kind !== "unclear" && <p className="mt-2 text-base font-semibold text-white">{command.summary} — Confirm?</p>}
            <div className="mt-3 flex gap-2">
              {command && command.kind !== "unclear" && (
                <button type="button" onClick={confirm} className="min-h-[40px] flex-1 rounded-md bg-accent-green px-4 text-sm font-semibold text-background">
                  Confirm
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setCommand(null);
                  setError(null);
                }}
                className="min-h-[40px] flex-1 rounded-md border border-border text-sm text-foreground/70"
              >
                {command && command.kind !== "unclear" ? "Edit / Cancel" : "Close"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
