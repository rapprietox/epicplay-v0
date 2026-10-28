import { calculateReliability, RELIABILITY_COLOR_EMOJI, type ReliabilityInput } from "@/lib/reliability";

const COLOR_TEXT: Record<string, string> = {
  red: "#E24B4A",
  amber: "#EF9F27",
  green: "#2ECC71",
  diamond: "#8AABCC",
};

// Lineup Intelligence 2.0, Part 6: used everywhere an AI analysis shows
// its own confidence -- live lineup feedback, full lineup analysis,
// post-game analysis, and the player profile's existing Key Insights
// panel.
export function ReliabilityBadge({ stats }: { stats: ReliabilityInput }) {
  const { score, label, color, description } = calculateReliability(stats);
  return (
    <div className="inline-flex flex-col gap-0.5">
      <p className="text-sm font-semibold" style={{ color: COLOR_TEXT[color] }}>
        📊 {score}% Reliable {RELIABILITY_COLOR_EMOJI[color]}
      </p>
      <p className="text-xs text-foreground/50">
        {label} · {description}
      </p>
    </div>
  );
}
