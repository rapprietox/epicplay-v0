import type { AtBatResult, GameEventType } from "@/lib/supabase/types";

// Energetic, varied broadcast narration for the public live view. Still
// no AI calls -- every line here is one of a handful of fixed, hand-
// written templates, deterministically CHOSEN (see pick() below), never
// generated. No swearing, nothing about a player's body or age, per the
// request.
//
// Deterministic variant picker: the API route is stateless (no session,
// no "which variant did I already show this viewer" memory), and a play
// stays inside the narration window across many /api/live polls (every
// 3s) while the viewer is looking at it. Math.random() per request would
// make the SAME play's text flicker between variants on screen even
// though nothing about the play changed. Hashing the play's own stable
// id into an index instead means the same play always resolves to the
// same line, for as long as it's shown, across every poll.
function pick<T>(seed: string, options: readonly T[]): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return options[Math.abs(h) % options.length];
}

// Two real, honest gaps (documented here rather than silently
// fabricated, matching this codebase's own established pattern for
// schema limitations -- see CLAUDE.md):
//
// 1. `stolen_bases` has no "to which base" column (just game_id,
//    player_id, inning) -- there is no stored way to say "steals
//    second" vs. "steals third" vs. "steals home" from the row alone.
//    /api/live/[token] can't compute it either (it has no historical
//    runners snapshot, only the current one) -- so narrateStolenBase
//    below always returns the generic variant; the live-view CLIENT
//    upgrades the displayed text to name the base, by comparing the
//    runner's base across two successive polls (the one place that
//    before/after comparison is actually possible), per the request's
//    own "by comparing the runner positions before and after."
// 2. `at_bats` has no column for an opposing batter's identity on a
//    mode='pitching' row (see CLAUDE.md's "Opposing batter identity"
//    note -- it's display-only, held in game_state.opponent_batter_name,
//    and never persisted). A historical opponent at-bat is narrated as
//    a bare "Opponent," never a fabricated jersey number, for the same
//    reason: the real fix is a write-path change this feature can't make.

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

const SINGLE = (b: string, loc: string) => [
  `${b} singles${loc}!`,
  `${b} drops one in${loc} for a base hit.`,
  `${b} slaps a single${loc}.`,
  `${b} finds a gap${loc}!`,
];
const DOUBLE = (b: string, loc: string) => [
  `${b} doubles${loc}!`,
  `${b} rips one into the gap${loc} -- standing on second!`,
  `${b} drives it${loc} for two bags!`,
  `Into the corner${loc} -- ${b} with a double!`,
];
const TRIPLE = (b: string, loc: string) => [
  `${b} TRIPLES${loc}! Off the wall and he's standing on third!`,
  `${b} legs out a triple${loc}!`,
  `Into the gap${loc} -- ${b} is flying, and he's in with a triple!`,
];
const HR = (b: string, loc: string) => [
  `${b} GOES DEEP${loc}! Home run!!`,
  `${b} crushes one${loc} -- that ball is GONE!`,
  `HOME RUN, ${b}! See ya later!`,
  `${b} goes YARD${loc}! Unbelievable!`,
];
const GROUND_RULE_DOUBLE = (b: string) => [
  `${b} doubles on a ground-rule bounce.`,
  `Bounces over the wall -- ${b} to second on the ground-rule double.`,
];
const WALK = (b: string) => [`${b} draws a walk.`, `${b} works a walk.`, `Ball four -- ${b} takes his base.`];
const INTENTIONAL_WALK = (b: string) => [`${b} is walked intentionally.`, `They put ${b} on -- intentional walk.`];
const HBP = (b: string) => [`${b} is hit by the pitch.`, `${b} wears one -- takes first base.`];
const STRIKEOUT = (b: string) => [
  `${b} strikes out!`,
  `Swing and a miss -- ${b} is punched out!`,
  `${b} goes down on strikes!`,
  `Strike three! ${b} is out of there.`,
];
const DROPPED_THIRD = (b: string) => [
  `${b} reaches on a dropped third strike!`,
  `The catcher can't handle it -- ${b} is safe at first!`,
];
const GROUNDOUT = (b: string) => [`${b} grounds out.`, `${b} rolls one over -- routine out.`, `${b} grounds out to the infield.`];
const FLYOUT = (b: string, loc: string) => [`${b} flies out${loc}.`, `${b} lifts one${loc} -- caught for the out.`, `Routine fly${loc} -- ${b} is out.`];
const LINEOUT = (b: string, loc: string) => [`${b} lines out${loc}!`, `Hard shot${loc} -- right at the fielder. ${b} is out.`];
const FC = (b: string) => [`${b} reaches on a fielder's choice.`, `${b} is safe at first on a fielder's choice.`];
const ERROR = (b: string) => [`${b} reaches on an error.`, `Booted it -- ${b} reaches on the error.`];

export function narrateAtBatResult(opts: { id: string; batterName: string; result: AtBatResult | null; fieldX: number | null }): string | null {
  const { id, batterName: b, result, fieldX } = opts;
  if (!result) return null;
  const loc = locationPhrase(fieldX);

  switch (result) {
    case "single":
      return pick(id, SINGLE(b, loc));
    case "double":
      return pick(id, DOUBLE(b, loc));
    case "triple":
      return pick(id, TRIPLE(b, loc));
    case "hr":
      return pick(id, HR(b, loc));
    case "ground_rule_double":
      return pick(id, GROUND_RULE_DOUBLE(b));
    case "walk":
      return pick(id, WALK(b));
    case "intentional_walk":
      return pick(id, INTENTIONAL_WALK(b));
    case "hbp":
      return pick(id, HBP(b));
    case "strikeout":
      return pick(id, STRIKEOUT(b));
    case "dropped_third_strike_safe":
      return pick(id, DROPPED_THIRD(b));
    case "groundout":
      return pick(id, GROUNDOUT(b));
    case "flyout":
      return pick(id, FLYOUT(b, loc));
    case "lineout":
      return pick(id, LINEOUT(b, loc));
    case "fc":
      return pick(id, FC(b));
    case "error":
      return pick(id, ERROR(b));
    case "double_play":
      // Narrated once per PLAY (not once per row) by narrateDoublePlay
      // below -- a double/triple play is 2-3 at_bats rows sharing this
      // same result value (see CLAUDE.md's "two rows, not one" note), so
      // the API route groups them before ever reaching here; this case
      // only exists so the switch stays exhaustive over AtBatResult.
      return null;
    default:
      return `${b}: ${result}.`;
  }
}

// Double play / triple play, called ONCE per play (the API route groups
// every at_bats row that shares the same real-world play, since a
// double play is 2 rows and a triple play is 3 -- see its own comment).
// Deliberately doesn't try to name the batter: the extra-out row(s) in
// that group belong to the RUNNER put out, not the batter, and the API
// has no reliable way to tell which row is which without a new column
// (out of scope here -- "nothing else new"). mode flips the energy:
// our batter grounding into one is a tough break, the opponent grounding
// into one against our defense is something to celebrate.
const DOUBLE_PLAY_HITTING = ["Double play. Tough break for the Lions.", "They turn two -- Lions grounded into a double play.", "Double play turned. Two away just like that."];
const DOUBLE_PLAY_PITCHING = ["DOUBLE PLAY! Our defense turns two!", "Two for the price of one! Lions turn the double play!", "They go around the horn -- DOUBLE PLAY, Lions!"];
const TRIPLE_PLAY_HITTING = ["Triple play! You don't see that every day -- tough inning for the Lions.", "TRIPLE PLAY turned against the Lions. Brutal."];
const TRIPLE_PLAY_PITCHING = ["TRIPLE PLAY!! Our defense just turned THREE outs on one play!", "Unbelievable -- TRIPLE PLAY, Lions! Don't see that every day!"];

export function narrateDoublePlay(opts: { id: string; mode: "hitting" | "pitching"; isTriplePlay: boolean }): string {
  const { id, mode, isTriplePlay } = opts;
  const options = isTriplePlay
    ? mode === "hitting"
      ? TRIPLE_PLAY_HITTING
      : TRIPLE_PLAY_PITCHING
    : mode === "hitting"
      ? DOUBLE_PLAY_HITTING
      : DOUBLE_PLAY_PITCHING;
  return pick(id, options);
}

// See gap #1 above -- always the generic variant from here; the client
// upgrades it to name a base when it can.
const STOLEN_BASE_GENERIC = (r: string) => [`${r} steals a base!`, `${r} takes off and steals a bag!`, `${r} swipes a base!`];
// Base-aware upgrades, used by the client (live-view.tsx) once it's
// diffed the runner's position across two polls -- kept here, not
// duplicated client-side, so the base/home wording stays one source of
// truth even though WHICH one applies is decided elsewhere.
const STOLEN_BASE_SECOND = (r: string) => [`${r} steals second!`, `${r} is off and in with a steal of second!`];
const STOLEN_BASE_THIRD = (r: string) => [`${r} steals third!`, `${r} swipes third base!`];
const STOLEN_BASE_HOME = (r: string) => [`${r} steals HOME! Incredible!`, `${r} is in standing -- steals home!`];

export function narrateStolenBase(id: string, runnerName: string): string {
  return pick(id, STOLEN_BASE_GENERIC(runnerName));
}

export function narrateStolenBaseForBase(id: string, runnerName: string, base: "second" | "third" | "home"): string {
  const options = base === "second" ? STOLEN_BASE_SECOND(runnerName) : base === "third" ? STOLEN_BASE_THIRD(runnerName) : STOLEN_BASE_HOME(runnerName);
  return pick(id, options);
}

const SUBSTITUTION = (inName: string, outName: string) => [`${inName} comes in for ${outName}.`, `Substitution: ${inName} replaces ${outName}.`];

export function narrateSubstitution(id: string, inName: string, outName: string): string {
  return pick(id, SUBSTITUTION(inName, outName));
}

// Plain exciting fallback -- used whenever the run's own mode/score
// context isn't known reliably (see the route's own comment on why that
// context is only ever computed for the single most recent scoring
// play, not replayed through the whole game).
const RUN_GENERIC = ["Run scores!", "He's in -- run scores!", "And that run comes across!"];

export function narrateRun(id: string): string {
  return pick(id, RUN_GENERIC);
}

// Score-aware line for the single most recent scoring play in the feed
// (see the route's own comment for why only the newest one gets this
// treatment) -- marginBefore/marginAfter are always "our score minus
// opponent score," from the scoring side's own perspective doesn't
// matter here since the sign already encodes who's ahead.
export function narrateRunWithContext(id: string, marginBefore: number, marginAfter: number): string {
  if (marginBefore < 0 && marginAfter === 0) return pick(id, ["Tied up!", "Game is tied!", "They answer back -- all even!"]);
  if (marginBefore > 0 && marginAfter === 0) return pick(id, ["Tied up!", "All square now!", "Knotted up!"]);
  if (marginBefore <= 0 && marginAfter > 0) return pick(id, ["Lions take the lead!", "Lions go in front!", "The Lions have taken the lead!"]);
  if (marginBefore >= 0 && marginAfter < 0) return pick(id, ["Opponent takes the lead.", "They've gone back in front."]);
  if (marginAfter > 0) return pick(id, ["Lions add another!", "Insurance run for the Lions!", "Lions extend the lead!"]);
  return pick(id, ["Opponent adds one.", "Opponent tacks on another."]);
}

const PICKOFF_OUT = (s: string | null) => (s ? [`${s} picked off!`, `Caught leaning -- ${s} is picked off!`] : ["Runner picked off!"]);
const TAG_UP = (s: string | null) => (s ? [`${s} called out on appeal!`, `Left too early -- ${s} is out on appeal!`] : ["Runner called out on appeal!"]);
const CAUGHT_STEALING = (s: string | null) => (s ? [`${s} caught stealing!`, `Gunned down -- ${s} is caught stealing!`] : ["Runner caught stealing!"]);
const RUNDOWN = (s: string | null) => (s ? [`${s} out in a rundown!`, `Caught in a pickle -- ${s} is out!`] : ["Runner out in a rundown!"]);
const OUT_ADVANCING = (s: string | null) => (s ? [`${s} out advancing!`, `${s} is thrown out trying to take the extra base!`] : ["Runner out advancing!"]);

export function narrateGameEvent(id: string, eventType: GameEventType, subjectName: string | null): string | null {
  switch (eventType) {
    case "wild_pitch":
      return pick(id, ["Wild pitch!", "That one gets away -- wild pitch!"]);
    case "passed_ball":
      return pick(id, ["Passed ball!", "Ball gets by the catcher -- passed ball!"]);
    case "balk":
      return pick(id, ["Balk! Runners move up.", "The pitcher balks -- everybody moves up a base."]);
    case "error":
      return pick(id, ["Error on the play!", "Miscue in the field -- error!"]);
    case "pickoff_out":
      return pick(id, PICKOFF_OUT(subjectName));
    case "pickoff_attempt":
      return pick(id, ["Pickoff attempt -- safe.", "They go over to check the runner -- safe."]);
    case "tag_up_violation":
      return pick(id, TAG_UP(subjectName));
    case "caught_stealing":
      return pick(id, CAUGHT_STEALING(subjectName));
    case "rundown_out":
      return pick(id, RUNDOWN(subjectName));
    case "runner_passed":
      return pick(id, subjectName ? [`${subjectName} out for passing another runner!`] : ["Runner out for passing another runner!"]);
    case "out_at_next_base":
      return pick(id, OUT_ADVANCING(subjectName));
    case "squeeze_play":
      return pick(id, ["Squeeze play! They bring the run home!", "Suicide squeeze -- he's in!"]);
    case "dropped_third_strike":
      return pick(id, ["Dropped third strike!"]);
    case "substitution":
      // Not narrated from here -- the substitutions table has the real
      // player_out_id/player_in_id directly, so the API route builds
      // this line from narrateSubstitution() instead of guessing what
      // this event_type's own player_id/opponent_player_id mean.
      return null;
    case "runner_scored":
      return null; // the separate "Run scores!" line (narrateRun) already covers this
    case "late_arrival":
      return null; // roster logistics, not a play -- not narrated
    default:
      return null;
  }
}
