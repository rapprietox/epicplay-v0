import "server-only";
import { unstable_cache } from "next/cache";
import { generatePlayerZoneInsights, type PlayerZoneInsightInput } from "@/lib/anthropic";
import {
  computeZoneBattingLines,
  computeZoneWhiffLines,
  computeZoneLocationLines,
  extendedZoneLabel,
  zoneIndexFromCoords,
  zoneLabel9,
} from "@/lib/heat-map";
import type { AtBatResult, PitchOutcome, PitchType } from "@/lib/supabase/types";

const PITCH_TYPE_BUCKETS: (PitchType | "all")[] = ["all", "fastball", "curveball", "changeup", "slider"];
const MIN_LOCATION_SAMPLE = 3;

interface RawAtBat {
  id: string;
  result: AtBatResult | null;
}
interface RawPitch {
  at_bat_id: string;
  pitch_number: number;
  pitch_type: PitchType | null;
  zone_x: number | null;
  zone_y: number | null;
  outcome: PitchOutcome;
  swing: boolean | null;
}

// Server-side counterpart to what WhiffRateHeatmap/PitchLocationHeatmap/
// the mini batting-average grid compute client-side for live rendering
// -- this builds the same numbers once, compactly, as the AI insight
// prompt's input. Kept deliberately separate from the client components
// (which recompute per pitch-type toggle on demand) rather than sharing
// one code path across the server/client boundary for this -- the
// client versions only ever need "the currently toggled pitch type,"
// this needs "every pitch type's qualifying zones at once," which is a
// different shape of work, not the same call with different arguments.
export function buildZoneInsightInput(playerName: string, battingAtBats: RawAtBat[], batterPitches: RawPitch[]): PlayerZoneInsightInput {
  const lastZoneByAtBat = new Map<string, number | null>();
  for (const ab of battingAtBats) {
    const forThis = batterPitches.filter((p) => p.at_bat_id === ab.id).sort((a, b) => b.pitch_number - a.pitch_number);
    const last = forThis[0];
    lastZoneByAtBat.set(ab.id, last && last.zone_x !== null && last.zone_y !== null ? zoneIndexFromCoords(last.zone_x, last.zone_y) : null);
  }
  const zoneAtBats = battingAtBats
    .filter((ab): ab is RawAtBat & { result: AtBatResult } => ab.result !== null)
    .map((ab) => ({ result: ab.result, zoneIndex: lastZoneByAtBat.get(ab.id) ?? null }));
  const battingZones = computeZoneBattingLines(zoneAtBats)
    .map((line, i) => ({ zoneLabel: zoneLabel9(i), avg: line.avg, ab: line.ab }))
    .filter((z) => z.ab >= 3);

  const whiffZones: PlayerZoneInsightInput["whiffZones"] = [];
  const locationZones: PlayerZoneInsightInput["locationZones"] = [];
  for (const bucket of PITCH_TYPE_BUCKETS) {
    const pitchesForBucket = bucket === "all" ? batterPitches : batterPitches.filter((p) => p.pitch_type === bucket);
    computeZoneWhiffLines(pitchesForBucket).forEach((line, i) => {
      if (line.rate !== null) whiffZones.push({ zoneLabel: extendedZoneLabel(i), rate: line.rate, swings: line.swings, pitchType: bucket });
    });
    computeZoneLocationLines(pitchesForBucket).forEach((line, i) => {
      if (line.count >= MIN_LOCATION_SAMPLE) {
        locationZones.push({ zoneLabel: extendedZoneLabel(i), pct: line.pct, count: line.count, pitchType: bucket });
      }
    });
  }
  // Compact the prompt to the most extreme, most actionable zones rather
  // than every qualifying zone across all 5 pitch-type buckets.
  whiffZones.sort((a, b) => b.rate - a.rate);
  locationZones.sort((a, b) => b.pct - a.pct);

  return {
    playerName,
    battingZones,
    whiffZones: whiffZones.slice(0, 8),
    locationZones: locationZones.slice(0, 8),
  };
}

// Whiff-rate/pitch-location maps batch: "generate it server-side and
// cache it -- only regenerate when new games are added." No new DB
// table for the cache (the request is explicit that no schema changes
// are needed) -- unstable_cache's own key already includes this
// function's argument (Next hashes it), so an unchanged input (nothing
// new logged since the last render) hits the cache and a changed input
// (a new confirmed at-bat/pitch from a new game shifts one of the zone
// numbers) is a different key, which naturally triggers a fresh
// generation. No time-based revalidate is set -- there's nothing to
// expire on a clock, only on new data.
export const getPlayerZoneInsights = unstable_cache(
  async (input: PlayerZoneInsightInput) => generatePlayerZoneInsights(input),
  ["player-zone-insights"]
);
