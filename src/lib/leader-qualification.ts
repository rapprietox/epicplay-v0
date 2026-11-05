import type { Database } from "@/lib/supabase/types";

type Game = Pick<Database["public"]["Tables"]["games"]["Row"], "status">;

// Leader-qualification batch: a rate stat (batting average, OBP, SLG,
// OPS, EPS, ERA, WHIP) crowned off a tiny sample is misleading -- one
// lucky at-bat can "lead" the team in AVG in Game 1. These two
// constants scale the bar to how many games the team has actually
// completed -- under whatever filter the board calling this is
// currently showing (the coach board's game-type/time/day filters;
// the player board has none, so its "team games" is just every
// completed game) -- rather than a flat number that's too strict early
// in a season and too loose later.
export const MIN_PA_PER_TEAM_GAME = 2;
export const MIN_IP_PER_TEAM_GAME = 1;

export function countTeamGames(games: Game[]): number {
  return games.filter((g) => g.status === "completed").length;
}

export type RateQualificationKind = "pa" | "ip";

function threshold(kind: RateQualificationKind, teamGames: number): number {
  return (kind === "pa" ? MIN_PA_PER_TEAM_GAME : MIN_IP_PER_TEAM_GAME) * teamGames;
}

// True once the player's own PA (hitting rate stats, including EPS) or
// IP (ERA/WHIP) clears the scaled bar for this many team games. A stat
// with no rate-qualification kind at all (every counting stat -- HR,
// RBI, H, 2B, 3B, SB, K, W, IP itself) is never gated by this at all --
// see src/lib/leader-stats.ts's own spec list for which stats pass a
// kind in here.
export function isRateQualified(kind: RateQualificationKind, metric: number, teamGames: number): boolean {
  return metric >= threshold(kind, teamGames);
}

// How many more PA/IP this player needs to clear the bar -- shown next
// to their name under "Not enough at-bats yet" in the ranking modal.
// Rounded up: "1.4 more IP needed" reads worse than "2 more IP needed."
export function rateShortfall(kind: RateQualificationKind, metric: number, teamGames: number): number {
  return Math.max(0, Math.ceil(threshold(kind, teamGames) - metric));
}
