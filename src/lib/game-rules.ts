import type { Database } from "@/lib/supabase/types";

type Game = Database["public"]["Tables"]["games"]["Row"];
type Season = Database["public"]["Tables"]["seasons"]["Row"];

export interface GameRules {
  maxInnings: number | null;
  timeLimitMinutes: number | null;
  newInningThresholdMinutes: number;
}

// Feature 2 (game-rules batch): a game with override_season_rules set
// owns its own three values outright (a blank field there means "no
// limit for this game specifically," not "fall back to the season") --
// otherwise every value comes from the season, or from nothing at all
// if the game has no season (a manual/friendly game).
export function resolveGameRules(
  game: Pick<Game, "override_season_rules" | "max_innings" | "time_limit_minutes" | "new_inning_threshold_minutes">,
  season: Pick<Season, "max_innings" | "time_limit_minutes" | "new_inning_threshold_minutes"> | null
): GameRules {
  if (game.override_season_rules) {
    return {
      maxInnings: game.max_innings,
      timeLimitMinutes: game.time_limit_minutes,
      newInningThresholdMinutes: game.new_inning_threshold_minutes ?? 10,
    };
  }
  return {
    maxInnings: season?.max_innings ?? null,
    timeLimitMinutes: season?.time_limit_minutes ?? null,
    newInningThresholdMinutes: season?.new_inning_threshold_minutes ?? 10,
  };
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export interface InningEndBanner {
  kind: "innings_limit" | "time_limit" | "next_inning_ok";
  message: string;
}

// Checked once, right when the operator taps End Inning -- never blocks
// anything, per spec ("the operator always decides"), just informs.
// completedInnings is however many full innings (both halves) have
// actually finished as of this tap -- computed by the caller from
// state.inning/state.inningHalf *before* dispatching the inning
// advance, since which inning just "completed" depends on whether a top
// or a bottom half was the one that just ended.
export function checkInningEndBanner(rules: GameRules, completedInnings: number, elapsedMs: number): InningEndBanner | null {
  if (rules.maxInnings !== null && completedInnings >= rules.maxInnings) {
    return { kind: "innings_limit", message: "INNINGS LIMIT REACHED — this was the final inning" };
  }

  if (rules.timeLimitMinutes !== null) {
    const remainingMinutes = rules.timeLimitMinutes - elapsedMs / 60_000;
    if (remainingMinutes <= rules.newInningThresholdMinutes) {
      return { kind: "time_limit", message: "TIME LIMIT — do not start a new inning. Complete current game." };
    }
    return {
      kind: "next_inning_ok",
      message: `Next inning allowed — ${Math.floor(remainingMinutes)} minutes remaining`,
    };
  }

  return null;
}
