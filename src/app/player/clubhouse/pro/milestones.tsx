import type { Milestone } from "@/lib/milestones";

// Clubhouse Pro enhancement, Part 5. Achievement cards per spec: dark
// green background, gold border -- reusing this app's existing
// accent-gold token and glossy card treatment rather than new colors.
// An unachieved milestone still renders (dimmed, "Not yet") so the
// section reads as a checklist to work toward, not just a trophy case.
export function Milestones({ milestones }: { milestones: Milestone[] }) {
  return (
    <section className="glossy rounded-lg border border-border bg-surface p-5">
      <h2 className="font-heading text-lg font-semibold uppercase tracking-wide text-white">Career Milestones</h2>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {milestones.map((m) => (
          <div
            key={m.key}
            className={`glossy rounded-lg border p-4 ${m.achieved ? "border-accent-gold/60 bg-[#0A2214]" : "border-border bg-background/40 opacity-60"}`}
          >
            <div className="flex items-center gap-2">
              <span className="text-2xl">{m.icon}</span>
              <h3 className="font-heading text-sm font-bold uppercase tracking-wide text-accent-gold">{m.title}</h3>
            </div>
            <p className="mt-2 text-sm text-white">{m.detail}</p>
            {m.date && <p className="mt-1 text-xs text-foreground/50">{m.date}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}
