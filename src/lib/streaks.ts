import { computeBattingLines, type BattingLine } from "@/lib/stats";
import type { Database } from "@/lib/supabase/types";

type AtBat = Database["public"]["Tables"]["at_bats"]["Row"];
export type GameLike = Pick<Database["public"]["Tables"]["games"]["Row"], "id" | "game_date">;

export type StreakStatus = "hot" | "steady" | "cold";

// Clubhouse Pro enhancement, Part 4. gamesChronological must already be
// sorted oldest-first (page.tsx's playerGames is sorted newest-first --
// callers reverse before passing in, see hot-cold-streak.tsx).
export function lineForGames(playerId: string, atBats: AtBat[], gameIds: Set<string>): BattingLine | null {
  const filtered = atBats.filter((ab) => gameIds.has(ab.game_id));
  return computeBattingLines(filtered, []).get(playerId) ?? null;
}

export function recentGamesAvg(playerId: string, atBats: AtBat[], gamesChronological: GameLike[], n: number): BattingLine | null {
  const recent = gamesChronological.slice(-n);
  return lineForGames(playerId, atBats, new Set(recent.map((g) => g.id)));
}

// Walks backward from the most recent game, counting consecutive games
// with >= 1 hit. A game with 0 AB (didn't bat, or all walks/HBP) doesn't
// break the streak by itself in real baseball -- but this schema has no
// "did they play" signal beyond "did they have any confirmed at-bats," so
// a 0-AB game is treated as a real gap (matching "consecutive games with
// at least 1 hit" literally, per the request).
export function currentHitStreak(playerId: string, atBats: AtBat[], gamesChronological: GameLike[]): number {
  let streak = 0;
  for (let i = gamesChronological.length - 1; i >= 0; i--) {
    const line = lineForGames(playerId, atBats, new Set([gamesChronological[i].id]));
    if (line && line.h > 0) streak += 1;
    else break;
  }
  return streak;
}

// Part 5 reuses this same walk to find the longest streak anywhere in
// career history, not just the trailing one from today.
export function longestHitStreak(playerId: string, atBats: AtBat[], gamesChronological: GameLike[]): number {
  let longest = 0;
  let current = 0;
  for (const game of gamesChronological) {
    const line = lineForGames(playerId, atBats, new Set([game.id]));
    if (line && line.h > 0) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

export function streakStatus(avg: number): StreakStatus {
  if (avg > 0.35) return "hot";
  if (avg >= 0.2) return "steady";
  return "cold";
}
