import type { GameType, FieldCalibrationPoints, AtBatResult, PitchType, PitchOutcome } from "@/lib/supabase/types";
import type { ZoneBattingLine, AtBatWithZone, SprayDot } from "@/lib/heat-map";
import type { PressureSplits, CountState } from "@/lib/count-stats";
import type { BattingLine } from "@/lib/stats";
import type { SituationalRow } from "@/lib/situational-stats";
import type { StreakStatus } from "@/lib/streaks";
import type { HeadToHeadEntry } from "@/lib/head-to-head";
import type { Milestone } from "@/lib/milestones";
import { StrikeZoneHeatmap } from "@/app/coach/players/[id]/strike-zone-heatmap";
import { ZoneAnalyticsRow } from "@/app/coach/players/[id]/zone-analytics-row";
import { KeyInsights } from "@/app/coach/players/[id]/key-insights";
import { SprayChart } from "@/app/coach/players/[id]/spray-chart";
import { HitterExtendedStats } from "@/app/coach/players/[id]/hitter-extended-stats";
import { PressurePerformance } from "./pro/pressure-performance";
import { WalkupSongSelector } from "./pro/walkup-song-selector";
import { CheckoutButton } from "./pro/checkout-button";
import { PromoCodeForm } from "./pro/promo-code-form";
import { KairosWidget } from "./pro/kairos-widget";
import { InitialAssessment } from "./pro/initial-assessment";
import { SituationalStats } from "./pro/situational-stats";
import { HotColdStreak } from "./pro/hot-cold-streak";
import { HeadToHead } from "./pro/head-to-head";
import { SeasonTrendChart, type TrendPoint } from "./pro/season-trend-chart";
import { Milestones } from "./pro/milestones";

interface ZonePitch {
  swing: boolean | null;
  outcome: PitchOutcome;
  zone_x: number | null;
  zone_y: number | null;
  pitch_type: PitchType | null;
}

// Clubhouse Pro batch: everything below reuses the exact coach-route
// analytics components as-is (imported cross-route -- they're plain,
// coach-agnostic modules/components, see the Sprint 6 plan's own
// research), fed this player's own data instead of a coach-viewed
// player's. Only pitching-side content (the player's own pitching heat
// maps) is out of scope this sprint -- see the plan's RLS gap note --
// so battingAtBats/pitches here are always the player's hitting-side
// data.
export function ProSection({
  unlocked,
  playerId,
  battingAvgZoneLines,
  battingZoneAtBats,
  pitches,
  insights,
  sprayDots,
  fieldCalibration,
  hitterCountAtBats,
  hitterPitchTypeAtBats,
  pressureSplits,
  kairosAssessment,
  situationalRows,
  last5Line,
  last10Line,
  currentStreak,
  streakBadge,
  headToHeadEntries,
  trendPoints,
  milestones,
}: {
  unlocked: boolean;
  playerId: string;
  battingAvgZoneLines: ZoneBattingLine[];
  battingZoneAtBats: (AtBatWithZone & { gameType: GameType })[];
  pitches: ZonePitch[];
  insights: string[];
  sprayDots: (SprayDot & { gameType: GameType })[];
  fieldCalibration: FieldCalibrationPoints | null;
  hitterCountAtBats: { result: AtBatResult; finalCount: CountState | null }[];
  hitterPitchTypeAtBats: { result: AtBatResult; pitchType: PitchType | null }[];
  pressureSplits: PressureSplits;
  kairosAssessment: string;
  situationalRows: SituationalRow[];
  last5Line: BattingLine | null;
  last10Line: BattingLine | null;
  currentStreak: number;
  streakBadge: StreakStatus;
  headToHeadEntries: HeadToHeadEntry[];
  trendPoints: TrendPoint[];
  milestones: Milestone[];
}) {
  if (!unlocked) {
    const teaser = insights[0] ?? "";
    // First sentence only, cut off mid-thought per spec ("...").
    const cutoff = teaser.split(/(?<=[.!?])\s/)[0] ?? teaser;

    return (
      <section className="glossy rounded-lg border border-accent-gold/30 bg-surface p-5">
        <h2 className="font-heading text-lg font-semibold uppercase tracking-wide text-accent-gold">Clubhouse Pro</h2>

        <div className="relative mt-4 overflow-hidden rounded-md">
          <div className="pointer-events-none select-none blur-sm" aria-hidden="true">
            <BlurredMapsPlaceholder />
          </div>
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background/95" />
        </div>

        {cutoff && (
          <p className="mt-4 text-sm italic text-white/80">
            &ldquo;{cutoff}&hellip;&rdquo;
          </p>
        )}

        <div className="mt-6 flex flex-col items-center gap-4">
          <CheckoutButton />
          <PromoCodeForm />
        </div>
      </section>
    );
  }

  return (
    <>
      <StrikeZoneHeatmap battingAtBats={battingZoneAtBats} pitchingAtBats={[]} hasPitchingData={false} />

      <ZoneAnalyticsRow battingAvgLines={battingAvgZoneLines} whiffPitches={pitches} locationPitches={pitches} perspective="batter" />

      <KeyInsights insights={insights} />

      <SprayChart dots={sprayDots} fieldCalibration={fieldCalibration} hideCalibrationHelpLink />

      <section className="glossy rounded-lg border border-border bg-surface p-5">
        <h2 className="font-heading text-lg font-semibold uppercase tracking-wide text-white">Splits &amp; Extras</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <PressurePerformance splits={pressureSplits} />
          <WalkupSongSelector />
        </div>
      </section>

      <HitterExtendedStats countAtBats={hitterCountAtBats} pitchTypeAtBats={hitterPitchTypeAtBats} pitches={pitches} />

      <SituationalStats rows={situationalRows} />

      <HotColdStreak
        status={streakBadge}
        last5={last5Line ? { avg: last5Line.avg, h: last5Line.h, ab: last5Line.ab } : null}
        last10={last10Line ? { avg: last10Line.avg } : null}
        currentStreak={currentStreak}
      />

      <HeadToHead entries={headToHeadEntries} />

      <SeasonTrendChart points={trendPoints} />

      <Milestones milestones={milestones} />

      <InitialAssessment text={kairosAssessment} />

      <KairosWidget playerId={playerId} />
    </>
  );
}

function BlurredMapsPlaceholder() {
  return (
    <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="mx-auto grid w-full max-w-[180px] grid-cols-3 grid-rows-3 gap-1 rounded-md border-2 border-border bg-background p-1">
          {Array.from({ length: 9 }).map((_, j) => (
            <div key={j} className="aspect-square rounded" style={{ backgroundColor: "#2ECC71" }} />
          ))}
        </div>
      ))}
    </div>
  );
}
