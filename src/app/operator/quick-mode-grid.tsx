"use client";

import type { AtBatResult, HitType } from "@/lib/supabase/types";

export interface QuickModeButtonDef {
  label: string;
  result: AtBatResult;
  hitType: HitType | null;
  // SAC FLY/SAC BUNT aren't their own AtBatResult (a sac fly is just a
  // flyout, a sac bunt just a bunted groundout -- same established
  // pattern as the full mode's own "'Sacrifice Fly' is deliberately not
  // a button [as a result]" precedent) -- this is what tells
  // handleQuickPick to force the ScoreMethod to "sac_fly" for RBI
  // crediting instead of the generic default.
  isSac: boolean;
}

const ROWS: QuickModeButtonDef[][] = [
  [
    { label: "SINGLE", result: "single", hitType: null, isSac: false },
    { label: "DOUBLE", result: "double", hitType: null, isSac: false },
    { label: "TRIPLE", result: "triple", hitType: null, isSac: false },
    { label: "HOME RUN", result: "hr", hitType: null, isSac: false },
  ],
  [
    { label: "STRIKEOUT", result: "strikeout", hitType: null, isSac: false },
    { label: "WALK", result: "walk", hitType: null, isSac: false },
    { label: "HBP", result: "hbp", hitType: null, isSac: false },
    { label: "GROUND OUT", result: "groundout", hitType: null, isSac: false },
    { label: "FLY OUT", result: "flyout", hitType: null, isSac: false },
    { label: "LINE OUT", result: "lineout", hitType: null, isSac: false },
  ],
  [
    { label: "ERROR", result: "error", hitType: null, isSac: false },
    { label: "FIELDER'S CHOICE", result: "fc", hitType: null, isSac: false },
    { label: "SAC FLY", result: "flyout", hitType: null, isSac: true },
    { label: "SAC BUNT", result: "groundout", hitType: "bunt", isSac: true },
  ],
];

export function QuickModeGrid({ onPick, disabled }: { onPick: (def: QuickModeButtonDef) => void; disabled: boolean }) {
  return (
    <div className="flex w-full max-w-[480px] flex-col gap-3">
      {ROWS.map((row, i) => (
        <div key={i} className="flex flex-wrap justify-center gap-2">
          {row.map((def) => (
            <button
              key={def.label}
              type="button"
              disabled={disabled}
              onClick={() => onPick(def)}
              className="glossy min-h-[56px] min-w-[92px] flex-1 rounded-md border-2 border-accent-primary bg-background px-3 text-sm font-bold uppercase tracking-wide text-white transition hover:border-accent-gold hover:bg-accent-primary/20 disabled:cursor-not-allowed disabled:opacity-30"
            >
              {def.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
