import { ReliabilityBadge } from "@/components/reliability-badge";
import type { ReliabilityInput } from "@/lib/reliability";

// Whiff-rate/pitch-location maps batch: renders the 3 AI-generated
// bullets from the Claude call in insights.ts. A plain server-renderable
// component (no "use client") since it only ever receives a finished
// string array -- no interactivity of its own.
// Lineup Intelligence 2.0, Part 6: optional reliability stats, shown
// under the bullets -- "use this everywhere AI analysis is shown"
// named this page's own Key Insights explicitly.
export function KeyInsights({
  insights,
  title = "Key Insights",
  reliability,
}: {
  insights: string[];
  title?: string;
  reliability?: ReliabilityInput;
}) {
  if (insights.length === 0) return null;

  return (
    <section className="glossy rounded-lg border border-accent-gold/30 bg-surface p-5">
      <h2 className="font-heading text-lg font-semibold uppercase tracking-wide text-accent-gold">{title}</h2>
      <ul className="mt-3 flex flex-col gap-2">
        {insights.map((line, i) => (
          <li key={i} className="text-sm text-white">
            {line}
          </li>
        ))}
      </ul>
      {reliability && (
        <div className="mt-3 border-t border-border pt-3">
          <ReliabilityBadge stats={reliability} />
        </div>
      )}
    </section>
  );
}
