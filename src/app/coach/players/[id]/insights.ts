import "server-only";
import { unstable_cache } from "next/cache";
import {
  generatePlayerZoneInsights,
  generatePitcherZoneInsights,
  type PlayerZoneInsightInput,
  type PitcherZoneInsightInput,
} from "@/lib/anthropic";
import {
  computeZoneBattingLines,
  computeZoneWhiffLines,
  computeZoneLocationLines,
  computeZoneDamageLines,
  attachDamageFlag,
  extendedZoneLabel,
  zoneIndexFromCoords,
  zoneLabel9,
} from "@/lib/heat-map";
import type { AtBatResult, HitType, PitchOutcome, PitchType } from "@/lib/supabase/types";

const PITCH_TYPE_BUCKETS: (PitchType | "all")[] = ["all", "fastball", "curveball", "changeup", "slider"];
const MIN_LOCATION_SAMPLE = 3;

interface RawAtBat {
  id: string;
  result: AtBatResult | null;
  hit_type: HitType | null;
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

// Shared by both builders below: every pitch-type bucket's qualifying
// whiff/location zones, most extreme first, capped at 8 each so the
// prompt stays focused rather than listing every qualifying zone across
// all 5 buckets. Whiff/location math itself doesn't care whose pitches
// these are (a swing is a swing) -- only the batting-average side of
// each builder differs between the batter and pitcher perspectives.
function computeWhiffAndLocationZones(pitches: RawPitch[]): {
  whiffZones: PlayerZoneInsightInput["whiffZones"];
  locationZones: PlayerZoneInsightInput["locationZones"];
} {
  const whiffZones: PlayerZoneInsightInput["whiffZones"] = [];
  const locationZones: PlayerZoneInsightInput["locationZones"] = [];
  for (const bucket of PITCH_TYPE_BUCKETS) {
    const pitchesForBucket = bucket === "all" ? pitches : pitches.filter((p) => p.pitch_type === bucket);
    computeZoneWhiffLines(pitchesForBucket).forEach((line, i) => {
      if (line.rate !== null) whiffZones.push({ zoneLabel: extendedZoneLabel(i), rate: line.rate, swings: line.swings, pitchType: bucket });
    });
    computeZoneLocationLines(pitchesForBucket).forEach((line, i) => {
      if (line.count >= MIN_LOCATION_SAMPLE) {
        locationZones.push({ zoneLabel: extendedZoneLabel(i), pct: line.pct, count: line.count, pitchType: bucket });
      }
    });
  }
  whiffZones.sort((a, b) => b.rate - a.rate);
  locationZones.sort((a, b) => b.pct - a.pct);
  return { whiffZones: whiffZones.slice(0, 8), locationZones: locationZones.slice(0, 8) };
}

// Damage Rate batch: mirrors computeWhiffAndLocationZones's per-pitch-
// type-bucket shape, but damage needs the at-bat join first (see
// attachDamageFlag) -- done ONCE on the full, unfiltered pitch set so
// "which pitch ended this at-bat" is determined from the at-bat's real
// pitch history, then the already-flagged pitches are filtered per
// bucket. Flagging after filtering by pitch type would be wrong: an
// at-bat's last pitch might not be the same pitch type as an earlier
// one in the same at-bat, and filtering first could make an
// unrelated earlier pitch look like "the last one" within that narrowed
// set.
function computeDamageZones(atBats: RawAtBat[], pitches: RawPitch[]): PitcherZoneInsightInput["damageZones"] {
  const flagged = attachDamageFlag(
    atBats.map((ab) => ({ id: ab.id, result: ab.result, hitType: ab.hit_type })),
    pitches
  );
  const damageZones: PitcherZoneInsightInput["damageZones"] = [];
  for (const bucket of PITCH_TYPE_BUCKETS) {
    const pitchesForBucket = bucket === "all" ? flagged : flagged.filter((p) => p.pitch_type === bucket);
    computeZoneDamageLines(pitchesForBucket).forEach((line, i) => {
      if (line.rate !== null) damageZones.push({ zoneLabel: extendedZoneLabel(i), rate: line.rate, pitches: line.total, pitchType: bucket });
    });
  }
  damageZones.sort((a, b) => b.rate - a.rate);
  return damageZones.slice(0, 8);
}

function lastZoneIndexByAtBat(atBats: RawAtBat[], pitches: RawPitch[]): Map<string, number | null> {
  const map = new Map<string, number | null>();
  for (const ab of atBats) {
    const forThis = pitches.filter((p) => p.at_bat_id === ab.id).sort((a, b) => b.pitch_number - a.pitch_number);
    const last = forThis[0];
    map.set(ab.id, last && last.zone_x !== null && last.zone_y !== null ? zoneIndexFromCoords(last.zone_x, last.zone_y) : null);
  }
  return map;
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
  const lastZoneByAtBat = lastZoneIndexByAtBat(battingAtBats, batterPitches);
  const zoneAtBats = battingAtBats
    .filter((ab): ab is RawAtBat & { result: AtBatResult } => ab.result !== null)
    .map((ab) => ({ result: ab.result, zoneIndex: lastZoneByAtBat.get(ab.id) ?? null }));
  const battingZones = computeZoneBattingLines(zoneAtBats)
    .map((line, i) => ({ zoneLabel: zoneLabel9(i), avg: line.avg, ab: line.ab }))
    .filter((z) => z.ab >= 3);

  return { playerName, battingZones, ...computeWhiffAndLocationZones(batterPitches) };
}

// Pitcher-maps batch: same shape of work as buildZoneInsightInput, but
// battingZones becomes oppAvgZones (opposing batters' average against
// this pitcher, from pitching-mode at-bats) and the source pitches are
// this pitcher's own (pitcher_id === this player, mode "pitching").
export function buildPitcherZoneInsightInput(
  playerName: string,
  pitchingAtBats: RawAtBat[],
  pitcherPitches: RawPitch[]
): PitcherZoneInsightInput {
  const lastZoneByAtBat = lastZoneIndexByAtBat(pitchingAtBats, pitcherPitches);
  const zoneAtBats = pitchingAtBats
    .filter((ab): ab is RawAtBat & { result: AtBatResult } => ab.result !== null)
    .map((ab) => ({ result: ab.result, zoneIndex: lastZoneByAtBat.get(ab.id) ?? null }));
  const oppAvgZones = computeZoneBattingLines(zoneAtBats)
    .map((line, i) => ({ zoneLabel: zoneLabel9(i), avg: line.avg, ab: line.ab }))
    .filter((z) => z.ab >= 3);

  return {
    playerName,
    oppAvgZones,
    ...computeWhiffAndLocationZones(pitcherPitches),
    damageZones: computeDamageZones(pitchingAtBats, pitcherPitches),
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

// Pitcher-maps batch: separate cache entry (own key, own arg shape) from
// getPlayerZoneInsights -- same caching rationale (see that function's
// own comment).
export const getPitcherZoneInsights = unstable_cache(
  async (input: PitcherZoneInsightInput) => generatePitcherZoneInsights(input),
  ["pitcher-zone-insights"]
);
