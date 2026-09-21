import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { FieldCalibrationPoints, PlayerPositionCalibration } from "@/lib/supabase/types";
import { CalibrationTool } from "./calibration-tool";

export default async function CalibrateFieldPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, team_id")
    .eq("id", user.id)
    .single();
  if (!profile?.team_id || profile.role !== "coach") redirect("/pending");

  const { data: existing } = await supabase
    .from("field_calibration")
    .select("field_type, calibration_points")
    .eq("team_id", profile.team_id);

  const existing2d = (existing?.find((r) => r.field_type === "2d")?.calibration_points as FieldCalibrationPoints | undefined) ?? null;
  const existing3d = (existing?.find((r) => r.field_type === "3d")?.calibration_points as FieldCalibrationPoints | undefined) ?? null;
  // Change 1 (calibrate-field-tabs batch): tab 3, a different point shape
  // (9 required + 1 optional named positions, not the 7-anchor field
  // shape) stored under the same table's third field_type row.
  const existingPositions =
    (existing?.find((r) => r.field_type === "positions")?.calibration_points as PlayerPositionCalibration | undefined) ?? null;

  return (
    <main className="min-h-screen bg-background px-6 py-8">
      <header className="mx-auto flex max-w-5xl items-center justify-between border-b border-border pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-primary">Coach — Setup</p>
          <h1 className="font-heading mt-1 text-3xl font-bold text-white">Field Calibration</h1>
        </div>
        <Link href="/coach" className="text-xs text-foreground/50 hover:text-white">
          ← Dashboard
        </Link>
      </header>

      <div className="mx-auto mt-6 max-w-5xl">
        <CalibrationTool initial2d={existing2d} initial3d={existing3d} initialPositions={existingPositions} />
      </div>
    </main>
  );
}
