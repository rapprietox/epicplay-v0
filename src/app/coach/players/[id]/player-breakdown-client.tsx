"use client";

import { useMemo, useState } from "react";
import { computeBattingLines, computePitchingLines, formatAvg } from "@/lib/stats";
import { computeZoneBattingLines, zoneIndexFromCoords, resultCategory, attachDamageFlag, type AtBatWithZone, type SprayDot } from "@/lib/heat-map";
import { finalCountForAtBat, type CountState } from "@/lib/count-stats";
import {
  DAY_TYPE_LABELS,
  TIME_OF_DAY_LABELS,
  dayTypeBucket,
  resolveStartMinutes,
  timeOfDayBucket,
  type DayType,
  type TimeOfDay,
} from "@/lib/game-time-filters";
import type { AtBatResult, Database, FieldCalibrationPoints, GameType, PitchType } from "@/lib/supabase/types";
import { StrikeZoneHeatmap } from "./strike-zone-heatmap";
import { SprayChart } from "./spray-chart";
import { PitcherHeatmap } from "./pitcher-heatmap";
import { HitterExtendedStats } from "./hitter-extended-stats";
import { PitcherExtendedStats } from "./pitcher-extended-stats";
import { ZoneAnalyticsRow } from "./zone-analytics-row";
import { KeyInsights } from "./key-insights";

type Player = Database["public"]["Tables"]["players"]["Row"];
type Game = Database["public"]["Tables"]["games"]["Row"];
type AtBat = Database["public"]["Tables"]["at_bats"]["Row"];
type StolenBase = Database["public"]["Tables"]["stolen_bases"]["Row"];
type Pitch = Pick<
  Database["public"]["Tables"]["pitches"]["Row"],
  "at_bat_id" | "pitch_number" | "pitch_type" | "zone_x" | "zone_y" | "outcome" | "swing"
>;

// Time-of-day/day-of-week filters batch: everything below (batting/
// pitching lines, zone at-bats, spray dots, pitch-type/count breakdowns)
// used to be computed once, server-side, in page.tsx -- moved here
// unchanged, just re-run against whichever games currently match the
// two new filters, since a client-side filter can't change what a
// server component already rendered without a full page reload. Every
// function this calls (computeBattingLines, zoneIndexFromCoords, etc.)
// was already a plain, framework-agnostic export with no server-only
// restriction -- src/app/coach/leaders-board.tsx already calls
// computeBattingLines/computePitchingLines client-side the same way.
export function PlayerBreakdownClient({
  player,
  games,
  battingAtBats,
  pitchingAtBats,
  stolenBases,
  pitches,
  fieldCalibration,
  insights,
  pitcherInsights,
}: {
  player: Player;
  games: Game[];
  battingAtBats: AtBat[];
  pitchingAtBats: AtBat[];
  stolenBases: StolenBase[];
  pitches: Pitch[];
  fieldCalibration: FieldCalibrationPoints | null;
  insights: string[];
  pitcherInsights: string[];
}) {
  const [timeOfDayFilter, setTimeOfDayFilter] = useState<TimeOfDay | "all">("all");
  const [dayTypeFilter, setDayTypeFilter] = useState<DayType | "all">("all");

  const matchingGameIds = useMemo(() => {
    const ids = new Set<string>();
    for (const g of games) {
      if (timeOfDayFilter !== "all" && timeOfDayBucket(resolveStartMinutes(g)) !== timeOfDayFilter) continue;
      if (dayTypeFilter !== "all" && dayTypeBucket(g.game_date) !== dayTypeFilter) continue;
      ids.add(g.id);
    }
    return ids;
  }, [games, timeOfDayFilter, dayTypeFilter]);
  const noFilterActive = timeOfDayFilter === "all" && dayTypeFilter === "all";

  const filteredGames = useMemo(() => (noFilterActive ? games : games.filter((g) => matchingGameIds.has(g.id))), [
    games,
    matchingGameIds,
    noFilterActive,
  ]);
  const filteredBattingAtBats = useMemo(
    () => (noFilterActive ? battingAtBats : battingAtBats.filter((ab) => matchingGameIds.has(ab.game_id))),
    [battingAtBats, matchingGameIds, noFilterActive]
  );
  const filteredPitchingAtBats = useMemo(
    () => (noFilterActive ? pitchingAtBats : pitchingAtBats.filter((ab) => matchingGameIds.has(ab.game_id))),
    [pitchingAtBats, matchingGameIds, noFilterActive]
  );
  const filteredStolenBases = useMemo(
    () => (noFilterActive ? stolenBases : stolenBases.filter((sb) => matchingGameIds.has(sb.game_id))),
    [stolenBases, matchingGameIds, noFilterActive]
  );

  const gameTypeById = useMemo(() => new Map(filteredGames.map((g) => [g.id, g.game_type])), [filteredGames]);
  const opponentNameById = useMemo(() => new Map(filteredGames.map((g) => [g.id, g.opponent_name])), [filteredGames]);
  const gameDateById = useMemo(() => new Map(filteredGames.map((g) => [g.id, g.game_date])), [filteredGames]);

  const allAtBats = useMemo(() => [...filteredBattingAtBats, ...filteredPitchingAtBats], [filteredBattingAtBats, filteredPitchingAtBats]);
  const filteredPitches = useMemo(() => {
    const atBatIds = new Set(allAtBats.map((ab) => ab.id));
    return pitches.filter((p) => atBatIds.has(p.at_bat_id));
  }, [pitches, allAtBats]);

  const { lastPitchZoneByAtBat, lastPitchTypeByAtBat, finalCountByAtBat } = useMemo(() => {
    const zone = new Map<string, number | null>();
    const type = new Map<string, string | null>();
    const count = new Map<string, CountState | null>();
    for (const ab of allAtBats) {
      const forThisAtBat = filteredPitches.filter((p) => p.at_bat_id === ab.id);
      const last = forThisAtBat.sort((a, b) => b.pitch_number - a.pitch_number)[0];
      zone.set(ab.id, last && last.zone_x !== null && last.zone_y !== null ? zoneIndexFromCoords(last.zone_x, last.zone_y) : null);
      type.set(ab.id, last?.pitch_type ?? null);
      count.set(ab.id, finalCountForAtBat(forThisAtBat));
    }
    return { lastPitchZoneByAtBat: zone, lastPitchTypeByAtBat: type, finalCountByAtBat: count };
  }, [allAtBats, filteredPitches]);

  const battingLine = useMemo(() => computeBattingLines(filteredBattingAtBats, filteredStolenBases).get(player.id), [
    filteredBattingAtBats,
    filteredStolenBases,
    player.id,
  ]);
  const pitchingLine = useMemo(() => computePitchingLines(filteredPitchingAtBats, filteredGames).get(player.id), [
    filteredPitchingAtBats,
    filteredGames,
    player.id,
  ]);

  const battingZoneAtBats: (AtBatWithZone & { gameType: GameType })[] = useMemo(
    () =>
      filteredBattingAtBats
        .filter((ab): ab is typeof ab & { result: AtBatResult } => ab.result !== null)
        .map((ab) => ({
          result: ab.result,
          zoneIndex: lastPitchZoneByAtBat.get(ab.id) ?? null,
          gameType: gameTypeById.get(ab.game_id) ?? "friendly",
        })),
    [filteredBattingAtBats, lastPitchZoneByAtBat, gameTypeById]
  );

  const pitchingZoneAtBats: (AtBatWithZone & { gameType: GameType })[] = useMemo(
    () =>
      filteredPitchingAtBats
        .filter((ab): ab is typeof ab & { result: AtBatResult } => ab.result !== null)
        .map((ab) => ({
          result: ab.result,
          zoneIndex: lastPitchZoneByAtBat.get(ab.id) ?? null,
          gameType: gameTypeById.get(ab.game_id) ?? "friendly",
        })),
    [filteredPitchingAtBats, lastPitchZoneByAtBat, gameTypeById]
  );

  const sprayDots: (SprayDot & { gameType: GameType })[] = useMemo(
    () =>
      filteredBattingAtBats
        .filter(
          (ab): ab is typeof ab & { result: AtBatResult; field_x: number; field_y: number } =>
            ab.result !== null && ab.field_x !== null && ab.field_y !== null
        )
        .map((ab) => ({
          x: ab.field_x,
          y: ab.field_y,
          category: resultCategory(ab.result),
          result: ab.result,
          inning: ab.inning,
          gameDate: gameDateById.get(ab.game_id) ?? "",
          opponentName: opponentNameById.get(ab.game_id) ?? "Unknown",
          hitType: ab.hit_type,
          gameType: gameTypeById.get(ab.game_id) ?? "friendly",
        })),
    [filteredBattingAtBats, gameDateById, opponentNameById, gameTypeById]
  );

  const pitcherAtBatsByType: { result: AtBatResult; zoneIndex: number | null; pitchType: PitchType | null }[] = useMemo(
    () =>
      filteredPitchingAtBats
        .filter((ab): ab is typeof ab & { result: AtBatResult } => ab.result !== null)
        .map((ab) => ({
          result: ab.result,
          zoneIndex: lastPitchZoneByAtBat.get(ab.id) ?? null,
          pitchType: (lastPitchTypeByAtBat.get(ab.id) as PitchType | null) ?? null,
        })),
    [filteredPitchingAtBats, lastPitchZoneByAtBat, lastPitchTypeByAtBat]
  );

  const battingAvgZoneLines = useMemo(() => computeZoneBattingLines(battingZoneAtBats), [battingZoneAtBats]);
  const pitchingAvgZoneLines = useMemo(() => computeZoneBattingLines(pitchingZoneAtBats), [pitchingZoneAtBats]);

  const pitcherPitches = useMemo(() => {
    const ids = new Set(filteredPitchingAtBats.map((ab) => ab.id));
    return filteredPitches.filter((p) => ids.has(p.at_bat_id));
  }, [filteredPitchingAtBats, filteredPitches]);

  // Damage Rate batch: pitcherPitches augmented with which single pitch
  // (per at-bat) was the one that actually got hit for damage -- see
  // attachDamageFlag's own comment in heat-map.ts. A separate derived
  // array rather than changing pitcherPitches itself, since
  // PitcherHeatmap/PitcherExtendedStats below don't need this field and
  // shouldn't have to carry it.
  const pitcherPitchesWithDamage = useMemo(
    () =>
      attachDamageFlag(
        filteredPitchingAtBats.map((ab) => ({ id: ab.id, result: ab.result, hitType: ab.hit_type })),
        pitcherPitches
      ),
    [filteredPitchingAtBats, pitcherPitches]
  );

  const batterPitches = useMemo(() => {
    const ids = new Set(filteredBattingAtBats.map((ab) => ab.id));
    return filteredPitches.filter((p) => ids.has(p.at_bat_id));
  }, [filteredBattingAtBats, filteredPitches]);

  const hitterCountAtBats: { result: AtBatResult; finalCount: CountState | null }[] = useMemo(
    () =>
      filteredBattingAtBats
        .filter((ab): ab is typeof ab & { result: AtBatResult } => ab.result !== null)
        .map((ab) => ({ result: ab.result, finalCount: finalCountByAtBat.get(ab.id) ?? null })),
    [filteredBattingAtBats, finalCountByAtBat]
  );

  const hitterPitchTypeAtBats: { result: AtBatResult; pitchType: PitchType | null }[] = useMemo(
    () =>
      filteredBattingAtBats
        .filter((ab): ab is typeof ab & { result: AtBatResult } => ab.result !== null)
        .map((ab) => ({ result: ab.result, pitchType: (lastPitchTypeByAtBat.get(ab.id) as PitchType | null) ?? null })),
    [filteredBattingAtBats, lastPitchTypeByAtBat]
  );

  const pitcherCountAtBats: { result: AtBatResult; finalCount: CountState | null }[] = useMemo(
    () =>
      filteredPitchingAtBats
        .filter((ab): ab is typeof ab & { result: AtBatResult } => ab.result !== null)
        .map((ab) => ({ result: ab.result, finalCount: finalCountByAtBat.get(ab.id) ?? null })),
    [filteredPitchingAtBats, finalCountByAtBat]
  );

  return (
    <>
      {/* Time-of-day/day-of-week filters batch: one shared pair of
          filters, governing every section below at once -- team leaders
          board (leaders-board.tsx) got its own copy of the same two
          selects since it's a separate, self-contained page. */}
      <div className="glossy flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3">
        <span className="text-xs uppercase tracking-wide text-foreground/40">Filter all stats below:</span>
        <select
          value={timeOfDayFilter}
          onChange={(e) => setTimeOfDayFilter(e.target.value as TimeOfDay | "all")}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-white outline-none focus:border-accent-primary"
        >
          <option value="all">Any time of day</option>
          {(Object.keys(TIME_OF_DAY_LABELS) as TimeOfDay[]).map((t) => (
            <option key={t} value={t}>
              {TIME_OF_DAY_LABELS[t]}
            </option>
          ))}
        </select>
        <select
          value={dayTypeFilter}
          onChange={(e) => setDayTypeFilter(e.target.value as DayType | "all")}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-white outline-none focus:border-accent-primary"
        >
          <option value="all">Any day</option>
          {(Object.keys(DAY_TYPE_LABELS) as DayType[]).map((d) => (
            <option key={d} value={d}>
              {DAY_TYPE_LABELS[d]}
            </option>
          ))}
        </select>
      </div>

      <section className="glossy rounded-lg border border-border bg-surface p-5">
        <h2 className="font-heading text-lg font-semibold uppercase tracking-wide text-white">Batting</h2>
        {battingLine && battingLine.ab > 0 ? (
          <StatGrid
            stats={[
              ["AVG", formatAvg(battingLine.avg)],
              ["OBP", formatAvg(battingLine.obp)],
              ["SLG", formatAvg(battingLine.slg)],
              ["OPS", battingLine.ops.toFixed(3)],
              ["AB", battingLine.ab],
              ["H", battingLine.h],
              ["2B", battingLine.doubles],
              ["3B", battingLine.triples],
              ["HR", battingLine.hr],
              ["RBI", battingLine.rbi],
              ["BB", battingLine.bb],
              ["SB", battingLine.sb],
            ]}
          />
        ) : (
          <p className="mt-3 text-sm text-foreground/50">No at-bats logged yet.</p>
        )}
      </section>

      <section className="glossy rounded-lg border border-border bg-surface p-5">
        <h2 className="font-heading text-lg font-semibold uppercase tracking-wide text-white">Pitching</h2>
        {pitchingLine && pitchingLine.ip > 0 ? (
          <StatGrid
            stats={[
              ["ERA", pitchingLine.era?.toFixed(2) ?? "—"],
              ["WHIP", pitchingLine.whip?.toFixed(2) ?? "—"],
              ["IP", pitchingLine.ipDisplay],
              ["W", pitchingLine.wins],
              ["K", pitchingLine.k],
              ["BB", pitchingLine.bbAllowed],
              ["H", pitchingLine.hAllowed],
            ]}
          />
        ) : (
          <p className="mt-3 text-sm text-foreground/50">No innings pitched yet.</p>
        )}
      </section>

      <StrikeZoneHeatmap battingAtBats={battingZoneAtBats} pitchingAtBats={pitchingZoneAtBats} hasPitchingData={pitchingZoneAtBats.length > 0} />

      {batterPitches.length > 0 && (
        <>
          <ZoneAnalyticsRow battingAvgLines={battingAvgZoneLines} whiffPitches={batterPitches} locationPitches={batterPitches} />
          <KeyInsights insights={insights} />
        </>
      )}

      <SprayChart dots={sprayDots} fieldCalibration={fieldCalibration} />

      {pitchingZoneAtBats.length > 0 && <PitcherHeatmap atBats={pitcherAtBatsByType} pitches={pitcherPitches} />}

      {pitcherPitches.length > 0 && (
        <>
          <ZoneAnalyticsRow
            battingAvgLines={pitchingAvgZoneLines}
            whiffPitches={pitcherPitchesWithDamage}
            locationPitches={pitcherPitchesWithDamage}
            perspective="pitcher"
          />
          <KeyInsights insights={pitcherInsights} title="Pitching Key Insights" />
        </>
      )}

      {battingZoneAtBats.length > 0 && (
        <HitterExtendedStats countAtBats={hitterCountAtBats} pitchTypeAtBats={hitterPitchTypeAtBats} pitches={batterPitches} />
      )}

      {pitchingZoneAtBats.length > 0 && (
        <PitcherExtendedStats countAtBats={pitcherCountAtBats} pitches={pitcherPitches} atBatCount={filteredPitchingAtBats.length} />
      )}
    </>
  );
}

function StatGrid({ stats }: { stats: [string, string | number][] }) {
  return (
    <div className="mt-4 grid grid-cols-3 gap-4 sm:grid-cols-4">
      {stats.map(([label, value]) => (
        <div key={label}>
          <p className="text-xs uppercase tracking-wide text-foreground/40">{label}</p>
          <p className="font-heading text-xl font-bold text-white">{value}</p>
        </div>
      ))}
    </div>
  );
}
