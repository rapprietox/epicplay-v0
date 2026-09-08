"use client";

import type { Runners } from "@/lib/supabase/types";

const BASE_POS = {
  first: { x: 78, y: 62 },
  second: { x: 50, y: 34 },
  third: { x: 22, y: 62 },
} as const;

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
    <svg viewBox="0 0 100 100" className="w-full max-w-[220px]">
      <path
        d="M 50 90 L 78 62 L 50 34 L 22 62 Z"
        fill="none"
        stroke="#1A3D28"
        strokeWidth="1.5"
      />
      {(["first", "second", "third"] as const).map((base) => {
        const pos = BASE_POS[base];
        const runner = runners[base];
        const fill = runner ? (pending ? "#EF9F27" : "#2ECC71") : "#0A2214";
        return (
          <g key={base} onClick={() => onBaseTap(base)} className="cursor-pointer">
            <rect
              x={pos.x - 5}
              y={pos.y - 5}
              width="10"
              height="10"
              transform={`rotate(45 ${pos.x} ${pos.y})`}
              fill={fill}
              stroke={fill}
              strokeWidth="1"
              className={runner && pending ? "animate-pulse" : undefined}
              style={runner && !pending ? { filter: "drop-shadow(0 0 4px #00FF7F)" } : undefined}
            />
            {runner && (
              <text x={pos.x} y={pos.y + 14} textAnchor="middle" fontSize="6" fill="#C8F0D5">
                {runner.jersey ? `#${runner.jersey} ` : ""}
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
        fill="#0A2214"
        stroke="#1A3D28"
        strokeWidth="1"
      />
    </svg>
  );
}
