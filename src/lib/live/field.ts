import type { FieldCalibrationPoints } from "@/lib/supabase/types";
import { FIELDER_NUMBER_TO_POSITION, zoneForPoint } from "@/lib/field-zones";
import type { FieldingPosition } from "@/lib/supabase/types";

// Stage 2 (live stadium page) deliberately does NOT fetch a team's real
// field_calibration row -- /api/live/[token] is only allowed to return
// field_x/field_y/hit_type for recent at-bats and nothing else new, and
// pulling in a per-team calibration would both violate that and add a
// query this public, unauthenticated route has no business making. This
// is a fixed, hand-measured approximation of where home plate/the bases/
// the outfield wall sit on /field-3d.png's own fixed camera angle --
// good enough for broadcast-flavor ball/runner placement and for
// resolveFielder's classification below, not a substitute for a real
// per-team calibration (which the coach's own spray chart still uses).
export const LIVE_FIELD_CALIBRATION: FieldCalibrationPoints = {
  home_plate: { x: 50, y: 86 },
  first_base: { x: 73, y: 58 },
  second_base: { x: 50, y: 41 },
  third_base: { x: 27, y: 58 },
  lf_wall: { x: 4, y: 30 },
  cf_wall: { x: 50, y: 16 },
  rf_wall: { x: 96, y: 30 },
};

export const LIVE_BASE_POS = {
  first: LIVE_FIELD_CALIBRATION.first_base,
  second: LIVE_FIELD_CALIBRATION.second_base,
  third: LIVE_FIELD_CALIBRATION.third_base,
} as const;

// "Work out which fielder from the dot position using the existing
// field-zone... logic, because Quick Mode doesn't save the fielder" --
// zoneForPoint (src/lib/field-zones.ts) is the same function the
// operator's own at-bat notation already uses to turn a field tap into
// a scorebook position number; reused here against the fixed
// calibration above instead of a real per-team one.
export function fielderPositionFromDot(x: number, y: number): FieldingPosition {
  return FIELDER_NUMBER_TO_POSITION[zoneForPoint(x, y, LIVE_FIELD_CALIBRATION)];
}
