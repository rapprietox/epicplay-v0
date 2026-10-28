// Lineup Intelligence 2.0, Part 6. Recalibration batch, Fix 1: the
// original weights (AB-dominant, 40/30/20/10 with low caps -- 30 AB,
// 10 games, 3 opponents) let 2 games / 50 AB alone reach ~62%, which
// read as misleadingly confident for that little data. Replaced with
// games-dominant weights (50/30/20, capped at 15 games/100 AB/5
// opponents) per the user's own formula -- 2 games/50 AB/2 opponents
// now lands at ~30%, matching their worked example. situationVariety
// is dropped, not kept optional-and-ignored: no call site ever passed
// it, and the new 3-factor formula has no slot for a 4th term.
export interface ReliabilityInput {
  totalAB: number;
  gamesPlayed: number;
  opponentsCount: number;
}

export type ReliabilityColor = "red" | "amber" | "green" | "diamond";

export interface ReliabilityResult {
  score: number;
  label: string;
  color: ReliabilityColor;
  description: string;
}

export function calculateReliability(stats: ReliabilityInput): ReliabilityResult {
  // Games is the most important factor: 2 games = max ~30%, 5 games =
  // ~55%, 10 games = ~75%, 15+ games = ~90% (of the games term alone).
  const gamesScore = Math.min(stats.gamesPlayed / 15, 1) * 50;
  // AB matters but secondary: 20 AB = 10pts, 50 AB = 20pts, 100+ AB = 30pts.
  const abScore = Math.min(stats.totalAB / 100, 1) * 30;
  // Opponent variety: 1 opponent = 5pts, 3+ = 15pts, 5+ = 20pts.
  const opponentScore = Math.min(stats.opponentsCount / 5, 1) * 20;

  const score = Math.round(gamesScore + abScore + opponentScore);

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

// Fix 2: "games needed" to clear a higher tier, holding totalAB/
// opponentsCount at their current values -- the request only ever asks
// for a games count, never an AB or opponent count, so games is the
// one variable solved for here. Returns null when the target is
// unreachable through games alone at the current AB/opponent pace
// (gamesScore caps at 50 once gamesPlayed hits 15), so the UI can say
// so honestly instead of showing a wrong number.
export function gamesNeededForTier(stats: ReliabilityInput, targetScore: number): number | null {
  const abScore = Math.min(stats.totalAB / 100, 1) * 30;
  const opponentScore = Math.min(stats.opponentsCount / 5, 1) * 20;
  const remaining = targetScore - abScore - opponentScore;
  if (remaining <= 0) return 0;
  const neededTotalGames = Math.ceil((remaining / 50) * 15);
  if (neededTotalGames > 15) return null;
  return Math.max(0, neededTotalGames - stats.gamesPlayed);
}
