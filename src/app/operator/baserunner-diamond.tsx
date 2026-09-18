"use client";

import type { Runners } from "@/lib/supabase/types";

// viewBox is 0-200 (doubled from an original 0-100 in an earlier fix,
// every base/home position scaled 2x with it -- the diamond's own
// geometry, i.e. the proportions between bases, is unchanged since then).
// A later fix made the diamond fill most of the right panel and grew the
// runner dot/text well beyond a flat proportional scale; the
// height-alignment/popup-size batch after that walked the *container*
// size back down (see operator-console.tsx -- the diamond is now capped
// to ~60% of the right panel, not left to fill essentially all of it) and
// shrunk the dot and text with it, since runners were reading as
// oversized. RUNNER_R/jersey fontSize/name fontSize below are chosen the
// same way the previous batch's 44px target was: the raw viewBox-unit
// number mirrors the requested pixel number directly (36 viewBox units of
// diameter for a "36px" ask), which is a reasonable approximation given
// the container itself is a comparable number of pixels at realistic
// panel sizes -- not an exact pixel guarantee, same caveat as every other
// "approximately Npx" sizing decision in this codebase.
const BASE_POS = {
  first: { x: 156, y: 124 },
  second: { x: 100, y: 68 },
  third: { x: 44, y: 124 },
} as const;
const BASE_HALF = 16; // 32-unit-wide base squares -- large, easy tablet tap targets, unchanged by this fix
const RUNNER_R = 18; // 36-unit diameter, mirroring the "36px" ask

export function BaserunnerDiamond({
  runners,
  pending,
  onBaseTap,
}: {
  runners: Runners;
  pending?: boolean;
  onBaseTap: (base: "first" | "second" | "third") => void;
}) {
  return (
    <svg viewBox="0 0 200 200" className="h-full w-full">
      <path
        d="M 100 180 L 156 124 L 100 68 L 44 124 Z"
        fill="none"
        stroke="#1A3D28"
        strokeWidth="3"
      />
      {(["first", "second", "third"] as const).map((base) => {
        const pos = BASE_POS[base];
        const runner = runners[base];
        // Bases glow when occupied -- amber while a suggested movement is
        // still pending review, green once confirmed. The runner dot
        // (gold, jersey number in dark text, its own glow) is a separate
        // layer on top -- the base square is "is this base occupied,"
        // the dot is "who exactly."
        const fill = runner ? (pending ? "#EF9F27" : "#2ECC71") : "#0A2214";
        return (
          <g key={base} onClick={() => onBaseTap(base)} className="cursor-pointer">
            <rect
              x={pos.x - BASE_HALF}
              y={pos.y - BASE_HALF}
              width={BASE_HALF * 2}
              height={BASE_HALF * 2}
              transform={`rotate(45 ${pos.x} ${pos.y})`}
              fill={fill}
              stroke={fill}
              strokeWidth="2"
              className={runner && pending ? "animate-pulse" : undefined}
              style={runner && !pending ? { filter: "drop-shadow(0 0 5px #2ECC71)" } : undefined}
            />
            {runner && (
              <>
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={RUNNER_R}
                  fill="#F0C060"
                  stroke="#030A06"
                  strokeWidth="1.2"
                  style={{ filter: "drop-shadow(0 0 6px rgba(240, 192, 96, 0.9))" }}
                />
                <text x={pos.x} y={pos.y + 6} textAnchor="middle" fontSize="18" fontWeight="bold" fill="#030A06">
                  {runner.jersey ?? "•"}
                </text>
                <text x={pos.x} y={pos.y + RUNNER_R + 14} textAnchor="middle" fontSize="11" fill="#C8F0D5">
                  {runner.name.length > 12 ? `${runner.name.slice(0, 11)}…` : runner.name}
                </text>
              </>
            )}
          </g>
        );
      })}
      <rect
        x="90"
        y="170"
        width="20"
        height="20"
        transform="rotate(45 100 180)"
        fill="#0A2214"
        stroke="#1A3D28"
        strokeWidth="2"
      />
    </svg>
  );
}
