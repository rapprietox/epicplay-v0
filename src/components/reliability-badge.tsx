"use client";

import { useState } from "react";
import { calculateReliability, gamesNeededForTier, RELIABILITY_COLOR_EMOJI, type ReliabilityInput } from "@/lib/reliability";

const COLOR_TEXT: Record<string, string> = {
  red: "#E24B4A",
  amber: "#EF9F27",
  green: "#2ECC71",
  diamond: "#8AABCC",
};

// Fix 2: the fixed scale legend -- always the same four rows regardless
// of this player/lineup's own stats, so it's plain data, not derived.
const SCALE: { emoji: string; range: string; label: string; body: string; need: string }[] = [
  { emoji: "🔴", range: "Under 30%", label: "Very Early Data", body: "Just getting started. Treat suggestions as a starting point only.", need: "Need: 5+ games for meaningful patterns." },
  { emoji: "🟡", range: "30-60%", label: "Emerging Pattern", body: "Some trends are visible but could change.", need: "Need: 10+ games for solid confidence." },
  { emoji: "🟢", range: "61-85%", label: "Solid Pattern", body: "Real patterns emerging from consistent data.", need: "Need: 15+ games for elite accuracy." },
  { emoji: "💎", range: "86%+", label: "Strong Evidence", body: "Deep dataset. High confidence recommendations.", need: "Achieved after: 15 games, 400+ AB, 5+ opponents." },
];

// The three tier thresholds a player can still be working toward --
// matches the cutoffs calculateReliability itself uses (<30 red, <60
// amber, <86 green), so "to reach X" and the badge's own color can
// never disagree with each other.
const NEXT_TIER_THRESHOLDS: { emoji: string; threshold: number }[] = [
  { emoji: "🟡", threshold: 30 },
  { emoji: "🟢", threshold: 60 },
  { emoji: "💎", threshold: 86 },
];

// Lineup Intelligence 2.0, Part 6: used everywhere an AI analysis shows
// its own confidence -- live lineup feedback, full lineup analysis,
// post-game analysis, and the player profile's existing Key Insights
// panel. Recalibration batch, Fix 2 added the collapsed-by-default
// "What does this mean?" explainer, now part of the one shared
// component so every one of those call sites picks it up for free.
export function ReliabilityBadge({ stats }: { stats: ReliabilityInput }) {
  const { score, label, color, description } = calculateReliability(stats);
  const [expanded, setExpanded] = useState(false);

  const remainingTiers = NEXT_TIER_THRESHOLDS.filter((t) => score < t.threshold);

  return (
    <div className="inline-flex flex-col gap-0.5">
      <p className="text-sm font-semibold" style={{ color: COLOR_TEXT[color] }}>
        📊 {score}% Reliable {RELIABILITY_COLOR_EMOJI[color]}
      </p>
      <p className="text-xs text-foreground/50">
        {label} · {description}
      </p>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-1 flex items-center gap-1 text-left text-xs text-foreground/40 transition hover:text-accent-primary"
      >
        <span>ⓘ What does this mean?</span>
        <span className="transition-transform" style={{ transform: expanded ? "rotate(180deg)" : "none" }}>
          ▾
        </span>
      </button>

      {expanded && (
        <div className="mt-2 max-w-sm rounded-md border border-border bg-background/40 p-3 text-xs text-foreground/70">
          <p>
            Reliability measures how much data backs these recommendations. More games and at-bats = more accurate
            analysis.
          </p>

          <div className="mt-3 flex flex-col gap-2.5">
            {SCALE.map((tier) => (
              <div key={tier.emoji}>
                <p className="font-semibold text-white">
                  {tier.emoji} {tier.range} — {tier.label}
                </p>
                <p className="mt-0.5">{tier.body}</p>
                <p className="mt-0.5 text-foreground/40">{tier.need}</p>
              </div>
            ))}
          </div>

          <div className="mt-3 border-t border-border pt-2">
            <p className="text-foreground/50">
              Current: {stats.gamesPlayed} game{stats.gamesPlayed === 1 ? "" : "s"} · {stats.totalAB} AB ·{" "}
              {stats.opponentsCount} opponent{stats.opponentsCount === 1 ? "" : "s"}
            </p>
            {remainingTiers.length === 0 ? (
              <p className="mt-1 text-accent-gold">Top tier reached.</p>
            ) : (
              remainingTiers.map((tier) => {
                const needed = gamesNeededForTier(stats, tier.threshold);
                return (
                  <p key={tier.threshold} className="mt-1 text-foreground/50">
                    To reach {tier.emoji}:{" "}
                    {needed === null
                      ? "more at-bats/opponents needed too"
                      : needed === 0
                        ? "already there on games alone"
                        : `${needed} more game${needed === 1 ? "" : "s"} needed`}
                  </p>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
