import { computeBattingLines, type BattingLine } from "@/lib/stats";
import { resolveStartMinutes, timeOfDayBucket } from "@/lib/game-time-filters";
import type { Database } from "@/lib/supabase/types";

type AtBat = Database["public"]["Tables"]["at_bats"]["Row"];
type Game = Pick<Database["public"]["Tables"]["games"]["Row"], "id" | "home_away" | "start_time" | "game_time">;

export interface SituationalRow {
  situation: string;
  line: BattingLine | null;
  // Only set for the two rows this schema can't derive historically
  // (RISP, 2 outs) -- see the migration's own comment. Rendered as an
  // honest "not tracked yet" note instead of a misleading 0-AB row.
  notTrackedNote?: string;
}

function lineFor(playerId: string, atBats: AtBat[]): BattingLine | null {
  const line = computeBattingLines(atBats, []).get(playerId);
  return line ?? null;
}

// Clubhouse Pro enhancement, Part 4. Five situational splits per the
// request; two of them (RISP, 2 outs) needed new at_bats columns
// (outs_before/risp_before) snapshotted at the moment each at-bat starts
// -- see the operator-side wiring in src/app/operator/actions.ts. Those
// columns are null for every at-bat logged before this shipped, so both
// rows are computed ONLY over non-null rows and explicitly flagged when
// there isn't any non-null data yet, rather than rendering a misleading
// 0-AB line.
export function computeSituationalStats(playerId: string, atBats: AtBat[], gamesById: Map<string, Game>): SituationalRow[] {
  const rows: SituationalRow[] = [];

  rows.push({ situation: "Runners in Scoring Position", ...rispOrTrackedNote(playerId, atBats) });
  rows.push({ situation: "2 Outs", ...outsOrTrackedNote(playerId, atBats) });

  const lateInnings = atBats.filter((ab) => ab.inning >= 5);
  rows.push({ situation: "Late Innings (5th+)", line: lineFor(playerId, lateInnings) });

  const home = atBats.filter((ab) => gamesById.get(ab.game_id)?.home_away === "home");
  const away = atBats.filter((ab) => gamesById.get(ab.game_id)?.home_away === "away");
  rows.push({ situation: "Home Games", line: lineFor(playerId, home) });
  rows.push({ situation: "Away Games", line: lineFor(playerId, away) });

  const day: AtBat[] = [];
  const night: AtBat[] = [];
  for (const ab of atBats) {
    const game = gamesById.get(ab.game_id);
    if (!game) continue;
    const minutes = resolveStartMinutes(game);
    const bucket = timeOfDayBucket(minutes);
    if (bucket === "morning" || bucket === "afternoon") day.push(ab);
    else if (bucket === "evening" || bucket === "night") night.push(ab);
    // No resolvable start time -- excluded from this pair of rows
    // specifically, not silently counted as either.
  }
  rows.push({ situation: "Day Games", line: lineFor(playerId, day) });
  rows.push({ situation: "Night Games", line: lineFor(playerId, night) });

  return rows;
}

function rispOrTrackedNote(playerId: string, atBats: AtBat[]): Pick<SituationalRow, "line" | "notTrackedNote"> {
  const tracked = atBats.filter((ab) => ab.risp_before !== null);
  if (tracked.length === 0) {
    return { line: null, notTrackedNote: "Not tracked yet -- available for games logged from today forward." };
  }
  return { line: lineFor(playerId, tracked.filter((ab) => ab.risp_before === true)) };
}

function outsOrTrackedNote(playerId: string, atBats: AtBat[]): Pick<SituationalRow, "line" | "notTrackedNote"> {
  const tracked = atBats.filter((ab) => ab.outs_before !== null);
  if (tracked.length === 0) {
    return { line: null, notTrackedNote: "Not tracked yet -- available for games logged from today forward." };
  }
  return { line: lineFor(playerId, tracked.filter((ab) => ab.outs_before === 2)) };
}
