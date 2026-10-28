import { computeBattingLines, type BattingLine } from "@/lib/stats";
import type { Database } from "@/lib/supabase/types";

type AtBat = Database["public"]["Tables"]["at_bats"]["Row"];
type GameEvent = Pick<Database["public"]["Tables"]["game_events"]["Row"], "event_type" | "player_id">;

const MIN_PA_FOR_EPS = 5;

// Update 2: six-tier scale, replacing the earlier four-tier one.
export type EpsTier = "legendary" | "elite" | "strong" | "solid" | "developing" | "beginner";

export const EPS_TIER_LABEL: Record<EpsTier, string> = {
  legendary: "Legendary 🏆",
  elite: "Elite 🔥",
  strong: "Strong 💪",
  solid: "Solid ⚾",
  developing: "Developing 📈",
  beginner: "Beginner 🌱",
};

export function epsTier(eps: number): EpsTier {
  if (eps >= 85) return "legendary";
  if (eps >= 70) return "elite";
  if (eps >= 55) return "strong";
  if (eps >= 40) return "solid";
  if (eps >= 25) return "developing";
  return "beginner";
}

// Update 1: this request said "replace the formula in src/lib/stats.ts"
// and gave calculateEPS(stats: BattingLine) reading stats.cs directly --
// kept here in src/lib/eps.ts instead, with caught-stealing still a
// separate parameter, not a BattingLine field. BattingLine is produced
// by computeBattingLines(atBats, stolenBases), which has no access to
// game_events at all (caught_stealing only exists there) -- adding a
// `cs` field would mean threading game_events into computeBattingLines'
// own signature and updating every one of its call sites (leaders-board,
// the player profile page, Clubhouse, kairos-actions, situational-stats,
// lineup-analysis), not just this one formula. Keeping EPS as its own
// small function that takes the extra data as its own argument is the
// same approach the previous EPS version already used, just with the
// new math ported in.
//
// This version also drops the RISP term entirely -- the new formula
// doesn't have one. RISP AVG still exists as its own column in the
// Lineup Analysis grid (computed independently there), just no longer
// feeds EPS.
//
// Weights sum to at most 40+30+20+10 = 100 by construction (each term
// is itself capped before scaling), which is what actually fixes "scale
// 0-100" -- the previous version could exceed 100 in a small/extreme
// sample and relied on an outer clamp instead of the formula itself
// bounding it.
export function computeEps(line: Pick<BattingLine, "obp" | "slg" | "bb" | "k" | "pa" | "sb">, caughtStealing: number): number | null {
  if (line.pa < MIN_PA_FOR_EPS) return null;

  const ops = Math.min((line.obp + line.slg) / 2.0, 1) * 40;
  const bbPct = Math.min(line.bb / line.pa, 1) * 30;
  const contactPct = Math.max(1 - line.k / line.pa, 0) * 20;
  const sbAttempts = line.sb + caughtStealing;
  // Neutral 5 of the 10 possible points when there's no steal attempt at
  // all to judge, rather than 0 (which would read as "bad baserunning"
  // for a player who's simply never tried).
  const sbSuccess = sbAttempts > 0 ? (line.sb / sbAttempts) * 10 : 5;

  return Math.round((ops + bbPct + contactPct + sbSuccess) * 10) / 10;
}

function caughtStealingFor(playerId: string, gameEvents: GameEvent[]): number {
  return gameEvents.filter((e) => e.event_type === "caught_stealing" && e.player_id === playerId).length;
}

// One-player convenience wrapper -- the player profile page and
// Clubhouse Pro header each only ever need a single player's score.
export function computeEpsForPlayer(playerId: string, atBats: AtBat[], gameEvents: GameEvent[]): number | null {
  const line = computeBattingLines(atBats.filter((ab) => ab.player_id === playerId), []).get(playerId);
  if (!line) return null;
  return computeEps(line, caughtStealingFor(playerId, gameEvents));
}

// Roster-wide convenience wrapper -- the Team Leaders Board needs every
// player's score at once to rank them.
export function computeEpsForRoster(playerIds: string[], atBats: AtBat[], gameEvents: GameEvent[]): Map<string, number | null> {
  const lines = computeBattingLines(atBats, []);
  const result = new Map<string, number | null>();
  for (const playerId of playerIds) {
    const line = lines.get(playerId);
    if (!line) {
      result.set(playerId, null);
      continue;
    }
    result.set(playerId, computeEps(line, caughtStealingFor(playerId, gameEvents)));
  }
  return result;
}
