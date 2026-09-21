"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { FieldCalibrationPoints, FieldType, PlayerPositionCalibration } from "@/lib/supabase/types";

async function requireCoachTeam() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, team_id")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "coach" || !profile.team_id) {
    throw new Error("Not authorized");
  }
  return { supabase, teamId: profile.team_id };
}

// Change 1 (calibrate-field-tabs batch): points is now either shape --
// the jsonb column doesn't care, and which one applies is determined
// entirely by fieldType, which the caller already knows.
export async function saveFieldCalibration(fieldType: FieldType, points: FieldCalibrationPoints | PlayerPositionCalibration) {
  const { supabase, teamId } = await requireCoachTeam();

  const { error } = await supabase
    .from("field_calibration")
    .upsert({ team_id: teamId, field_type: fieldType, calibration_points: points }, { onConflict: "team_id,field_type" });
  if (error) throw new Error(error.message);

  revalidatePath("/coach/calibrate-field");
}
