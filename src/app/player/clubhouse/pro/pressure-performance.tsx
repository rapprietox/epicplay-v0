import { formatAvg } from "@/lib/stats";
import type { PressureSplits } from "@/lib/count-stats";

// Clubhouse Pro batch: "Pressure Performance," reframed from the
// originally-requested "Pressure Performance Index" -- no formula was
// given, and this schema has no bases-loaded/RISP/late-and-close data
// (game_state.runners is live-only, never persisted historically), so a
// real clutch-situation stat isn't buildable. Confirmed with the user:
// two real, labeled numbers instead of an invented composite score.
export function PressurePerformance({ splits }: { splits: PressureSplits }) {
  const { fullCountOutcomes: fc } = splits;

  return (
    <div className="glossy rounded-lg border border-border bg-surface p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-foreground/50">Pressure Performance</p>

      <div className="mt-3 grid grid-cols-2 gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-foreground/40">Season AVG</p>
          <p className="font-heading text-xl font-bold text-white">{formatAvg(splits.seasonAvg)}</p>
          <p className="text-[10px] text-foreground/30">{splits.seasonAb} AB</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-foreground/40">With 2 Strikes</p>
          <p className="font-heading text-xl font-bold text-accent-gold">{formatAvg(splits.twoStrikeAvg)}</p>
          <p className="text-[10px] text-foreground/30">{splits.twoStrikeAb} AB</p>
        </div>
      </div>

      {fc.total > 0 && (
        <div className="mt-4">
          <p className="text-[10px] uppercase tracking-wide text-foreground/40">Full Count (3-2) Outcomes -- {fc.total} AB</p>
          <div className="mt-1 flex gap-3 text-xs text-foreground/70">
            <span>K: {fc.k}</span>
            <span>BB: {fc.bb}</span>
            <span>Hit: {fc.hit}</span>
            <span>Other: {fc.other}</span>
          </div>
        </div>
      )}

      <p className="mt-3 text-[10px] leading-relaxed text-foreground/30">
        &ldquo;Pressure&rdquo; here means at-bats decided with two strikes on the count -- this app doesn&apos;t track bases-loaded,
        runners-in-scoring-position, or late-and-close situations, so a true clutch-situation stat isn&apos;t available.
      </p>
    </div>
  );
}
