import { computeBattingLines, type BattingLine } from "@/lib/stats";
import type { Database } from "@/lib/supabase/types";

type AtBat = Database["public"]["Tables"]["at_bats"]["Row"];
type GameEvent = Pick<Database["public"]["Tables"]["game_events"]["Row"], "event_type" | "player_id">;

const MIN_PA_FOR_EPS = 5;

export type EpsTier = "elite" | "strong" | "average" | "developing";

export const EPS_TIER_LABEL: Record<EpsTier, string> = {
  elite: "Elite 🔥",
  strong: "Strong 💪",
  average: "Average ⚾",
  developing: "Developing 📈",
};

export function epsTier(eps: number): EpsTier {
  if (eps >= 70) return "elite";
  if (eps >= 55) return "strong";
  if (eps >= 40) return "average";
  return "developing";
}

// EPS = (OPS x 40) + (BB% x 100) + ((1 - K%) x 30) + (SB_success_rate x 20) + (RISP_AVG x 50)
// Two terms need a documented default when the underlying data doesn't
// exist for a player, rather than withholding the whole score (the
// request's only stated gate is "minimum 5 PA", not "minimum RISP/SB
// data"):
//   - RISP_AVG: null (not >= 2 RISP at-bats) contributes 0, not a block.
//     This matters a lot right now -- at_bats.risp_before is null for
//     every at-bat logged before the column existed, which today means
//     EVERY historical at-bat for this team. Treating null as a hard
//     block would make EPS show "--" for the whole roster indefinitely;
//     treating it as 0 lets the score reflect what IS known and simply
//     improves as risp_before starts getting populated going forward.
//   - SB_success_rate: 0 attempts (no steals, no caught-stealing) -> 0,
//     not a divide-by-zero.
// Clamped to [0, 100] -- the raw weighted sum can technically exceed
// that range in a small/extreme sample (the "scaled 0-100" framing is a
// display bound, not a literal re-derivation of the formula's weights).
export function computeEps(line: Pick<BattingLine, "ops" | "bb" | "k" | "pa" | "sb">, caughtStealing: number, rispAvg: number | null): number | null {
  if (line.pa < MIN_PA_FOR_EPS) return null;
  const bbPct = line.pa > 0 ? line.bb / line.pa : 0;
  const kPct = line.pa > 0 ? line.k / line.pa : 0;
  const sbAttempts = line.sb + caughtStealing;
  const sbSuccessRate = sbAttempts > 0 ? line.sb / sbAttempts : 0;
  const rispTerm = rispAvg ?? 0;

  const raw = line.ops * 40 + bbPct * 100 + (1 - kPct) * 30 + sbSuccessRate * 20 + rispTerm * 50;
  return Math.max(0, Math.min(100, raw));
}

const MIN_RISP_AB = 2;

function rispAvgFor(playerId: string, atBats: AtBat[]): number | null {
  const rispAtBats = atBats.filter((ab) => ab.player_id === playerId && ab.risp_before === true);
  const line = computeBattingLines(rispAtBats, []).get(playerId);
  return line && line.ab >= MIN_RISP_AB ? line.avg : null;
}

function caughtStealingFor(playerId: string, gameEvents: GameEvent[]): number {
  return gameEvents.filter((e) => e.event_type === "caught_stealing" && e.player_id === playerId).length;
}

// One-player convenience wrapper -- the player profile page and
// Clubhouse Pro header each only ever need a single player's score.
export function computeEpsForPlayer(playerId: string, atBats: AtBat[], gameEvents: GameEvent[]): number | null {
  const line = computeBattingLines(atBats.filter((ab) => ab.player_id === playerId), []).get(playerId);
  if (!line) return null;
  return computeEps(line, caughtStealingFor(playerId, gameEvents), rispAvgFor(playerId, atBats));
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
    result.set(playerId, computeEps(line, caughtStealingFor(playerId, gameEvents), rispAvgFor(playerId, atBats)));
  }
  return result;
}
