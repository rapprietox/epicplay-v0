import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { generateKairosInitialAssessment, type KairosInitialAssessmentInput } from "@/lib/anthropic";
import { findWeaknessAndStrengthZones, computeZoneWhiffLines, extendedZoneLabel } from "@/lib/heat-map";
import type { BattingLine } from "@/lib/stats";
import type { PitchOutcome } from "@/lib/supabase/types";

export interface AssessmentZoneInputs {
  battingZones: { zoneLabel: string; avg: number; ab: number }[];
  whiffPitches: { swing: boolean | null; outcome: PitchOutcome; zone_x: number | null; zone_y: number | null }[];
}

function buildWeaknessStrength(inputs: AssessmentZoneInputs) {
  const whiffZones = computeZoneWhiffLines(inputs.whiffPitches)
    .map((line, i) => ({ zoneLabel: extendedZoneLabel(i), rate: line.rate, pitchType: "all" as const }))
    .filter((z): z is { zoneLabel: string; rate: number; pitchType: "all" } => z.rate !== null);
  return findWeaknessAndStrengthZones(inputs.battingZones, whiffZones);
}

// Clubhouse Pro enhancement, Part 3: "generate once, cache forever until
// new games change the data significantly." The request's own migration
// lists exactly one text column with no tracking field to detect
// "significant" change, so this generates once (on first null) and
// persists -- staleness is handled by an explicit "Regenerate" action
// (regenerateInitialAssessment in kairos-actions.ts) rather than an
// invented automatic heuristic. Service-role: writing
// players.kairos_initial_assessment is outside a player's own RLS write
// scope, same reasoning as the credits write.
export async function ensureInitialAssessment(
  playerId: string,
  playerName: string,
  position: string | null,
  teamName: string,
  battingLine: BattingLine | null,
  zoneInputs: AssessmentZoneInputs
): Promise<string> {
  const service = createServiceRoleClient();
  const { data: player } = await service.from("players").select("kairos_initial_assessment").eq("id", playerId).single();
  if (player?.kairos_initial_assessment) return player.kairos_initial_assessment;

  const text = await generateAssessmentText(playerName, position, teamName, battingLine, zoneInputs);
  if (text) await service.from("players").update({ kairos_initial_assessment: text }).eq("id", playerId);
  return text;
}

export async function regenerateAssessment(
  playerId: string,
  playerName: string,
  position: string | null,
  teamName: string,
  battingLine: BattingLine | null,
  zoneInputs: AssessmentZoneInputs
): Promise<string> {
  const text = await generateAssessmentText(playerName, position, teamName, battingLine, zoneInputs);
  if (text) {
    const service = createServiceRoleClient();
    await service.from("players").update({ kairos_initial_assessment: text }).eq("id", playerId);
  }
  return text;
}

async function generateAssessmentText(
  playerName: string,
  position: string | null,
  teamName: string,
  battingLine: BattingLine | null,
  zoneInputs: AssessmentZoneInputs
): Promise<string> {
  const { weakness, strength } = buildWeaknessStrength(zoneInputs);
  const input: KairosInitialAssessmentInput = {
    playerName,
    position,
    teamName,
    battingLine: battingLine
      ? { ab: battingLine.ab, avg: battingLine.avg, hr: battingLine.hr, rbi: battingLine.rbi, obp: battingLine.obp, slg: battingLine.slg, ops: battingLine.ops }
      : null,
    weaknessZone: weakness,
    strengthZone: strength,
  };
  return generateKairosInitialAssessment(input);
}
