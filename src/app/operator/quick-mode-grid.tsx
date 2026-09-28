"use client";

import type { AtBatResult, HitType } from "@/lib/supabase/types";

export interface QuickModeButtonDef {
  label: string;
  result: AtBatResult;
  hitType: HitType | null;
  // SAC FLY/SAC BUNT aren't their own AtBatResult (a sac fly is just a
  // flyout, a sac bunt just a bunted groundout -- same established
  // pattern as the full mode's own "'Sacrifice Fly' is deliberately not
  // a button [as a result]" precedent). Whether a runner actually scores
  // is now decided by the same interactive sac-fly/squeeze prompts full
  // mode uses (see handleQuickPick) -- this flag no longer forces
  // anything, it's kept only so the button's own label can say "SAC"
  // rather than "FLY OUT"/"GROUND OUT".
  isSac: boolean;
  // Quick Mode scorekeeper batch: overrides the printed scorebook
  // notation without needing a new AtBatResult value -- "Kl" (strikeout
  // looking) and "Foul Out" both reuse an existing result this way (see
  // logQuickAtBat's own comment).
  scorebookNotation?: string;
}

interface QuickModeRow {
  heading: string;
  buttons: QuickModeButtonDef[];
}

const ROWS: QuickModeRow[] = [
  {
    heading: "Hits",
    buttons: [
      { label: "1B", result: "single", hitType: null, isSac: false },
      { label: "2B", result: "double", hitType: null, isSac: false },
      { label: "3B", result: "triple", hitType: null, isSac: false },
      { label: "HR", result: "hr", hitType: null, isSac: false },
    ],
  },
  {
    heading: "Outs",
    buttons: [
      { label: "K", result: "strikeout", hitType: null, isSac: false },
      // "Strikeout Looking" reuses the plain "strikeout" result -- there's
      // no swing/take column on a Quick Mode at-bat (no pitches are ever
      // logged to read it from) -- and overrides the printed notation to
      // "Kl" instead, the same value notationFor's own scorebook_notation
      // check already prefers over its swing-based guess for full mode.
      { label: "Kl", result: "strikeout", hitType: null, isSac: false, scorebookNotation: "Kl" },
      { label: "Ground Out", result: "groundout", hitType: null, isSac: false },
      { label: "Fly Out", result: "flyout", hitType: null, isSac: false },
      { label: "Line Out", result: "lineout", hitType: null, isSac: false },
      // "Foul Out" reuses "flyout" (a caught foul ball scores exactly
      // like a caught fly ball) -- same relabeling precedent full mode's
      // own foul-territory result step already uses.
      { label: "Foul Out", result: "flyout", hitType: null, isSac: false, scorebookNotation: "Foul Out" },
    ],
  },
  {
    heading: "Reached base",
    buttons: [
      { label: "Walk (BB)", result: "walk", hitType: null, isSac: false },
      { label: "HBP", result: "hbp", hitType: null, isSac: false },
      { label: "Error", result: "error", hitType: null, isSac: false },
      { label: "Fielder's Choice", result: "fc", hitType: null, isSac: false },
    ],
  },
  {
    heading: "Sacrifices",
    buttons: [
      { label: "Sac Fly", result: "flyout", hitType: null, isSac: true },
      { label: "Sac Bunt", result: "groundout", hitType: "bunt", isSac: true },
    ],
  },
];

export function QuickModeGrid({ onPick, disabled }: { onPick: (def: QuickModeButtonDef) => void; disabled: boolean }) {
  return (
    <div className="flex w-full flex-col gap-3">
      {ROWS.map((row) => (
        <div key={row.heading}>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-foreground/40">{row.heading}</p>
          <div className="flex flex-wrap gap-2">
            {row.buttons.map((def) => (
              <button
                key={def.label}
                type="button"
                disabled={disabled}
                onClick={() => onPick(def)}
                className="glossy min-h-[48px] min-w-[84px] flex-1 rounded-md border-2 border-accent-primary bg-background px-3 text-sm font-bold uppercase tracking-wide text-white transition hover:border-accent-gold hover:bg-accent-primary/20 disabled:cursor-not-allowed disabled:opacity-30"
              >
                {def.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
