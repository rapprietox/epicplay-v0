"use client";

import type { AtBatResult, HitType, Runners } from "@/lib/supabase/types";

// Operator-screen bug fixes (feature/lineup-drafts): Fielder's Choice was
// always rendered, even for the first batter of a half-inning with the
// bases empty -- it can't legitimately happen with nobody on. Hidden
// outright when the condition fails (never just greyed out) -- see
// isVisible below and its use in QuickModeGrid/MobileQuickModeGrid.
//
// Sacrifice-rules batch: Sac Fly and Sac Bunt are gone as their own
// buttons -- a sacrifice is no longer decided by which button the
// operator taps, only by what actually happens to the runners (see
// operator-console.tsx's runnerOutcomeQueue). Fly Out/Line Out/Foul Out
// already ask that question for any runner on base with outs below 2;
// the new standalone "Bunt" button below replaces Sac Bunt and asks a
// first how-did-it-end question before the same per-runner queue can
// apply to a bunt out at first.
function hasRunnerOnBase(runners: Runners): boolean {
  return Boolean(runners.first || runners.second || runners.third);
}

export interface QuickModeButtonDef {
  label: string;
  result: AtBatResult;
  hitType: HitType | null;
  // Quick Mode scorekeeper batch: overrides the printed scorebook
  // notation without needing a new AtBatResult value -- "Kl" (strikeout
  // looking) and "Foul Out" both reuse an existing result this way (see
  // logQuickAtBat's own comment).
  scorebookNotation?: string;
  // Bug fix (feature/lineup-drafts): only set on Fielder's Choice --
  // every other button has no base/outs precondition and is always
  // visible, same as before this fix.
  isVisible?: (ctx: { runners: Runners; outs: number }) => boolean;
}

interface QuickModeRow {
  heading: string;
  buttons: QuickModeButtonDef[];
}

const ROWS: QuickModeRow[] = [
  {
    heading: "Hits",
    buttons: [
      { label: "1B", result: "single", hitType: null },
      { label: "2B", result: "double", hitType: null },
      { label: "3B", result: "triple", hitType: null },
      { label: "HR", result: "hr", hitType: null },
    ],
  },
  {
    heading: "Outs",
    buttons: [
      { label: "K", result: "strikeout", hitType: null },
      // "Strikeout Looking" reuses the plain "strikeout" result -- there's
      // no swing/take column on a Quick Mode at-bat (no pitches are ever
      // logged to read it from) -- and overrides the printed notation to
      // "Kl" instead, the same value notationFor's own scorebook_notation
      // check already prefers over its swing-based guess for full mode.
      { label: "Kl", result: "strikeout", hitType: null, scorebookNotation: "Kl" },
      { label: "Ground Out", result: "groundout", hitType: null },
      // Fly Out/Line Out/Foul Out are where the sacrifice-fly question
      // now lives (see maybeStartRunnerOutcomeQueue in operator-console.tsx)
      // -- any runner on base with outs below 2 gets asked per runner
      // whether they scored, not just the taps that used to go through
      // the removed Sac Fly button.
      { label: "Fly Out", result: "flyout", hitType: null },
      { label: "Line Out", result: "lineout", hitType: null },
      // "Foul Out" reuses "flyout" (a caught foul ball scores exactly
      // like a caught fly ball) -- same relabeling precedent full mode's
      // own foul-territory result step already uses.
      { label: "Foul Out", result: "flyout", hitType: null, scorebookNotation: "Foul Out" },
    ],
  },
  {
    heading: "Reached base",
    buttons: [
      { label: "Walk (BB)", result: "walk", hitType: null },
      { label: "HBP", result: "hbp", hitType: null },
      { label: "Error", result: "error", hitType: null },
      { label: "Fielder's Choice", result: "fc", hitType: null, isVisible: ({ runners }) => hasRunnerOnBase(runners) },
    ],
  },
];

// Urgent mobile fixes, Fix 1: on a phone, the original heading-grouped
// rows (Hits/Outs/Reached base) plus the separate Double Play button and
// Special Plays row below it meant scrolling through several sections to
// reach anything. This is a SEPARATE, mobile-only grid -- the 14 most
// common outcomes plus Double Play and IBB, in the exact 4x4 order
// requested, all visible at once with no scroll. Less common actions
// (Foul Out, Stolen Base, Wild Pitch, Passed Ball, Balk) move to a small
// "More" strip below it on mobile (see QuickModeLeftPanel) rather than
// disappearing -- "no scrolling for any common play" implies the
// uncommon ones can still cost a scroll, not that anything is actually
// removed from Quick Mode.
type MobileCell = { kind: "pick"; def: QuickModeButtonDef } | { kind: "dp" } | { kind: "ibb" } | { kind: "bunt" };

const MOBILE_GRID: MobileCell[] = [
  { kind: "pick", def: { label: "1B", result: "single", hitType: null } },
  { kind: "pick", def: { label: "2B", result: "double", hitType: null } },
  { kind: "pick", def: { label: "3B", result: "triple", hitType: null } },
  { kind: "pick", def: { label: "HR", result: "hr", hitType: null } },
  { kind: "pick", def: { label: "K", result: "strikeout", hitType: null } },
  { kind: "pick", def: { label: "Kl", result: "strikeout", hitType: null, scorebookNotation: "Kl" } },
  { kind: "pick", def: { label: "GO", result: "groundout", hitType: null } },
  { kind: "pick", def: { label: "FO", result: "flyout", hitType: null } },
  { kind: "pick", def: { label: "BB", result: "walk", hitType: null } },
  { kind: "pick", def: { label: "HBP", result: "hbp", hitType: null } },
  { kind: "pick", def: { label: "LO", result: "lineout", hitType: null } },
  { kind: "dp" },
  { kind: "pick", def: { label: "E", result: "error", hitType: null } },
  { kind: "pick", def: { label: "FC", result: "fc", hitType: null, isVisible: ({ runners }) => hasRunnerOnBase(runners) } },
  // Sacrifice-rules batch: replaces the old "SAC" cell (which used to be
  // a pre-decided Sac Fly tap) -- Bunt now always asks how the play ended
  // first (see onBunt/BuntOutcomePrompt in operator-console.tsx) before
  // the sacrifice question, if any, can apply.
  { kind: "bunt" },
  { kind: "ibb" },
];

export function MobileQuickModeGrid({
  onPick,
  onDoublePlay,
  onIbb,
  onBunt,
  disabled,
  dpDisabled,
  runners,
  outs,
}: {
  onPick: (def: QuickModeButtonDef) => void;
  onDoublePlay: () => void;
  onIbb: () => void;
  onBunt: () => void;
  disabled: boolean;
  dpDisabled: boolean;
  runners: Runners;
  outs: number;
}) {
  return (
    // Urgent mobile fixes, Fix 6: extra gap so adjacent 64px buttons
    // have real breathing room between them, not just within each one.
    <div className="grid grid-cols-4 gap-3">
      {MOBILE_GRID.filter((cell) => cell.kind !== "pick" || !cell.def.isVisible || cell.def.isVisible({ runners, outs })).map((cell, i) => {
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
        if (cell.kind === "bunt") {
          return (
            <button
              key={i}
              type="button"
              disabled={disabled}
              onClick={onBunt}
              className="glossy min-h-[64px] rounded-md border-2 border-accent-amber px-1 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-accent-amber/20 disabled:cursor-not-allowed disabled:opacity-30"
            >
              BUNT
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

export function QuickModeGrid({
  onPick,
  onBunt,
  disabled,
  runners,
  outs,
}: {
  onPick: (def: QuickModeButtonDef) => void;
  onBunt: () => void;
  disabled: boolean;
  runners: Runners;
  outs: number;
}) {
  return (
    <div className="flex w-full flex-col gap-3">
      {ROWS.map((row) => {
        const visibleButtons = row.buttons.filter((def) => !def.isVisible || def.isVisible({ runners, outs }));
        if (visibleButtons.length === 0) return null;
        return (
          <div key={row.heading}>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-foreground/40">{row.heading}</p>
            <div className="flex flex-wrap gap-2">
              {visibleButtons.map((def) => (
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
        );
      })}
      {/* Sacrifice-rules batch: Bunt replaces the removed Sac Bunt button
          -- always visible (a bunt can happen with the bases empty too,
          it just can never become a sacrifice then), asks how the play
          ended first via onBunt rather than carrying a pre-decided result. */}
      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-foreground/40">Bunt</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={onBunt}
            className="glossy min-h-[48px] min-w-[84px] flex-1 rounded-md border-2 border-accent-amber bg-background px-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-accent-amber/20 disabled:cursor-not-allowed disabled:opacity-30"
          >
            Bunt
          </button>
        </div>
      </div>
    </div>
  );
}
