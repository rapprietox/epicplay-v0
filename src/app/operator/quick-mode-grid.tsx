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

// Urgent mobile fixes, Fix 1: on a phone, the original heading-grouped
// rows (Hits/Outs/Reached base/Sacrifices) plus the separate Double
// Play button and Special Plays row below it meant scrolling through
// several sections to reach anything. This is a SEPARATE, mobile-only
// grid -- the 14 most common outcomes plus Double Play and IBB, in the
// exact 4x4 order requested, all visible at once with no scroll. Less
// common actions (Foul Out, Sac Bunt, Stolen Base, Wild Pitch, Passed
// Ball, Balk) move to a small "More" strip below it on mobile (see
// QuickModeLeftPanel) rather than disappearing -- "no scrolling for any
// common play" implies the uncommon ones can still cost a scroll, not
// that anything is actually removed from Quick Mode.
type MobileCell = { kind: "pick"; def: QuickModeButtonDef } | { kind: "dp" } | { kind: "ibb" };

const MOBILE_GRID: MobileCell[] = [
  { kind: "pick", def: { label: "1B", result: "single", hitType: null, isSac: false } },
  { kind: "pick", def: { label: "2B", result: "double", hitType: null, isSac: false } },
  { kind: "pick", def: { label: "3B", result: "triple", hitType: null, isSac: false } },
  { kind: "pick", def: { label: "HR", result: "hr", hitType: null, isSac: false } },
  { kind: "pick", def: { label: "K", result: "strikeout", hitType: null, isSac: false } },
  { kind: "pick", def: { label: "Kl", result: "strikeout", hitType: null, isSac: false, scorebookNotation: "Kl" } },
  { kind: "pick", def: { label: "GO", result: "groundout", hitType: null, isSac: false } },
  { kind: "pick", def: { label: "FO", result: "flyout", hitType: null, isSac: false } },
  { kind: "pick", def: { label: "BB", result: "walk", hitType: null, isSac: false } },
  { kind: "pick", def: { label: "HBP", result: "hbp", hitType: null, isSac: false } },
  { kind: "pick", def: { label: "LO", result: "lineout", hitType: null, isSac: false } },
  { kind: "dp" },
  { kind: "pick", def: { label: "E", result: "error", hitType: null, isSac: false } },
  { kind: "pick", def: { label: "FC", result: "fc", hitType: null, isSac: false } },
  { kind: "pick", def: { label: "SAC", result: "flyout", hitType: null, isSac: true } },
  { kind: "ibb" },
];

export function MobileQuickModeGrid({
  onPick,
  onDoublePlay,
  onIbb,
  disabled,
  dpDisabled,
}: {
  onPick: (def: QuickModeButtonDef) => void;
  onDoublePlay: () => void;
  onIbb: () => void;
  disabled: boolean;
  dpDisabled: boolean;
}) {
  return (
    // Urgent mobile fixes, Fix 6: extra gap so adjacent 64px buttons
    // have real breathing room between them, not just within each one.
    <div className="grid grid-cols-4 gap-3">
      {MOBILE_GRID.map((cell, i) => {
        if (cell.kind === "dp") {
          return (
            <button
              key={i}
              type="button"
              disabled={dpDisabled}
              onClick={onDoublePlay}
              className="glossy min-h-[64px] rounded-md border-2 border-accent-amber px-1 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-accent-amber/20 disabled:cursor-not-allowed disabled:opacity-30"
            >
              DP
            </button>
          );
        }
        if (cell.kind === "ibb") {
          return (
            <button
              key={i}
              type="button"
              disabled={disabled}
              onClick={onIbb}
              className="glossy min-h-[64px] rounded-md border-2 border-accent-amber px-1 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-accent-amber/20 disabled:cursor-not-allowed disabled:opacity-30"
            >
              IBB
            </button>
          );
        }
        return (
          <button
            key={cell.def.label + i}
            type="button"
            disabled={disabled}
            onClick={() => onPick(cell.def)}
            className="glossy min-h-[64px] rounded-md border-2 border-accent-primary bg-background px-1 text-sm font-bold uppercase tracking-wide text-white transition hover:border-accent-gold hover:bg-accent-primary/20 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {cell.def.label}
          </button>
        );
      })}
    </div>
  );
}

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
