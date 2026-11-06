import type { AtBatResult, GameEventType } from "@/lib/supabase/types";

// Fixed, non-AI narration templates for the public live view. Every
// function here is a pure string template keyed off a stored
// enum/result value -- no free text is ever generated, per the
// request's "No AI" instruction.
//
// Two real, honest gaps (documented here rather than silently
// fabricated, matching this codebase's own established pattern for
// schema limitations -- see CLAUDE.md):
//
// 1. `stolen_bases` has no "to which base" column (just game_id,
//    player_id, inning) -- there is no stored way to say "steals
//    second" vs. "steals third" vs. "steals home." narrateStolenBase
//    below says "steals a base," not a specific one. Adding a
//    `to_base` column would also need the operator's own
//    logStolenBase write path to start populating it, which this
//    feature isn't allowed to touch (no changes to operator console or
//    scoring logic).
// 2. `at_bats` has no column for an opposing batter's identity on a
//    mode='pitching' row (see CLAUDE.md's "Opposing batter identity"
//    note -- it's display-only, held in game_state.opponent_batter_name,
//    and never persisted). A historical opponent at-bat is narrated as
//    a bare "Opponent," never a fabricated jersey number, for the same
//    reason: the real fix is a write-path change this feature can't
//    make.

function locationPhrase(fieldX: number | null): string {
  if (fieldX === null) return "";
  // Field diagram coordinates are 0-100 across the image
  // (src/app/operator/field-diagram.tsx) -- a simple left/center/right
  // third of that span is a defensible, deterministic (not AI-guessed)
  // approximation of "to center," good enough for broadcast flavor text,
  // not a precise fielding location.
  if (fieldX < 33.3) return " to left";
  if (fieldX > 66.7) return " to right";
  return " to center";
}

const HIT_RESULT_VERB: Partial<Record<AtBatResult, string>> = {
  single: "singles",
  double: "doubles",
  triple: "triples",
};

export function narrateAtBatResult(opts: {
  batterName: string;
  result: AtBatResult | null;
  fieldX: number | null;
}): string | null {
  const { batterName, result, fieldX } = opts;
  if (!result) return null;
  const loc = locationPhrase(fieldX);

  const verb = HIT_RESULT_VERB[result];
  if (verb) return `${batterName} ${verb}${loc}.`;

  switch (result) {
    case "hr":
      return `${batterName} homers${loc}!`;
    case "ground_rule_double":
      return `${batterName} doubles on a ground-rule bounce.`;
    case "walk":
      return `${batterName} walks.`;
    case "intentional_walk":
      return `${batterName} is walked intentionally.`;
    case "hbp":
      return `${batterName} is hit by the pitch.`;
    case "strikeout":
      return `${batterName} strikes out.`;
    case "dropped_third_strike_safe":
      return `${batterName} reaches on a dropped third strike.`;
    case "groundout":
      return `${batterName} grounds out.`;
    case "flyout":
      return `${batterName} flies out${loc}.`;
    case "lineout":
      return `${batterName} lines out${loc}.`;
    case "double_play":
      return `${batterName} grounds into a double play.`;
    case "fc":
      return `${batterName} reaches on a fielder's choice.`;
    case "error":
      return `${batterName} reaches on an error.`;
    default:
      return `${batterName}: ${result}.`;
  }
}

// Fixed per the request's own example ("Mike C. steals second") in
// spirit -- but see gap #1 above for why the base itself is never named.
export function narrateStolenBase(runnerName: string): string {
  return `${runnerName} steals a base.`;
}

export function narrateSubstitution(inName: string, outName: string): string {
  return `${inName} replaces ${outName}.`;
}

// "Run scores" -- the request's own fixed template, repeated once per
// run so a 2-run double still narrates as two short broadcast lines
// rather than one "2 runs score" sentence this phase doesn't template.
export function narrateRun(): string {
  return "Run scores.";
}

export function narrateGameEvent(eventType: GameEventType, subjectName: string | null): string | null {
  switch (eventType) {
    case "wild_pitch":
      return "Wild pitch.";
    case "passed_ball":
      return "Passed ball.";
    case "balk":
      return "Balk.";
    case "error":
      return "Error on the play.";
    case "pickoff_out":
      return subjectName ? `${subjectName} picked off.` : "Runner picked off.";
    case "pickoff_attempt":
      return "Pickoff attempt -- safe.";
    case "tag_up_violation":
      return subjectName ? `${subjectName} called out on appeal.` : "Runner called out on appeal.";
    case "caught_stealing":
      return subjectName ? `${subjectName} caught stealing.` : "Runner caught stealing.";
    case "rundown_out":
      return subjectName ? `${subjectName} out in a rundown.` : "Runner out in a rundown.";
    case "runner_passed":
      return subjectName ? `${subjectName} out for passing another runner.` : "Runner out for passing another runner.";
    case "out_at_next_base":
      return subjectName ? `${subjectName} out advancing.` : "Runner out advancing.";
    case "squeeze_play":
      return "Squeeze play.";
    case "dropped_third_strike":
      return "Dropped third strike.";
    case "substitution":
      // Not narrated from here -- the substitutions table has the real
      // player_out_id/player_in_id directly, so the API route builds
      // this line from narrateSubstitution() below instead of guessing
      // what this event_type's own player_id/opponent_player_id mean.
      return null;
    case "runner_scored":
      return null; // the separate "Run scores." line (narrateRun) already covers this
    case "late_arrival":
      return null; // roster logistics, not a play -- not narrated
    default:
      return null;
  }
}
