import type { Database } from "@/lib/supabase/types";

type Game = Database["public"]["Tables"]["games"]["Row"];

export function resultLetter(game: Pick<Game, "status" | "our_score" | "opponent_score">): "W" | "L" | "T" | null {
  if (game.status !== "completed") return null;
  if (game.our_score > game.opponent_score) return "W";
  if (game.our_score < game.opponent_score) return "L";
  return "T";
}

function opponentKey(game: Pick<Game, "opponent_id" | "opponent_name">): string {
  return game.opponent_id ?? `name:${game.opponent_name}`;
}

export interface OpponentRecord {
  wins: number;
  losses: number;
  ties: number;
}

export function recordAgainstOpponent(
  allGames: Pick<Game, "status" | "our_score" | "opponent_score" | "opponent_id" | "opponent_name">[],
  target: Pick<Game, "opponent_id" | "opponent_name">
): OpponentRecord {
  const key = opponentKey(target);
  const record: OpponentRecord = { wins: 0, losses: 0, ties: 0 };
  for (const g of allGames) {
    if (g.status !== "completed" || opponentKey(g) !== key) continue;
    const result = resultLetter(g);
    if (result === "W") record.wins += 1;
    else if (result === "L") record.losses += 1;
    else if (result === "T") record.ties += 1;
  }
  return record;
}

export function formatRecord(record: OpponentRecord): string {
  return record.ties > 0
    ? `${record.wins}-${record.losses}-${record.ties}`
    : `${record.wins}-${record.losses}`;
}
