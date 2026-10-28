// Lineup Intelligence 2.0, Part 6. Ported exactly as given -- weights
// sum to 100 (40 + 30 + 20 + 10) by construction, each term capped
// before scaling, same "fix scaling via the formula itself, not an
// outer clamp" shape as the EPS rework (src/lib/eps.ts).
export interface ReliabilityInput {
  totalAB: number;
  gamesPlayed: number;
  opponentsCount: number;
  situationVariety?: number;
}

export type ReliabilityColor = "red" | "amber" | "green" | "diamond";

export interface ReliabilityResult {
  score: number;
  label: string;
  color: ReliabilityColor;
  description: string;
}

export function calculateReliability(stats: ReliabilityInput): ReliabilityResult {
  const abScore = Math.min(stats.totalAB / 30, 1) * 40;
  const gamesScore = Math.min(stats.gamesPlayed / 10, 1) * 30;
  const opponentScore = Math.min(stats.opponentsCount / 3, 1) * 20;
  const situationScore = Math.min((stats.situationVariety || 1) / 4, 1) * 10;

  const score = Math.round(abScore + gamesScore + opponentScore + situationScore);

  if (score < 30) {
    return {
      score,
      label: "Very Early Data",
      color: "red",
      description: `${stats.gamesPlayed} game${stats.gamesPlayed === 1 ? "" : "s"} · ${stats.totalAB} AB · ${stats.opponentsCount} opponent${stats.opponentsCount === 1 ? "" : "s"}`,
    };
  }
  if (score < 60) {
    return {
      score,
      label: "Emerging Pattern",
      color: "amber",
      description: `${stats.gamesPlayed} games · ${stats.totalAB} AB · ${stats.opponentsCount} opponents`,
    };
  }
  if (score < 86) {
    return {
      score,
      label: "Solid Pattern",
      color: "green",
      description: `${stats.gamesPlayed} games · ${stats.totalAB} AB · ${stats.opponentsCount} opponents`,
    };
  }
  return {
    score,
    label: "Strong Evidence",
    color: "diamond",
    description: `${stats.gamesPlayed} games · ${stats.totalAB} AB · ${stats.opponentsCount} opponents`,
  };
}

export const RELIABILITY_COLOR_EMOJI: Record<ReliabilityColor, string> = {
  red: "🔴",
  amber: "🟡",
  green: "🟢",
  diamond: "💎",
};
