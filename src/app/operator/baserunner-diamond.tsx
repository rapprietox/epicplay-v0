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
    <svg viewBox="0 0 100 100" className="h-full w-full max-w-[280px]">
      <path
        d="M 50 90 L 78 62 L 50 34 L 22 62 Z"
        fill="none"
        stroke="#1A3D28"
        strokeWidth="1.5"
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
              x={pos.x - 5}
              y={pos.y - 5}
              width="10"
              height="10"
              transform={`rotate(45 ${pos.x} ${pos.y})`}
              fill={fill}
              stroke={fill}
              strokeWidth="1"
              className={runner && pending ? "animate-pulse" : undefined}
              style={runner && !pending ? { filter: "drop-shadow(0 0 5px #2ECC71)" } : undefined}
            />
            {runner && (
              <>
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r="6.5"
                  fill="#F0C060"
                  stroke="#030A06"
                  strokeWidth="0.6"
                  style={{ filter: "drop-shadow(0 0 6px rgba(240, 192, 96, 0.9))" }}
                />
                <text x={pos.x} y={pos.y + 2.2} textAnchor="middle" fontSize="6.5" fontWeight="bold" fill="#030A06">
                  {runner.jersey ?? "•"}
                </text>
                <text x={pos.x} y={pos.y + 13} textAnchor="middle" fontSize="5.5" fill="#C8F0D5">
                  {runner.name.length > 12 ? `${runner.name.slice(0, 11)}…` : runner.name}
                </text>
              </>
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
