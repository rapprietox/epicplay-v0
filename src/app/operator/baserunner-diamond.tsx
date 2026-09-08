"use client";

import type { Runners } from "@/lib/supabase/types";

const BASE_POS = {
  first: { x: 78, y: 62 },
  second: { x: 50, y: 34 },
  third: { x: 22, y: 62 },
} as const;

export function BaserunnerDiamond({
  runners,
  onBaseTap,
}: {
  runners: Runners;
  onBaseTap: (base: "first" | "second" | "third") => void;
}) {
  return (
    <svg viewBox="0 0 100 100" className="w-full max-w-[220px]">
      <path
        d="M 50 90 L 78 62 L 50 34 L 22 62 Z"
        fill="none"
        stroke="#1A2D4A"
        strokeWidth="1.5"
      />
      {(["first", "second", "third"] as const).map((base) => {
        const pos = BASE_POS[base];
        const runner = runners[base];
        return (
          <g key={base} onClick={() => onBaseTap(base)} className="cursor-pointer">
            <rect
              x={pos.x - 5}
              y={pos.y - 5}
              width="10"
              height="10"
              transform={`rotate(45 ${pos.x} ${pos.y})`}
              fill={runner ? "#F0C060" : "#0D1E35"}
              stroke={runner ? "#F0C060" : "#1A2D4A"}
              strokeWidth="1"
            />
            {runner && (
              <text
                x={pos.x}
                y={pos.y + 14}
                textAnchor="middle"
                fontSize="6"
                fill="#C5D8F0"
              >
                {runner.name.length > 12 ? `${runner.name.slice(0, 11)}…` : runner.name}
              </text>
            )}
          </g>
        );
      })}
      <rect
        x="45"
        y="85"
        width="10"
        height="10"
        transform="rotate(45 50 90)"
        fill="#0D1E35"
        stroke="#1A2D4A"
        strokeWidth="1"
      />
    </svg>
  );
}
