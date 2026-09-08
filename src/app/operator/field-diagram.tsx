"use client";

import { useRef } from "react";

export function FieldDiagram({
  tap,
  onTap,
}: {
  tap: { x: number; y: number } | null;
  onTap: (x: number, y: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);

  function handleClick(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    onTap(Math.round(x * 10) / 10, Math.round(y * 10) / 10);
  }

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 100 100"
      onClick={handleClick}
      className="w-full max-w-[360px] cursor-crosshair rounded-md border border-border bg-background"
    >
      {/* Outfield grass */}
      <path
        d="M 50 92 L 8 50 A 60 60 0 0 1 92 50 Z"
        fill="#2D5A1B"
        stroke="#1A3D28"
        strokeWidth="0.5"
      />
      {/* Infield grass */}
      <path d="M 50 92 L 28 70 A 32 32 0 0 1 72 70 Z" fill="#3A7A25" />
      <path d="M 50 92 L 8 50 M 50 92 L 92 50" stroke="#C8F0D5" strokeWidth="0.4" opacity="0.4" />
      <rect x="35" y="35" width="24" height="24" fill="#A9814B" transform="rotate(45 50 62)" opacity="0.85" />
      <circle cx="50" cy="62" r="1.6" fill="#C8F0D5" />
      <path d="M 47.5 92 L 52.5 92 L 52.5 89.5 L 50 87.5 L 47.5 89.5 Z" fill="#C8F0D5" />

      {tap && (
        <circle cx={tap.x} cy={tap.y} r="2" fill="#F0C060" stroke="#030A06" strokeWidth="0.5" />
      )}
    </svg>
  );
}
