import { computeBattingLines } from "@/lib/stats";
import { longestHitStreak } from "@/lib/streaks";
import type { Database } from "@/lib/supabase/types";

type AtBat = Database["public"]["Tables"]["at_bats"]["Row"];
type Game = Database["public"]["Tables"]["games"]["Row"];
type Season = Pick<Database["public"]["Tables"]["seasons"]["Row"], "id" | "name">;

const HIT_RESULTS = new Set(["single", "double", "triple", "hr", "ground_rule_double"]);

export interface Milestone {
  key: string;
  title: string;
  achieved: boolean;
  detail: string;
  date: string | null;
  icon: string;
}

// Clubhouse Pro enhancement, Part 5. All inputs career-wide (page.tsx's
// games/at-bats queries are already team-wide with no season filter, so
// this needs no new query beyond seasons -- see page.tsx's own comment).
// Sorts chronologically once (game_date, then inning/inning_half within
// a game) and walks forward -- "first hit"/"first HR" are the earliest
// qualifying at-bat in that order, not the earliest by created_at (which
// could reorder a backfilled/corrected game out of true chronological
// position).
export function computeMilestones(playerId: string, atBats: AtBat[], games: Game[], seasons: Season[]): Milestone[] {
  const gameById = new Map(games.map((g) => [g.id, g]));
  const decided = atBats.filter((ab): ab is AtBat & { result: NonNullable<AtBat["result"]> } => ab.result !== null);
  const sorted = [...decided].sort((a, b) => {
    const gameA = gameById.get(a.game_id);
    const gameB = gameById.get(b.game_id);
    const dateCmp = (gameA?.game_date ?? "").localeCompare(gameB?.game_date ?? "");
    if (dateCmp !== 0) return dateCmp;
    if (a.inning !== b.inning) return a.inning - b.inning;
    if (a.inning_half !== b.inning_half) return a.inning_half === "top" ? -1 : 1;
    return 0;
  });

  const firstHit = sorted.find((ab) => HIT_RESULTS.has(ab.result));
  const firstHr = sorted.find((ab) => ab.result === "hr");
  const careerHr = decided.filter((ab) => ab.result === "hr").length;

  const playerGameIds = Array.from(new Set(decided.map((ab) => ab.game_id)));
  const chronologicalGames = playerGameIds
    .map((id) => gameById.get(id))
    .filter((g): g is Game => g !== undefined && g.status === "completed")
    .sort((a, b) => a.game_date.localeCompare(b.game_date));
  const longestStreak = longestHitStreak(playerId, atBats, chronologicalGames);

  let bestGame: { game: Game; h: number; rbi: number } | null = null;
  for (const g of chronologicalGames) {
    const line = computeBattingLines(
      decided.filter((ab) => ab.game_id === g.id),
      []
    ).get(playerId);
    if (!line) continue;
    if (!bestGame || line.h > bestGame.h || (line.h === bestGame.h && line.rbi > bestGame.rbi)) {
      bestGame = { game: g, h: line.h, rbi: line.rbi };
    }
  }

  let bestSeason: { season: Season; avg: number } | null = null;
  for (const season of seasons) {
    const seasonGameIds = new Set(games.filter((g) => g.season_id === season.id).map((g) => g.id));
    const seasonAtBats = decided.filter((ab) => seasonGameIds.has(ab.game_id));
    const line = computeBattingLines(seasonAtBats, []).get(playerId);
    if (!line || line.ab < 1) continue;
    if (!bestSeason || line.avg > bestSeason.avg) bestSeason = { season, avg: line.avg };
  }

  return [
    {
      key: "first_hit",
      title: "First Hit",
      achieved: Boolean(firstHit),
      detail: firstHit ? `vs ${gameById.get(firstHit.game_id)?.opponent_name ?? "Unknown"}` : "Not yet",
      date: firstHit ? gameById.get(firstHit.game_id)?.game_date ?? null : null,
      icon: "⚾",
    },
    {
      key: "first_hr",
      title: "First Home Run",
      achieved: Boolean(firstHr),
      detail: firstHr ? `vs ${gameById.get(firstHr.game_id)?.opponent_name ?? "Unknown"}` : "Not yet",
      date: firstHr ? gameById.get(firstHr.game_id)?.game_date ?? null : null,
      icon: "💣",
    },
    {
      key: "career_hr",
      title: "Career Home Runs",
      achieved: careerHr > 0,
      detail: `${careerHr} total`,
      date: null,
      icon: "🏆",
    },
    {
      key: "longest_streak",
      title: "Longest Hitting Streak",
      achieved: longestStreak > 0,
      detail: `${longestStreak} game${longestStreak === 1 ? "" : "s"}`,
      date: null,
      icon: "🔥",
    },
    {
      key: "best_game",
      title: "Best Single Game",
      achieved: Boolean(bestGame),
      detail: bestGame ? `${bestGame.h} hits, ${bestGame.rbi} RBI vs ${bestGame.game.opponent_name}` : "Not yet",
      date: bestGame ? bestGame.game.game_date : null,
      icon: "⭐",
    },
    {
      key: "best_season",
      title: "Best Season AVG",
      achieved: Boolean(bestSeason),
      detail: bestSeason ? `${bestSeason.avg.toFixed(3).replace(/^0\./, ".")} AVG -- ${bestSeason.season.name}` : "Not yet",
      date: null,
      icon: "👑",
    },
  ];
}
