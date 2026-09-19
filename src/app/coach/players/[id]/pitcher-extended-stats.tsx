"use client";

import { useMemo, useState } from "react";
import { zoneIndexFromCoords } from "@/lib/heat-map";
import { TRACKED_COUNTS, PITCH_TYPES, STRIKE_OUTCOMES, type CountState } from "@/lib/count-stats";
import type { AtBatResult, PitchOutcome, PitchType } from "@/lib/supabase/types";

interface CountAtBat {
  result: AtBatResult;
  finalCount: CountState | null;
}
interface RawPitch {
  pitch_number: number;
  pitch_type: PitchType | null;
  zone_x: number | null;
  zone_y: number | null;
  outcome: PitchOutcome;
}

export function PitcherExtendedStats({
  countAtBats,
  pitches,
  atBatCount,
}: {
  countAtBats: CountAtBat[];
  pitches: RawPitch[];
  atBatCount: number;
}) {
  const [commandPitchType, setCommandPitchType] = useState<PitchType>("fastball");

  const strikeRateByType = useMemo(
    () =>
      PITCH_TYPES.map(({ value, label }) => {
        const typePitches = pitches.filter((p) => p.pitch_type === value);
        const strikes = typePitches.filter((p) => STRIKE_OUTCOMES.has(p.outcome)).length;
        return { label, total: typePitches.length, rate: typePitches.length > 0 ? strikes / typePitches.length : 0 };
      }),
    [pitches]
  );

  const firstPitches = useMemo(() => pitches.filter((p) => p.pitch_number === 1), [pitches]);
  const firstPitchStrikeRate =
    firstPitches.length > 0 ? firstPitches.filter((p) => STRIKE_OUTCOMES.has(p.outcome)).length / firstPitches.length : null;

  const commandCounts = useMemo(() => {
    const counts = Array.from({ length: 9 }, () => 0);
    for (const p of pitches) {
      if (p.pitch_type !== commandPitchType || p.zone_x === null || p.zone_y === null) continue;
      const zone = zoneIndexFromCoords(p.zone_x, p.zone_y);
      if (zone === null) continue;
      counts[zone] += 1;
    }
    return counts;
  }, [pitches, commandPitchType]);
  const maxCommand = Math.max(...commandCounts, 0);

  const strikeoutsByCount = useMemo(() => {
    // dropped_third_strike_safe still counts as a strikeout for this
    // breakdown (Fix 2, baseball-logic-fixes batch) -- see the same note
    // on hitter-extended-stats.tsx's kRate.
    const kAtBats = countAtBats.filter(
      (ab) => (ab.result === "strikeout" || ab.result === "dropped_third_strike_safe") && ab.finalCount
    );
    return TRACKED_COUNTS.map(({ state, label }) => {
      const count = kAtBats.filter(
        (ab) => ab.finalCount!.balls === state.balls && ab.finalCount!.strikes === state.strikes
      ).length;
      return { label, count, pct: kAtBats.length > 0 ? (count / kAtBats.length) * 100 : 0 };
    }).filter((row) => row.count > 0);
  }, [countAtBats]);

  const avgPitchesPerAtBat = atBatCount > 0 ? pitches.length / atBatCount : 0;

  return (
    <section className="glossy rounded-lg border border-border bg-surface p-5">
      <h2 className="font-heading text-lg font-semibold uppercase tracking-wide text-white">Pitcher Splits</h2>
      <p className="mt-1 text-xs text-foreground/50">Strike rate by pitch, command, and count tendencies</p>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatBox
          label="1st Pitch Strike %"
          value={firstPitchStrikeRate !== null ? `${Math.round(firstPitchStrikeRate * 100)}%` : "—"}
        />
        <StatBox label="Pitches / AB" value={avgPitchesPerAtBat > 0 ? avgPitchesPerAtBat.toFixed(1) : "—"} />
      </div>

      <div className="mt-5">
        <p className="text-xs uppercase tracking-wide text-foreground/40">Strike Rate by Pitch Type</p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[360px] text-left text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-foreground/40">
                <th className="pb-1 pr-3">Pitch</th>
                <th className="pb-1 pr-3">Pitches</th>
                <th className="pb-1 pr-3">Strike Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {strikeRateByType.map((row) => (
                <tr key={row.label}>
                  <td className="py-1.5 pr-3 font-medium text-white">{row.label}</td>
                  <td className="py-1.5 pr-3 text-foreground/70">{row.total}</td>
                  <td className="py-1.5 pr-3 font-heading font-semibold text-white">
                    {row.total > 0 ? `${Math.round(row.rate * 100)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wide text-foreground/40">Zone Command</p>
          <div className="flex flex-wrap gap-1 text-[11px]">
            {PITCH_TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => setCommandPitchType(t.value)}
                className={`rounded-full border px-2.5 py-0.5 transition ${
                  commandPitchType === t.value
                    ? "border-accent-primary bg-accent-primary/20 text-white"
                    : "border-border text-foreground/50"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[10px] text-foreground/30">Where each pitch type was thrown, not how it was hit</p>
        <div className="mx-auto mt-2 grid w-full max-w-[220px] grid-cols-3 grid-rows-3 gap-1 rounded-md border-2 border-border bg-background p-1">
          {commandCounts.map((c, i) => (
            <div
              key={i}
              className={`flex aspect-square flex-col items-center justify-center rounded ${
                maxCommand > 0 && c === maxCommand ? "ring-2 ring-accent-gold" : ""
              }`}
              style={{
                backgroundColor: c === 0 ? "#1A3D28" : "#2E6FD4",
                opacity: c === 0 ? 1 : 0.25 + (maxCommand > 0 ? c / maxCommand : 0) * 0.75,
              }}
            >
              <span className="text-[11px] font-bold text-white">{c > 0 ? c : "—"}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5">
        <p className="text-xs uppercase tracking-wide text-foreground/40">Strikeouts by Count</p>
        {strikeoutsByCount.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {strikeoutsByCount.map((row) => (
              <div key={row.label} className="rounded-md border border-border bg-background/50 px-3 py-2 text-center">
                <p className="font-heading text-base font-bold text-white">{row.count}</p>
                <p className="text-[10px] text-foreground/50">{row.label}</p>
                <p className="text-[9px] text-foreground/30">{Math.round(row.pct)}%</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-foreground/40">No strikeouts logged yet.</p>
        )}
      </div>

      <p className="mt-4 text-[11px] text-foreground/40">
        Runners-on vs. bases-empty splits aren&apos;t shown -- base occupancy is only tracked live during a game
        and gets overwritten as the game progresses, so there&apos;s no historical record to split by.
      </p>
    </section>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-foreground/40">{label}</p>
      <p className="font-heading text-xl font-bold text-white">{value}</p>
    </div>
  );
}
