// Clubhouse Pro pitch batch: only features that are actually built and
// live today go in the checked list -- the weekly-training-plan-with-
// coach-visible-checklist feature doesn't exist yet, so it's its own
// "Coming soon" row instead of being quietly folded in as if it were
// already real.
const FEATURES = [
  "Three heat maps: batting average, swing and miss, and pitch location, by zone",
  "Spray chart in 2D, and 3D with animated ball trajectories",
  "Your personal KAIROS coach: 20 questions a month about baseball and training, answered from your own numbers",
  "A personalized 4-week plan built from your weak spots",
  "Your EPS score",
  "Situational stats, hot and cold streak, record vs each opponent, season trend chart, and career milestones",
];

export function WhatYouGet() {
  return (
    <div className="mt-6 rounded-md border border-accent-gold/20 bg-background/60 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-gold">What you get</p>
      <ul className="mt-3 flex flex-col gap-2 text-sm text-white/80">
        {FEATURES.map((feature) => (
          <li key={feature} className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 text-accent-green">✓</span>
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-start gap-2 text-sm text-foreground/50">
        <span className="mt-0.5 shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-foreground/40">
          Coming soon
        </span>
        <span>Weekly training plan with a checklist your coach can see</span>
      </div>

      <p className="mt-4 text-xs italic text-foreground/40">
        Built from your real games. The more games are logged, the sharper it gets.
      </p>
    </div>
  );
}
