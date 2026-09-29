import type { BattingLine } from "@/lib/stats";
import type { Database } from "@/lib/supabase/types";

type Game = Database["public"]["Tables"]["games"]["Row"];

// Clubhouse batch: shared between game-history.tsx (the list) and
// pregame-card.tsx (the "no game today" last-game fallback), so both
// render the same personal-line shape consistently.
export interface GameHistoryRow {
  game: Game;
  line: BattingLine | undefined;
  result: "W" | "L" | "T";
}

export function formatPersonalLine(line: BattingLine | undefined): string {
  if (!line || line.ab === 0) return "Did not bat";
  const parts = [`${line.h}-${line.ab}`];
  if (line.hr > 0) parts.push(`${line.hr} HR`);
  if (line.rbi > 0) parts.push(`${line.rbi} RBI`);
  return parts.join(", ");
}
