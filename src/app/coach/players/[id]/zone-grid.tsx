"use client";

// Whiff-rate / pitch-location maps batch: shared 5x5 zone grid (9 strike
// cells + 16 ball-zone ring cells) -- Map 2 and Map 3 both render one of
// these, and the team-level versions on the coach dashboard reuse it too
// rather than each hand-rolling its own grid markup. Column/row widths
// are weighted (ring cells narrower/shorter) to roughly match the real
// capture geometry (RING_X=20/RING_Y=16 vs. each strike-zone third being
// ~33 units -- see heat-map.ts) instead of rendering all 25 cells the
// same size, which would visually overstate how much of the plate the
// ring actually covers.
export interface ZoneCell {
  color: string;
  primary: string;
  secondary?: string;
  // Nuclear-glow treatment for a cell the caller wants to visually call
  // out (e.g. a 36%+ "pitcher loves this zone" cell, or the single
  // worst whiff zone) -- same glow idiom the Team Leaders Board cards use.
  glow?: boolean;
}

export function ZoneGrid({ cells, revealed }: { cells: ZoneCell[]; revealed: boolean }) {
  return (
    <div
      className="mx-auto grid w-full max-w-[260px] gap-[3px] rounded-md border-2 border-border bg-background p-1"
      style={{ gridTemplateColumns: "0.6fr 1fr 1fr 1fr 0.6fr", gridTemplateRows: "0.55fr 1fr 1fr 1fr 0.55fr" }}
    >
      {cells.map((cell, i) => {
        const col = i % 5;
        const row = Math.floor(i / 5);
        const isRing = col === 0 || col === 4 || row === 0 || row === 4;
        return (
          <div
            key={i}
            className={`flex aspect-square flex-col items-center justify-center rounded transition-colors duration-700 ${
              isRing ? "opacity-90" : ""
            }`}
            style={{
              backgroundColor: revealed ? cell.color : "#1A3D28",
              boxShadow: revealed && cell.glow ? `0 0 8px ${cell.color}, 0 0 16px ${cell.color}` : undefined,
            }}
          >
            <span className={`font-heading font-bold text-background ${isRing ? "text-[8px]" : "text-[11px]"}`}>{cell.primary}</span>
            {cell.secondary && <span className={`text-background/70 ${isRing ? "text-[6px]" : "text-[8px]"}`}>{cell.secondary}</span>}
          </div>
        );
      })}
    </div>
  );
}

export function PitchTypeToggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap justify-center gap-1 text-xs">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-full border px-2.5 py-1 transition ${
            value === o.value ? "border-accent-primary bg-accent-primary/20 text-white" : "border-border text-foreground/50"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
