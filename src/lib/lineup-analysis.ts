import { computeBattingLines } from "@/lib/stats";
import type { Database } from "@/lib/supabase/types";

type AtBat = Database["public"]["Tables"]["at_bats"]["Row"];
type Lineup = Database["public"]["Tables"]["lineup"]["Row"];
type Game = Pick<Database["public"]["Tables"]["games"]["Row"], "id" | "game_date">;
type Player = Pick<Database["public"]["Tables"]["players"]["Row"], "id" | "name" | "jersey_number">;

export type Rating = "green" | "amber" | "red" | "none";

export interface LineupSlotStat {
  slot: number;
  playerId: string;
  playerName: string;
  playerJersey: number | null;
  pa: number;
  avg: number;
  obp: number;
  slg: number;
  kPct: number;
  bbPct: number;
  // null means genuinely not enough RISP at-bats to show a number (< 2),
  // not a zero average -- rendered as "--" per the request.
  rispAvg: number | null;
  rispAb: number;
}

export const RATING_BG: Record<Rating, string | undefined> = {
  green: "rgba(46, 204, 113, 0.2)",
  amber: "rgba(239, 159, 39, 0.2)",
  red: "rgba(226, 75, 74, 0.2)",
  none: undefined,
};

const MIN_PA_FOR_COLOR = 3;
const MIN_RISP_AB = 2;

export function rateAvg(value: number, pa: number): Rating {
  if (pa < MIN_PA_FOR_COLOR) return "none";
  return value >= 0.3 ? "green" : value >= 0.2 ? "amber" : "red";
}

export function rateObp(value: number, pa: number): Rating {
  if (pa < MIN_PA_FOR_COLOR) return "none";
  return value >= 0.38 ? "green" : value >= 0.28 ? "amber" : "red";
}

export function rateSlg(value: number, pa: number): Rating {
  if (pa < MIN_PA_FOR_COLOR) return "none";
  return value >= 0.45 ? "green" : value >= 0.3 ? "amber" : "red";
}

// Lower is better for K%.
export function rateKPct(value: number, pa: number): Rating {
  if (pa < MIN_PA_FOR_COLOR) return "none";
  return value <= 0.15 ? "green" : value <= 0.25 ? "amber" : "red";
}

export function rateBbPct(value: number, pa: number): Rating {
  if (pa < MIN_PA_FOR_COLOR) return "none";
  return value >= 0.12 ? "green" : value >= 0.06 ? "amber" : "red";
}

export function rateRisp(value: number | null, rispAb: number): Rating {
  if (value === null || rispAb < MIN_RISP_AB) return "none";
  return value >= 0.3 ? "green" : value >= 0.2 ? "amber" : "red";
}

// Feature 1: picks the most recent game that has a starting lineup on
// record to define "slot -> player" -- a season's worth of games can
// easily have used different batting orders (confirmed true for this
// team's own Game 1 vs Game 2), so there's no single season-wide
// "slot 3 player" otherwise. This is a judgment call, not something the
// request specified -- flagged here since it determines whose stats
// show in every row.
export function findCurrentLineup(games: Game[], lineupRows: Lineup[]): { gameId: string; rows: Lineup[] } | null {
  // batting_order is nullable (a reserve/absent lineup row has none) --
  // only rows with a real slot number belong in this grid.
  const slotted = lineupRows.filter((r): r is Lineup & { batting_order: number } => r.batting_order !== null);
  const gameIdsWithLineup = new Set(slotted.map((r) => r.game_id));
  const candidates = games.filter((g) => gameIdsWithLineup.has(g.id));
  if (candidates.length === 0) return null;
  const mostRecent = [...candidates].sort((a, b) => b.game_date.localeCompare(a.game_date))[0];
  return {
    gameId: mostRecent.id,
    rows: slotted.filter((r) => r.game_id === mostRecent.id).sort((a, b) => a.batting_order - b.batting_order),
  };
}

export function computeLineupMatrix(lineupRows: Lineup[], players: Player[], atBats: AtBat[]): LineupSlotStat[] {
  const playerById = new Map(players.map((p) => [p.id, p]));
  const battingLines = computeBattingLines(atBats, []);

  const rows: LineupSlotStat[] = [];
  for (const slot of lineupRows) {
    // batting_order is nullable (a reserve/absent row has none) -- only
    // rows with a real slot number belong in this grid.
    if (slot.batting_order === null) continue;
    const player = playerById.get(slot.player_id);
    if (!player) continue;
    const line = battingLines.get(slot.player_id);

    // RISP: only non-null risp_before rows count, per that column's own
    // documented nullability (null = logged before this was tracked).
    const rispAtBats = atBats.filter((ab) => ab.player_id === slot.player_id && ab.risp_before === true);
    const rispLine = computeBattingLines(rispAtBats, []).get(slot.player_id);
    const rispAb = rispLine?.ab ?? 0;

    rows.push({
      slot: slot.batting_order,
      playerId: slot.player_id,
      playerName: player.name,
      playerJersey: player.jersey_number,
      pa: line?.pa ?? 0,
      avg: line?.avg ?? 0,
      obp: line?.obp ?? 0,
      slg: line?.slg ?? 0,
      kPct: line && line.pa > 0 ? line.k / line.pa : 0,
      bbPct: line && line.pa > 0 ? line.bb / line.pa : 0,
      rispAvg: rispAb >= MIN_RISP_AB ? rispLine!.avg : null,
      rispAb,
    });
  }
  return rows;
}

// "2 or more consecutive slots are red in OBP" -- returns the set of
// slot numbers belonging to any such run.
export function detectLineupHoles(rows: LineupSlotStat[]): Set<number> {
  const holes = new Set<number>();
  let streak: number[] = [];
  for (const row of rows) {
    if (rateObp(row.obp, row.pa) === "red") {
      streak.push(row.slot);
    } else {
      if (streak.length >= 2) streak.forEach((s) => holes.add(s));
      streak = [];
    }
  }
  if (streak.length >= 2) streak.forEach((s) => holes.add(s));
  return holes;
}
