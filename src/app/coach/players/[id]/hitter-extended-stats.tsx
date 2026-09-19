"use client";

import { useMemo } from "react";
import { HIT_RESULTS, zoneIndexFromCoords } from "@/lib/heat-map";
import { TRACKED_COUNTS, PITCH_TYPES, STRIKE_OUTCOMES, type CountState } from "@/lib/count-stats";
import { formatAvg } from "@/lib/stats";
import type { AtBatResult, PitchOutcome, PitchType } from "@/lib/supabase/types";

interface CountAtBat {
  result: AtBatResult;
  finalCount: CountState | null;
}
interface PitchTypeAtBat {
  result: AtBatResult;
  pitchType: PitchType | null;
}
interface RawPitch {
  pitch_type: PitchType | null;
  zone_x: number | null;
  zone_y: number | null;
  outcome: PitchOutcome;
}

const NOT_AB_RESULTS = new Set<AtBatResult>(["walk", "intentional_walk", "hbp"]);

export function HitterExtendedStats({
  countAtBats,
  pitchTypeAtBats,
  pitches,
}: {
  countAtBats: CountAtBat[];
  pitchTypeAtBats: PitchTypeAtBat[];
  pitches: RawPitch[];
}) {
  const countRows = useMemo(
    () =>
      TRACKED_COUNTS.map(({ state, label }) => {
        let ab = 0;
        let h = 0;
        for (const cab of countAtBats) {
          if (!cab.finalCount) continue;
          if (cab.finalCount.balls !== state.balls || cab.finalCount.strikes !== state.strikes) continue;
          if (NOT_AB_RESULTS.has(cab.result)) continue;
          ab += 1;
          if (HIT_RESULTS.has(cab.result)) h += 1;
        }
        return { label, ab, h, avg: ab > 0 ? h / ab : 0 };
      }),
    [countAtBats]
  );

  const withAb = countRows.filter((r) => r.ab > 0);
  const bestLabel = withAb.length > 1 ? withAb.reduce((a, b) => (b.avg > a.avg ? b : a)).label : null;
  const worstLabel = withAb.length > 1 ? withAb.reduce((a, b) => (b.avg < a.avg ? b : a)).label : null;

  const pitchTypeRows = useMemo(
    () =>
      PITCH_TYPES.map(({ value, label }) => {
        const decided = pitchTypeAtBats.filter((ab) => ab.pitchType === value);
        const abEligible = decided.filter((ab) => !NOT_AB_RESULTS.has(ab.result));
        const hits = abEligible.filter((ab) => HIT_RESULTS.has(ab.result)).length;
        // dropped_third_strike_safe still counts toward K rate -- it's a
        // strikeout by scoring rule, just not an out (Fix 2, baseball-
        // logic-fixes batch).
        const strikeouts = decided.filter((ab) => ab.result === "strikeout" || ab.result === "dropped_third_strike_safe").length;
        const typePitches = pitches.filter((p) => p.pitch_type === value);
        const strikes = typePitches.filter((p) => STRIKE_OUTCOMES.has(p.outcome)).length;
        return {
          label,
          ab: abEligible.length,
          avg: abEligible.length > 0 ? hits / abEligible.length : 0,
          kRate: decided.length > 0 ? strikeouts / decided.length : 0,
          strikeRate: typePitches.length > 0 ? strikes / typePitches.length : 0,
          pitchCount: typePitches.length,
          decidedCount: decided.length,
        };
      }),
    [pitchTypeAtBats, pitches]
  );

  const zoneCoverage = useMemo(() => {
    const seen = Array.from({ length: 9 }, () => 0);
    const hit = Array.from({ length: 9 }, () => 0);
    for (const p of pitches) {
      if (p.zone_x === null || p.zone_y === null) continue;
      const zone = zoneIndexFromCoords(p.zone_x, p.zone_y);
      if (zone === null) continue;
      seen[zone] += 1;
      if (p.outcome === "inplay") hit[zone] += 1;
    }
    return { seen, hit };
  }, [pitches]);

  const maxSeen = Math.max(...zoneCoverage.seen, 0);
  const maxHit = Math.max(...zoneCoverage.hit, 0);

  return (
    <section className="glossy rounded-lg border border-border bg-surface p-5">
      <h2 className="font-heading text-lg font-semibold uppercase tracking-wide text-white">Hitter Splits</h2>
      <p className="mt-1 text-xs text-foreground/50">Batting average by count, by pitch type, and where pitches land</p>

      <div className="mt-4">
        <p className="text-xs uppercase tracking-wide text-foreground/40">Count Performance</p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-foreground/40">
                <th className="pb-1 pr-3">Count</th>
                <th className="pb-1 pr-3">AB</th>
                <th className="pb-1 pr-3">H</th>
                <th className="pb-1 pr-3">AVG</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {countRows.map((row) => (
                <tr
                  key={row.label}
                  className={
                    row.label === bestLabel ? "bg-accent-green/10" : row.label === worstLabel ? "bg-accent-red/10" : undefined
                  }
                >
                  <td className="py-1.5 pr-3 font-medium text-white">{row.label}</td>
                  <td className="py-1.5 pr-3 text-foreground/70">{row.ab}</td>
                  <td className="py-1.5 pr-3 text-foreground/70">{row.h}</td>
                  <td className="py-1.5 pr-3 font-heading font-semibold text-white">{row.ab > 0 ? formatAvg(row.avg) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {bestLabel && (
          <p className="mt-1.5 text-[10px] text-foreground/40">
            Best: <span className="text-accent-green">{bestLabel}</span> &middot; Worst:{" "}
            <span className="text-accent-red">{worstLabel}</span>
          </p>
        )}
      </div>

      <div className="mt-5">
        <p className="text-xs uppercase tracking-wide text-foreground/40">Pitch Type Breakdown</p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-foreground/40">
                <th className="pb-1 pr-3">Pitch</th>
                <th className="pb-1 pr-3">AB</th>
                <th className="pb-1 pr-3">AVG</th>
                <th className="pb-1 pr-3">K%</th>
                <th className="pb-1 pr-3">Strike Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pitchTypeRows.map((row) => (
                <tr key={row.label}>
                  <td className="py-1.5 pr-3 font-medium text-white">{row.label}</td>
                  <td className="py-1.5 pr-3 text-foreground/70">{row.ab}</td>
                  <td className="py-1.5 pr-3 font-heading font-semibold text-white">{row.ab > 0 ? formatAvg(row.avg) : "—"}</td>
                  <td className="py-1.5 pr-3 text-foreground/70">{row.decidedCount > 0 ? `${Math.round(row.kRate * 100)}%` : "—"}</td>
                  <td className="py-1.5 pr-3 text-foreground/70">{row.pitchCount > 0 ? `${Math.round(row.strikeRate * 100)}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-5">
        <p className="text-xs uppercase tracking-wide text-foreground/40">Zone Coverage</p>
        <div className="mt-2 grid grid-cols-1 gap-6 sm:grid-cols-2">
          <ZoneCountGrid title="Pitches Seen" counts={zoneCoverage.seen} max={maxSeen} color="#2E6FD4" />
          <ZoneCountGrid title="Pitches Put In Play" counts={zoneCoverage.hit} max={maxHit} color="#2ECC71" />
        </div>
      </div>

      <p className="mt-4 text-[11px] text-foreground/40">
        Chase rate and contact rate aren&apos;t shown -- the pitches table records a pitch&apos;s outcome but not
        whether the batter swung, so there&apos;s no swing/take signal to compute either from.
      </p>
    </section>
  );
}

function ZoneCountGrid({ title, counts, max, color }: { title: string; counts: number[]; max: number; color: string }) {
  return (
    <div>
      <p className="text-center text-[10px] text-foreground/40">{title}</p>
      <div className="mx-auto mt-2 grid w-full max-w-[200px] grid-cols-3 grid-rows-3 gap-1 rounded-md border-2 border-border bg-background p-1">
        {counts.map((c, i) => {
          const intensity = max > 0 ? c / max : 0;
          return (
            <div
              key={i}
              className={`flex aspect-square flex-col items-center justify-center rounded ${
                max > 0 && c === max ? "ring-2 ring-accent-gold" : ""
              }`}
              style={{ backgroundColor: c === 0 ? "#1A3D28" : color, opacity: c === 0 ? 1 : 0.25 + intensity * 0.75 }}
            >
              <span className="text-[11px] font-bold text-white">{c > 0 ? c : "—"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
