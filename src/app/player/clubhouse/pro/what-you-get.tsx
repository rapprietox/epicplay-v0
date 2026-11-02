import { KAIROS_DESCRIPTION, TRACKING_MODES_NOTE } from "@/lib/clubhouse-copy";
import { EpsInfoTrigger } from "@/components/eps-info-panel";

// Clubhouse Pro pitch batch + explain-EPS/KAIROS/tracking-modes batch:
// only features that are actually built and live today go in the
// checked list -- the weekly-training-plan-with-coach-visible-checklist
// feature doesn't exist yet, so it's its own "Coming soon" row instead
// of being quietly folded in as if it were already real. The KAIROS
// line and the tracking-modes note both come from src/lib/clubhouse-copy.ts
// so they can't drift from the same wording shown elsewhere (the KAIROS
// widget's own intro, the player profile).
export function WhatYouGet() {
  return (
    <div className="mt-6 rounded-md border border-accent-gold/20 bg-background/60 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-gold">What you get</p>
      <ul className="mt-3 flex flex-col gap-2 text-sm text-white/80">
        <FeatureRow>Three heat maps: batting average, swing and miss, and pitch location, by zone</FeatureRow>
        <FeatureRow>Spray chart in 2D, and 3D with animated ball trajectories</FeatureRow>
        <FeatureRow>{KAIROS_DESCRIPTION}</FeatureRow>
        <FeatureRow>A personalized 4-week plan built from your weak spots</FeatureRow>
        <FeatureRow>
          <span className="inline-flex items-center gap-1">
            Your EPS score
            <EpsInfoTrigger />
          </span>
        </FeatureRow>
        <FeatureRow>Situational stats, hot and cold streak, record vs each opponent, season trend chart, and career milestones</FeatureRow>
      </ul>

      <div className="mt-3 flex items-start gap-2 text-sm text-foreground/50">
        <span className="mt-0.5 shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-foreground/40">
          Coming soon
        </span>
        <span>Weekly training plan with a checklist your coach can see</span>
      </div>

      <p className="mt-4 text-xs text-foreground/40">{TRACKING_MODES_NOTE}</p>

      <p className="mt-2 text-xs italic text-foreground/40">
        Built from your real games. The more games are logged, the sharper it gets.
      </p>
    </div>
  );
}

function FeatureRow({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0 text-accent-green">✓</span>
      <span>{children}</span>
    </li>
  );
}
