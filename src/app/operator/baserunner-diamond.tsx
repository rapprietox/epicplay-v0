"use client";

import type { Runners } from "@/lib/supabase/types";

// Fix 3 (layout proportions batch): viewBox doubled from 0-100 to 0-200 and
// every base/home position scaled 2x with it, keeping the diamond's own
// geometry (proportions between bases) identical to before -- only the
// container this renders into got bigger (see operator-console.tsx, where
// the wrapping middle section now gives the diamond ~75%+ of the right
// panel's height instead of the old ~280px cap). The runner dot radius and
// text sizes are *not* a flat 2x of their old values -- they're grown
// further on top of that, since "44px+ diameter, clearly readable jersey
// numbers, easy-to-tap bases" are their own explicit requirements, not a
// side effect of the viewBox getting bigger (a pure uniform scale changes
// nothing about a shape's size relative to its container).
const BASE_POS = {
  first: { x: 156, y: 124 },
  second: { x: 100, y: 68 },
  third: { x: 44, y: 124 },
} as const;
const BASE_HALF = 16; // 32-unit-wide base squares -- large, easy tablet tap targets
const RUNNER_R = 22; // >=44-unit diameter, comfortably clears a 44px target at any realistic panel size

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
                <text x={pos.x} y={pos.y + 7} textAnchor="middle" fontSize="22" fontWeight="bold" fill="#030A06">
                  {runner.jersey ?? "•"}
                </text>
                <text x={pos.x} y={pos.y + RUNNER_R + 16} textAnchor="middle" fontSize="12" fill="#C8F0D5">
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
