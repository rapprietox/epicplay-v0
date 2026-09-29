// Whiff-rate/pitch-location maps batch: renders the 3 AI-generated
// bullets from the Claude call in insights.ts. A plain server-renderable
// component (no "use client") since it only ever receives a finished
// string array -- no interactivity of its own.
export function KeyInsights({ insights }: { insights: string[] }) {
  if (insights.length === 0) return null;

  return (
    <section className="glossy rounded-lg border border-accent-gold/30 bg-surface p-5">
      <h2 className="font-heading text-lg font-semibold uppercase tracking-wide text-accent-gold">Key Insights</h2>
      <ul className="mt-3 flex flex-col gap-2">
        {insights.map((line, i) => (
          <li key={i} className="text-sm text-white">
            {line}
          </li>
        ))}
      </ul>
    </section>
  );
}
