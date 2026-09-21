import type { AtBatResult, FieldCalibrationPoints, FieldingPosition, HitType, PlayerPositionCalibration } from "@/lib/supabase/types";

// Feature 1 (fielding-play logging batch): scorebook position numbers,
// the standard 1-9 baseball convention -- P/C/1B/2B/3B/SS/LF/CF/RF.
export const FIELDER_NUMBER_TO_POSITION: Record<number, FieldingPosition> = {
  1: "P",
  2: "C",
  3: "1B",
  4: "2B",
  5: "3B",
  6: "SS",
  7: "LF",
  8: "CF",
  9: "RF",
};
export const FIELDING_POSITION_TO_NUMBER: Record<FieldingPosition, number> = {
  P: 1,
  C: 2,
  "1B": 3,
  "2B": 4,
  "3B": 5,
  SS: 6,
  LF: 7,
  CF: 8,
  RF: 9,
};

type Vec = { x: number; y: number };

function sub(a: Vec, b: Vec): Vec {
  return { x: a.x - b.x, y: a.y - b.y };
}
function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
// Signed angle (radians) of `v` relative to `forward`, positive = clockwise
// (toward the right side of the field as viewed top-down with home plate
// at the bottom and center field at the top -- i.e. toward 1B/RF).
function angleFrom(forward: Vec, v: Vec): number {
  const cross = forward.x * v.y - forward.y * v.x;
  const dot = forward.x * v.x + forward.y * v.y;
  return Math.atan2(cross, dot);
}

// Where a batted ball landed, translated into a scorebook position number
// (1-9), derived entirely from the 7 field_calibration anchor points --
// no separate "zone" table, no hand-drawn polygons. The model:
//
//  - The mound isn't one of the 7 calibrated anchors, so it's synthesized
//    at the real MLB ratio along the home-to-2nd-base line (60.5ft mound
//    distance / ~127.3ft home-to-2nd diagonal =~ 0.475).
//  - Distance from home plate decides infield vs. outfield, using the
//    home-to-2nd-base distance as the reference scale (a fixed 1.35x
//    multiplier stands in for "past the infield dirt," since there's no
//    calibrated dirt-cutout anchor to use instead).
//  - Within a short radius of home plate or the mound (15% of the
//    home-to-2nd distance each), it's C or P respectively. At that radius
//    the two circles don't overlap (mound sits ~47.5% of the way to 2nd,
//    more than the two 15% radii combined), so a tap can only ever land
//    in one of them -- P is simply checked first for a well-defined order.
//  - The rest of the infield is split into 4 equal angular sectors
//    between the home->3rd and home->1st lines (3B, SS, 2B, 1B in order,
//    left to right) -- matching real defensive alignment (SS plays
//    left-center, 2B plays right-center).
//  - The outfield is split into 3 equal angular sectors between the
//    home->LF-wall and home->RF-wall lines (LF, CF, RF).
//
// A tap outside the fair-territory angular span (foul ground) clamps to
// the nearest edge sector rather than erroring -- this diagram is for
// marking where a fair ball was fielded, not a general-purpose foul
// tracker.
export function zoneForPoint(x: number, y: number, cal: FieldCalibrationPoints): number {
  const home = cal.home_plate;
  const tap: Vec = { x, y };

  const r2b = dist(home, cal.second_base);
  const mound: Vec = {
    x: home.x + 0.475 * (cal.second_base.x - home.x),
    y: home.y + 0.475 * (cal.second_base.y - home.y),
  };

  const distFromHome = dist(home, tap);
  const distFromMound = dist(mound, tap);
  const cInnerRadius = 0.15 * r2b;
  const pInnerRadius = 0.15 * r2b;

  if (distFromMound <= pInnerRadius) return 1; // P
  if (distFromHome <= cInnerRadius) return 2; // C

  // "Forward" = straight up the middle, home toward the CF wall anchor --
  // every angle below is measured relative to this.
  const forward = sub(cal.cf_wall, home);
  const angle3B = angleFrom(forward, sub(cal.third_base, home));
  const angle1B = angleFrom(forward, sub(cal.first_base, home));
  const angleLF = angleFrom(forward, sub(cal.lf_wall, home));
  const angleRF = angleFrom(forward, sub(cal.rf_wall, home));
  const tapAngle = angleFrom(forward, sub(tap, home));

  const outfield = distFromHome > 1.35 * r2b;

  if (outfield) {
    // 3 equal sectors from the LF-wall angle to the RF-wall angle.
    const clamped = Math.max(angleLF, Math.min(angleRF, tapAngle));
    const t = (clamped - angleLF) / (angleRF - angleLF || 1);
    if (t < 1 / 3) return 7; // LF
    if (t < 2 / 3) return 8; // CF
    return 9; // RF
  }

  // 4 equal sectors from the 3B-line angle to the 1B-line angle: 3B, SS,
  // 2B, 1B, left to right -- matches how those positions actually line up
  // on a real infield.
  const clamped = Math.max(angle3B, Math.min(angle1B, tapAngle));
  const t = (clamped - angle3B) / (angle1B - angle3B || 1);
  if (t < 0.25) return 5; // 3B
  if (t < 0.5) return 6; // SS
  if (t < 0.75) return 4; // 2B
  return 3; // 1B
}

// Change 2 (calibrate-field-tabs batch): replaces the old formula-based
// standardPositionLocations entirely -- rather than synthesizing a
// defensive position from the 7 field anchors, the lineup builder now
// reads hand-placed points from the "Player Positions" calibration tab
// (field_type 'positions') directly, no math or interpolation. This
// function's only job is matching an arbitrary drop location to whichever
// saved point is closest, so dropping "near SS" still works without the
// operator needing pixel-perfect aim. DH is deliberately excluded -- it
// has its own dedicated drop zone in the lineup builder (not the field
// diagram), so a drop on the diagram should never resolve to it even if
// a DH point happens to be the closest one calibrated.
const DEFENSIVE_POSITION_KEYS: FieldingPosition[] = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];

export function nearestSavedPosition(x: number, y: number, cal: PlayerPositionCalibration): FieldingPosition | null {
  let best: FieldingPosition | null = null;
  let bestDist = Infinity;
  for (const key of DEFENSIVE_POSITION_KEYS) {
    const point = cal[key];
    if (!point) continue;
    const d = dist({ x, y }, point);
    if (d < bestDist) {
      bestDist = d;
      best = key;
    }
  }
  return best;
}

export type OutBase = "first" | "second" | "third" | "home" | "tag";

export const OUT_BASE_LABELS: Record<OutBase, string> = {
  first: "1st Base",
  second: "2nd Base",
  third: "3rd Base",
  home: "Home",
  tag: "Tag",
};

// Which fielder conventionally covers a base for a force/tag out there,
// given who most recently had the ball (so the same fielder doesn't
// "throw to themselves" for a routine unassisted play, and so a force at
// 2nd doesn't credit the same middle infielder who just fielded it --
// real defenses always use the *other* one). "tag" has no standard
// coverage at all (could be anyone, e.g. a rundown), so it defaults to
// whoever last touched the ball -- an unassisted-reading default the
// operator can always override via the fielder picker.
export function standardCoveringFielder(base: OutBase, precedingFielder: number): number {
  if (base === "tag") return precedingFielder;
  const standard: Record<Exclude<OutBase, "tag">, number> = { first: 3, second: 4, third: 5, home: 2 };
  let covering = standard[base];
  if (covering === precedingFielder) {
    if (base === "second") covering = precedingFielder === 4 ? 6 : 4;
    else covering = precedingFielder; // unassisted -- same fielder makes the play
  }
  return covering;
}

// Standard scorebook notation for a fielded play, given the sequence of
// fielders involved. Deliberately doesn't attempt error/fielder's-choice
// symbols (E5, FC6, etc.) -- every step captured by this flow is a
// confirmed out, so the chain is always a straightforward assist
// sequence, ending "DP"/"TP" when more than one out was recorded.
//
// initialFielder: who fielded/caught the ball (Step 1).
// batterOutFielder: who's credited with the batter's own out, if the
//   batter was retired this play (null for e.g. a fielder's choice where
//   only another runner is out and the batter reaches).
// extraOutFielders: additional runner outs, in the order recorded (Steps
//   3/4) -- placed *before* the batter's own out in the chain, since a
//   real double play almost always retires the lead runner first and
//   relays back to first for the batter last.
export function computeGroundBallNotation(input: {
  initialFielder: number;
  batterOutFielder: number | null;
  extraOutFielders: number[];
}): string {
  const chain = [input.initialFielder, ...input.extraOutFielders, ...(input.batterOutFielder !== null ? [input.batterOutFielder] : [])];
  const deduped = chain.filter((n, i) => i === 0 || n !== chain[i - 1]);
  const totalOuts = (input.batterOutFielder !== null ? 1 : 0) + input.extraOutFielders.length;
  let notation = deduped.join("-");
  if (totalOuts === 2) notation += " DP";
  else if (totalOuts >= 3) notation += " TP";
  return notation;
}

// Caught fly balls/line drives/popups are never assisted -- the catch
// itself is the out, so notation is just the outcome letter + fielder,
// no relay chain (matches "F8", "L7" from the request exactly).
export function notationForCatch(hitType: HitType, fielder: number): string {
  return `${hitType === "linedrive" ? "L" : "F"}${fielder}`;
}

// Errors reuse the same fielder-credit mechanism as outs (Fix 6, an
// earlier batch) -- "E5" is the standard scorebook symbol.
export function notationForError(fielder: number): string {
  return `E${fielder}`;
}

// Every fielded result that only ever needs Step 1's single fielder (no
// base-tap flow) -- a caught fly/line/pop, or an error. A plain
// groundball/bunt groundout is deliberately NOT handled here; that one
// goes through the dedicated location-and-fielder flow in
// operator-console.tsx (computeGroundBallNotation) instead, since it
// needs the base the out was made at, not just who fielded it.
export function notationForSingleFielderPlay(result: AtBatResult, hitType: HitType | null, fielder: number): string | null {
  if (result === "error") return notationForError(fielder);
  if (hitType === "flyball" || hitType === "popup" || hitType === "linedrive") return notationForCatch(hitType, fielder);
  return null;
}
