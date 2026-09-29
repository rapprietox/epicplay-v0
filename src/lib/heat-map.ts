import type { AtBatResult, HitType, PitchOutcome, PitchType } from "@/lib/supabase/types";

// ground_rule_double counts as a double everywhere a regular double does
// (Fix 9, baseball-logic-fixes batch, minor tier).
export const HIT_RESULTS = new Set<AtBatResult>(["single", "double", "triple", "hr", "ground_rule_double"]);
const EXTRA_BASE_HIT_RESULTS = new Set<AtBatResult>(["double", "triple", "ground_rule_double"]);

// Same 3x3 thirds as the operator's strike zone grid (33.33/66.67
// boundaries), 0-8 reading left-to-right, top-to-bottom. Returns null for
// anything outside the strike zone itself (x/y outside 0-100) -- since
// Fix 2, a pitch's zone_x/zone_y can land in the surrounding ball-zone
// ring (see strike-zone-grid.tsx), and those pitches correctly don't
// belong in any of these 9 strike-zone buckets.
export function zoneIndexFromCoords(x: number, y: number): number | null {
  if (x < 0 || x > 100 || y < 0 || y > 100) return null;
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
    if (ab.result === "walk" || ab.result === "intentional_walk" || ab.result === "hbp") continue; // not AB, no zone-BA signal
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

// field-2d.png spray chart batch: a second, deliberately separate
// category/color scheme for the player page's "Dots" view specifically
// -- collapses hit/xbh into one "Hit" bucket, recolors HR gold instead
// of white, and adds a distinct "error" bucket the older scheme folded
// into "out". Kept apart from resultCategory/SPRAY_CATEGORY_COLOR rather
// than changing those in place, since that pair is also used by the
// coach dashboard's team-wide spray chart (team-analytics.tsx), which
// this request never asked to restyle -- changing the shared one would
// have silently changed that chart's appearance too.
export type DotResultCategory = "hit" | "hr" | "out" | "error";

export function dotResultCategory(result: AtBatResult): DotResultCategory {
  if (result === "hr") return "hr";
  if (result === "error") return "error";
  if (HIT_RESULTS.has(result)) return "hit"; // hr already handled above -- this only reaches single/double/triple/ground_rule_double
  return "out";
}

export const DOT_RESULT_COLOR: Record<DotResultCategory, string> = {
  hit: "#2ECC71",
  hr: "#F0C060",
  out: "#E24B4A",
  error: "#EF9F27",
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

// Whiff-rate / pitch-location maps batch: an extended 25-zone bucket (9
// strike-zone cells + 16 ball-zone ring cells), ported from the
// operator's own ring geometry (RING_X=20/RING_Y=16, see
// strike-zone-grid.tsx's classifyZone -- that file is the operator's
// client-only tap-handling UI, so this ports the pure math rather than
// importing it) instead of the request's own looser "9 + 8" framing --
// the ring pitches are actually captured across 16 real cells (3 per
// side + 4 corners, not 8), and bucketing them any coarser would
// misrepresent where a logged pitch actually landed. zoneIndexFromCoords
// above (9-zone only, null outside the strike zone) is unchanged and
// still what the batting-average heat map uses -- this is additive, not
// a replacement.
const THIRDS = [100 / 3, (2 * 100) / 3];
const RING_X = 20;
const RING_Y = 16;
const EXT_MIN_X = -RING_X;
const EXT_MAX_X = 100 + RING_X;
const EXT_MIN_Y = -RING_Y;
const EXT_MAX_Y = 100 + RING_Y;
const GRID_BOUNDS_X = [EXT_MIN_X, 0, THIRDS[0], THIRDS[1], 100, EXT_MAX_X];
const GRID_BOUNDS_Y = [EXT_MIN_Y, 0, THIRDS[0], THIRDS[1], 100, EXT_MAX_Y];

function cellIndex(v: number, bounds: number[]): number {
  for (let i = 0; i < bounds.length - 2; i++) {
    if (v < bounds[i + 1]) return i;
  }
  return bounds.length - 2;
}

export interface ExtendedZone {
  col: number;
  row: number;
  isBallZone: boolean;
  index: number; // 0-24, row * 5 + col
}

export const EXTENDED_ZONE_COUNT = 25;

export function extendedZoneFromCoords(x: number, y: number): ExtendedZone {
  const col = cellIndex(x, GRID_BOUNDS_X);
  const row = cellIndex(y, GRID_BOUNDS_Y);
  return { col, row, isBallZone: col === 0 || col === 4 || row === 0 || row === 4, index: row * 5 + col };
}

// Plain grid-relative terms (not corrected for batter handedness -- this
// app doesn't mirror any other zone display by batting hand either, see
// hbpEligible's own handedness handling in operator-console.tsx, which
// stays scoped to HBP eligibility specifically). Used both as the small
// on-cell label and as the human-readable zone name fed to the AI
// insights prompt.
const ROW_LABELS = ["High (out of zone)", "High", "Middle", "Low", "Low (out of zone)"];
const COL_LABELS = ["Far Inside", "Inside", "Middle", "Outside", "Far Outside"];

export function extendedZoneLabel(index: number): string {
  const row = Math.floor(index / 5);
  const col = index % 5;
  if (row === 2 && col === 2) return "Down the Middle";
  return `${ROW_LABELS[row]}-${COL_LABELS[col]}`;
}

// Same labeling, for the plain 9-zone strike-zone-only grid
// (zoneIndexFromCoords's own 0-8 index space, used by the existing
// batting-average heat map) -- reuses the extended grid's row 1-3/col
// 1-3 labels ("High"/"Middle"/"Low" x "Inside"/"Middle"/"Outside")
// rather than a second hand-written label set.
export function zoneLabel9(index: number): string {
  const row = Math.floor(index / 3) + 1;
  const col = (index % 3) + 1;
  if (row === 2 && col === 2) return "Down the Middle";
  return `${ROW_LABELS[row]}-${COL_LABELS[col]}`;
}

// Whiff Rate by Zone (Map 2): swing-and-miss share of swings taken in
// each zone. Only pitches.swing === true count as a swing at all;
// "miss" is strike/foul_tip specifically -- a plain "foul" means the bat
// made contact, so it's excluded even though it's also a strike (per
// spec: "NOT 'foul' since foul means contact was made"). Below
// MIN_SWINGS_FOR_RATE, rate is null (not 0) so the UI can render "--"
// instead of a misleadingly precise percentage from 1-2 swings.
export const MIN_SWINGS_FOR_RATE = 3;

export interface ZoneWhiffLine {
  swings: number;
  misses: number;
  rate: number | null;
}

function emptyWhiffLines(): ZoneWhiffLine[] {
  return Array.from({ length: EXTENDED_ZONE_COUNT }, () => ({ swings: 0, misses: 0, rate: null }));
}

export interface WhiffPitch {
  swing: boolean | null;
  outcome: PitchOutcome;
  zone_x: number | null;
  zone_y: number | null;
}

export function computeZoneWhiffLines(pitches: WhiffPitch[]): ZoneWhiffLine[] {
  const lines = emptyWhiffLines();
  for (const p of pitches) {
    if (p.swing !== true || p.zone_x === null || p.zone_y === null) continue;
    const { index } = extendedZoneFromCoords(p.zone_x, p.zone_y);
    lines[index].swings += 1;
    if (p.outcome === "strike" || p.outcome === "foul_tip") lines[index].misses += 1;
  }
  for (const line of lines) {
    line.rate = line.swings >= MIN_SWINGS_FOR_RATE ? line.misses / line.swings : null;
  }
  return lines;
}

// Inverted from zoneColor (batting average) on purpose -- here red means
// bad *for the batter*, i.e. good for the pitcher attacking that zone.
export function whiffRateColor(line: ZoneWhiffLine): string {
  if (line.rate === null) return "#1A3D28";
  if (line.rate <= 0.15) return "#173A22";
  if (line.rate <= 0.3) return "#EF9F27";
  if (line.rate <= 0.5) return "#E8720C";
  return "#E24B4A";
}

// Pitcher's-own-whiff-rate maps batch: the exact same computeZoneWhiffLines
// output (swing/miss are swing/miss regardless of whose pitches they
// are), colored in the opposite direction -- here green means good *for
// the pitcher* (batters can't touch this zone), red means the pitcher's
// weak spot. Deliberately a separate function from whiffRateColor rather
// than a boolean flag on it, since the two color scales don't share a
// single inverted mapping (the bands' own cut points also read
// differently: "money zone" gets its own glow-worthy top band).
export function pitcherWhiffRateColor(line: ZoneWhiffLine): string {
  if (line.rate === null) return "#1A3D28";
  if (line.rate <= 0.15) return "#7A2020";
  if (line.rate <= 0.3) return "#EF9F27";
  if (line.rate <= 0.5) return "#6FCB6F";
  return "#2ECC71";
}

// Pitch Location Tendency (Map 3): what share of pitches thrown to this
// batter (or, at team scale, to the whole lineup) landed in each zone --
// frequency, not outcome. A pitch with no location (zone_x/zone_y null --
// e.g. a direct-HBP button or a wild-pitch/passed-ball-logged "ball",
// both of which force a null zone) has nothing to bucket and is excluded
// from both the per-zone counts and the total.
export interface ZoneLocationLine {
  count: number;
  pct: number; // 0-100, share of the total located pitches
}

export interface LocationPitch {
  zone_x: number | null;
  zone_y: number | null;
}

export function computeZoneLocationLines(pitches: LocationPitch[]): ZoneLocationLine[] {
  const counts = Array.from({ length: EXTENDED_ZONE_COUNT }, () => 0);
  let total = 0;
  for (const p of pitches) {
    if (p.zone_x === null || p.zone_y === null) continue;
    const { index } = extendedZoneFromCoords(p.zone_x, p.zone_y);
    counts[index] += 1;
    total += 1;
  }
  return counts.map((count) => ({ count, pct: total > 0 ? (count / total) * 100 : 0 }));
}

export function pitchLocationColor(line: ZoneLocationLine): string {
  if (line.count === 0) return "#1A3D28";
  if (line.pct <= 5) return "#12240F";
  if (line.pct <= 15) return "#1D5A34";
  if (line.pct <= 25) return "#24A058";
  if (line.pct <= 35) return "#2ECC71";
  return "#F0C060";
}

// Pitcher Location Tendency ("does he telegraph?") batch: same
// computeZoneLocationLines output as the batter-facing map, but amber
// toned instead of green toned -- per spec, a distinct palette from
// "where pitchers attack this batter" so the two location maps (batter
// page's Map 3 vs. pitcher page's Map 3) read as visually distinct at a
// glance even though the underlying math is identical.
export function pitcherLocationColor(line: ZoneLocationLine): string {
  if (line.count === 0) return "#1A3D28";
  if (line.pct <= 5) return "#241A0A";
  if (line.pct <= 15) return "#5A3D1D";
  if (line.pct <= 25) return "#A0701F";
  if (line.pct <= 35) return "#EF9F27";
  return "#F0C060";
}

// Damage Rate batch (pitcher Map 2's second toggle): "dangerous contact"
// is an AT-BAT-level fact (its final result/hit_type), unlike whiff rate
// which is a genuine per-pitch fact (any pitch can be swung at and
// missed). Only the pitch that actually ended the at-bat -- the one put
// in play -- can be "the" damage pitch, so this follows the same "last
// pitch of the at-bat" convention computeZoneBattingLines already uses
// for batting-average-by-zone (see AtBatWithZone above), just scored
// pitch-by-pitch instead of at-bat-by-at-bat so it can share
// WhiffRateHeatmap's per-pitch-type toggle and "total pitches" (not
// "total balls in play") denominator, per spec.
//
// ground_rule_double isn't named in the spec's own result list
// (single/double/triple/hr) but is functionally a fly-ball double in
// every practical sense (see HIT_RESULTS's own "counts everywhere a
// double does" precedent) -- included rather than silently excluded.
export function isDamageAtBat(result: AtBatResult, hitType: HitType | null): boolean {
  if (result === "hr") return true;
  if (hitType === "linedrive") return true;
  if (hitType === "flyball" && (result === "single" || result === "double" || result === "triple" || result === "ground_rule_double")) return true;
  return false;
}

export interface DamageAtBat {
  id: string;
  result: AtBatResult | null;
  hitType: HitType | null;
}

export interface DamagePitchInput {
  at_bat_id: string;
  pitch_number: number;
}

// Joins pitches to their at-bat's damage status -- true only on the one
// pitch (per at-bat) that both ended it (highest pitch_number logged for
// that at_bat_id) and qualifies per isDamageAtBat. Every other pitch,
// including earlier pitches of the same at-bat, gets false: they still
// count toward a zone's total-pitches denominator (computeZoneDamageLines
// below), just never toward the damage numerator, since only one pitch
// per at-bat can be "the pitch that got hit."
export function attachDamageFlag<P extends DamagePitchInput>(atBats: DamageAtBat[], pitches: P[]): (P & { isDamage: boolean })[] {
  const lastPitchNumberByAtBat = new Map<string, number>();
  for (const p of pitches) {
    const current = lastPitchNumberByAtBat.get(p.at_bat_id);
    if (current === undefined || p.pitch_number > current) lastPitchNumberByAtBat.set(p.at_bat_id, p.pitch_number);
  }
  const damageAtBatIds = new Set(
    atBats.filter((ab): ab is DamageAtBat & { result: AtBatResult } => ab.result !== null && isDamageAtBat(ab.result, ab.hitType)).map((ab) => ab.id)
  );
  return pitches.map((p) => ({
    ...p,
    isDamage: damageAtBatIds.has(p.at_bat_id) && lastPitchNumberByAtBat.get(p.at_bat_id) === p.pitch_number,
  }));
}

export const MIN_PITCHES_FOR_DAMAGE_RATE = 3;

export interface ZoneDamageLine {
  total: number;
  damage: number;
  rate: number | null;
}

export interface DamagePitch {
  zone_x: number | null;
  zone_y: number | null;
  isDamage: boolean;
}

export function computeZoneDamageLines(pitches: DamagePitch[]): ZoneDamageLine[] {
  const lines: ZoneDamageLine[] = Array.from({ length: EXTENDED_ZONE_COUNT }, () => ({ total: 0, damage: 0, rate: null }));
  for (const p of pitches) {
    if (p.zone_x === null || p.zone_y === null) continue;
    const { index } = extendedZoneFromCoords(p.zone_x, p.zone_y);
    lines[index].total += 1;
    if (p.isDamage) lines[index].damage += 1;
  }
  for (const line of lines) {
    line.rate = line.total >= MIN_PITCHES_FOR_DAMAGE_RATE ? line.damage / line.total : null;
  }
  return lines;
}

// Green = safe for the pitcher, red = danger -- same direction as
// pitcherWhiffRateColor's green-good scale, but its own cut points/hues
// (this spec's bands don't line up with the whiff scale's).
export function damageRateColor(line: ZoneDamageLine): string {
  if (line.rate === null) return "#1A3D28";
  if (line.rate <= 0.1) return "#2ECC71";
  if (line.rate <= 0.25) return "#EF9F27";
  if (line.rate <= 0.4) return "#E8720C";
  return "#E24B4A";
}

// Shared "All / Fastball / Curveball / Changeup / Slider" toggle for Map
// 2 and Map 3 -- each map keeps its own independent selection (per
// spec), but both draw from this same option list so "All" is spelled
// and ordered identically everywhere it appears. Deliberately the same 4
// pitch types PITCH_TYPES (count-stats.ts) already covers -- 2seam/other
// exist in the schema but weren't named in this request, so they fold
// into "All" rather than getting their own tab.
export const ZONE_MAP_PITCH_FILTERS: { value: PitchType | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "fastball", label: "Fastball" },
  { value: "curveball", label: "Curveball" },
  { value: "changeup", label: "Changeup" },
  { value: "slider", label: "Slider" },
];
