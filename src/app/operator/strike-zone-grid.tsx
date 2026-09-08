"use client";

import type { PitchOutcome } from "@/lib/supabase/types";

const OUTCOME_COLOR: Record<PitchOutcome, string> = {
  ball: "#2E6FD4",
  strike: "#E0554F",
  foul: "#EF9F27",
  hbp: "#B060F0",
  inplay: "#1D9E75",
};

function cellCenter(row: number, col: number) {
  return { x: col * 33.33 + 16.67, y: row * 33.33 + 16.67 };
}

export function StrikeZoneGrid({
  selectedZone,
  lastPitchZone,
  onTap,
}: {
  selectedZone: { x: number; y: number } | null;
  lastPitchZone: { x: number; y: number; outcome: PitchOutcome } | null;
  onTap: (x: number, y: number) => void;
}) {
  return (
    <div className="grid aspect-square w-full max-w-[280px] grid-cols-3 grid-rows-3 gap-1 rounded-md border-2 border-border bg-background p-1">
      {[0, 1, 2].map((row) =>
        [0, 1, 2].map((col) => {
          const { x, y } = cellCenter(row, col);
          const isSelected = selectedZone?.x === x && selectedZone?.y === y;
          const isLast = lastPitchZone?.x === x && lastPitchZone?.y === y;
          return (
            <button
              key={`${row}-${col}`}
              type="button"
              onClick={() => onTap(x, y)}
              style={isLast ? { borderColor: OUTCOME_COLOR[lastPitchZone!.outcome] } : undefined}
              className={`relative min-h-[80px] min-w-[80px] rounded border-2 transition ${
                isSelected
                  ? "border-accent-blue bg-accent-blue/20"
                  : isLast
                    ? "bg-surface"
                    : "border-border bg-surface hover:border-accent-blue/50"
              }`}
            >
              {isLast && (
                <span
                  className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{ backgroundColor: OUTCOME_COLOR[lastPitchZone!.outcome] }}
                />
              )}
            </button>
          );
        })
      )}
    </div>
  );
}
