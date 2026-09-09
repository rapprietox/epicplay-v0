import type { AtBatResult } from "@/lib/supabase/types";

export const HIT_RESULTS = new Set<AtBatResult>(["single", "double", "triple", "hr"]);
const EXTRA_BASE_HIT_RESULTS = new Set<AtBatResult>(["double", "triple"]);

// Same 3x3 thirds as the operator's strike zone grid (33.33/66.67
// boundaries), 0-8 reading left-to-right, top-to-bottom.
export function zoneIndexFromCoords(x: number, y: number): number {
  const col = Math.min(2, Math.floor(x / (100 / 3)));
  const row = Math.min(2, Math.floor(y / (100 / 3)));
  return row * 3 + col;
}

export interface ZoneBattingLine {
  ab: number;
  h: number;
  avg: number;
}

function emptyZoneLines(): ZoneBattingLine[] {
  return Array.from({ length: 9 }, () => ({ ab: 0, h: 0, avg: 0 }));
}

// One entry per confirmed at-bat: the result and the zone of the pitch
// that ended it (the last pitch logged for that at-bat) -- that's the
// pitch location a "strike zone heat map by batting average" actually
// means, since only that final pitch is tied to the at-bat's outcome.
export interface AtBatWithZone {
  result: AtBatResult;
  zoneIndex: number | null;
}

export function computeZoneBattingLines(atBats: AtBatWithZone[]): ZoneBattingLine[] {
  const lines = emptyZoneLines();
  for (const ab of atBats) {
    if (ab.zoneIndex === null) continue;
    if (ab.result === "walk" || ab.result === "hbp") continue; // not AB, no zone-BA signal
    const line = lines[ab.zoneIndex];
    line.ab += 1;
    if (HIT_RESULTS.has(ab.result)) line.h += 1;
  }
  for (const line of lines) {
    line.avg = line.ab > 0 ? line.h / line.ab : 0;
  }
  return lines;
}

// Dark green (weak) -> amber -> bright green -> gold (elite), matching the
// Sprint 4 spec's exact thresholds. Zones with no at-bats render neutral.
export function zoneColor(line: ZoneBattingLine): string {
  if (line.ab === 0) return "#1A3D28";
  if (line.avg >= 0.4) return "#F0C060";
  if (line.avg >= 0.3) return "#2ECC71";
  if (line.avg >= 0.151) return "#EF9F27";
  return "#173A22";
}

export interface SprayDot {
  x: number;
  y: number;
  category: "hit" | "out" | "xbh" | "hr";
  result: AtBatResult;
  inning: number;
  gameDate: string;
  opponentName: string;
  hitType: string | null;
}

export function resultCategory(result: AtBatResult): SprayDot["category"] {
  if (result === "hr") return "hr";
  if (EXTRA_BASE_HIT_RESULTS.has(result)) return "xbh";
  if (HIT_RESULTS.has(result)) return "hit";
  return "out";
}

export const SPRAY_CATEGORY_COLOR: Record<SprayDot["category"], string> = {
  hit: "#2ECC71",
  out: "#E24B4A",
  xbh: "#F0C060",
  hr: "#FFFFFF",
};

// Spray-chart "Lines" view: color radiating from home plate by how the ball
// was hit, not by outcome. A home run always reads as the result (white +
// glow), regardless of what hit_type got logged for it; hit_type values
// outside the four tracked types (e.g. "bunt", or null) fall back to "other"
// rather than guessing.
export type LineHitCategory = "flyball" | "groundball" | "linedrive" | "popup" | "hr" | "other";

export function lineHitCategory(dot: Pick<SprayDot, "result" | "hitType">): LineHitCategory {
  if (dot.result === "hr") return "hr";
  if (dot.hitType === "flyball" || dot.hitType === "groundball" || dot.hitType === "linedrive" || dot.hitType === "popup") {
    return dot.hitType;
  }
  return "other";
}

export const LINE_HIT_CATEGORY_COLOR: Record<LineHitCategory, string> = {
  flyball: "#2ECC71",
  groundball: "#EF9F27",
  linedrive: "#F0C060",
  popup: "#1A6B3C",
  hr: "#FFFFFF",
  other: "#5A7A8A",
};

export const LINE_HIT_CATEGORY_LABEL: Record<LineHitCategory, string> = {
  flyball: "Fly Ball",
  groundball: "Ground Ball",
  linedrive: "Line Drive",
  popup: "Pop Up",
  hr: "Home Run",
  other: "Other",
};
