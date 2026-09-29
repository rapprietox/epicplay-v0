import { formatAvg } from "@/lib/stats";
import type { SituationalRow } from "@/lib/situational-stats";

// Clubhouse Pro enhancement, Part 4. Format per spec: Situation · AB ·
// AVG · HR · RBI. Rows with notTrackedNote (RISP, 2 outs, when this
// player has no at-bats logged after the migration) render the note
// instead of stat columns -- see computeSituationalStats's own comment
// on why those two specifically can go untracked.
export function SituationalStats({ rows }: { rows: SituationalRow[] }) {
  return (
    <section className="glossy rounded-lg border border-border bg-surface p-5">
      <h2 className="font-heading text-lg font-semibold uppercase tracking-wide text-white">Situational Stats</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-foreground/50">
              <th className="py-2 pr-2">Situation</th>
              <th className="py-2 pr-2 text-right">AB</th>
              <th className="py-2 pr-2 text-right">AVG</th>
              <th className="py-2 pr-2 text-right">HR</th>
              <th className="py-2 text-right">RBI</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.situation} className="border-b border-border/50 last:border-0">
                <td className="py-2 pr-2 text-white">{row.situation}</td>
                {row.notTrackedNote ? (
                  <td colSpan={4} className="py-2 text-right text-xs italic text-foreground/40">
                    {row.notTrackedNote}
                  </td>
                ) : (
                  <>
                    <td className="py-2 pr-2 text-right text-foreground/70">{row.line?.ab ?? 0}</td>
                    <td className="py-2 pr-2 text-right font-semibold text-accent-gold">{formatAvg(row.line?.avg ?? 0)}</td>
                    <td className="py-2 pr-2 text-right text-foreground/70">{row.line?.hr ?? 0}</td>
                    <td className="py-2 text-right text-foreground/70">{row.line?.rbi ?? 0}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
