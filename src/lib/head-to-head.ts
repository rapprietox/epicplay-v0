import { computeBattingLines, type BattingLine } from "@/lib/stats";
import { resultLetter } from "@/lib/opponent-history";
import type { Database } from "@/lib/supabase/types";

type AtBat = Database["public"]["Tables"]["at_bats"]["Row"];
type Game = Database["public"]["Tables"]["games"]["Row"];

// Same opponent_id-first, name-fallback grouping key opponent-history.ts
// already established (a game can be free-text-only, opponent_id null,
// for unscheduled/friendly opponents -- see CLAUDE.md's opponents note).
function opponentKey(game: Pick<Game, "opponent_id" | "opponent_name">): string {
  return game.opponent_id ?? `name:${game.opponent_name}`;
}

export interface HeadToHeadEntry {
  key: string;
  opponentName: string;
  games: { game: Game; line: BattingLine | null; result: "W" | "L" | "T" | null }[];
  line: BattingLine | null;
}

// Clubhouse Pro enhancement, Part 4. Games this player didn't appear in
// (no confirmed at-bat) are excluded from an opponent's game list -- "Games"
// in the table means "games played against them," matching the request's
// own "career stats vs each opponent faced" framing, not "games scheduled."
export function computeHeadToHead(playerId: string, games: Game[], atBats: AtBat[]): HeadToHeadEntry[] {
  const atBatsByGame = new Map<string, AtBat[]>();
  for (const ab of atBats) {
    const list = atBatsByGame.get(ab.game_id);
    if (list) list.push(ab);
    else atBatsByGame.set(ab.game_id, [ab]);
  }

  const entriesByKey = new Map<string, HeadToHeadEntry>();
  for (const game of games) {
    const gameAtBats = atBatsByGame.get(game.id);
    if (!gameAtBats || gameAtBats.length === 0) continue;

    const key = opponentKey(game);
    let entry = entriesByKey.get(key);
    if (!entry) {
      entry = { key, opponentName: game.opponent_name, games: [], line: null };
      entriesByKey.set(key, entry);
    }
    entry.games.push({ game, line: computeBattingLines(gameAtBats, []).get(playerId) ?? null, result: resultLetter(game) });
  }

  const entries = Array.from(entriesByKey.values());
  for (const entry of entries) {
    const allAtBats = entry.games.flatMap(({ game }) => atBatsByGame.get(game.id) ?? []);
    entry.line = computeBattingLines(allAtBats, []).get(playerId) ?? null;
    entry.games.sort((a, b) => b.game.game_date.localeCompare(a.game.game_date));
  }

  return entries.sort((a, b) => b.games.length - a.games.length);
}
