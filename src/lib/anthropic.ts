import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const client = new Anthropic();

const ScheduleGameSchema = z.object({
  date: z.string().describe("ISO 8601 date, YYYY-MM-DD"),
  time: z.string().describe("Game time as printed on the schedule, or 'TBD' if not shown"),
  opponent_name: z.string().describe("The other team in the game -- never our own team name"),
  home_away: z.enum(["home", "away"]),
  game_type: z.enum(["friendly", "preseason", "season", "playoff", "tournament", "championship"]),
});
const ScheduleSchema = z.object({ games: z.array(ScheduleGameSchema) });
export type ExtractedGame = z.infer<typeof ScheduleGameSchema>;

export async function extractSeasonSchedule(pdfBase64: string, teamName: string): Promise<ExtractedGame[]> {
  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 16000,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: pdfBase64 },
          },
          {
            type: "text",
            text:
              `This is a baseball season schedule. Our team name is ${teamName}. ` +
              "Extract only games involving our team. For each game set home_away to " +
              "'home' if our team is the home team, 'away' if we are the away team. " +
              "The opponent is always the other team in the game, not ours. Skip any " +
              "game that is between two other teams and doesn't involve us. For each " +
              "game we're in, also extract: date (ISO 8601 YYYY-MM-DD), time (as " +
              "printed on the schedule; if no time is shown for a game, use 'TBD'), " +
              "and game_type ('season' as default unless clearly marked otherwise, " +
              "e.g. scrimmage/friendly, preseason, playoff, tournament, or " +
              "championship).",
          },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(ScheduleSchema) },
  });

  return response.parsed_output?.games ?? [];
}

const OpponentPlayerSchema = z.object({
  name: z.string(),
  jersey_number: z.string().describe("Jersey number as visible, or '—' if not visible/legible"),
  position: z.string().nullable().describe("Fielding position if shown on the lineup card, else null"),
});
const RosterSchema = z.object({ players: z.array(OpponentPlayerSchema) });
export type ExtractedOpponentPlayer = z.infer<typeof OpponentPlayerSchema>;

export async function extractOpponentRoster(
  imageBase64: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp"
): Promise<ExtractedOpponentPlayer[]> {
  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 16000,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          {
            type: "text",
            text:
              "This is a photo of an opposing baseball team's lineup card or roster. " +
              "Extract every player listed: name, jersey_number (as visible, or '—' if " +
              "not visible or legible), and position (if shown, else null).",
          },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(RosterSchema) },
  });

  return response.parsed_output?.players ?? [];
}

export interface OpponentInsightInput {
  opponentName: string;
  pastGames: { date: string; result: "W" | "L" | "T"; ourScore: number; opponentScore: number }[];
  playerPerformances: { playerName: string; ab: number; h: number; avg: number }[];
  // Opponent pitcher intelligence batch: present only when the next
  // game's opponent has a pitcher we've actually faced before (a real
  // opponent_pitcher_id on a logged at-bat, not just a roster guess --
  // see next-game-panel.tsx).
  pitcherReport?: {
    pitcherName: string;
    jerseyNumber: string | null;
    teamAvgAgainst: number;
    bestBatter: { name: string; avg: number } | null;
    worstBatter: { name: string; avg: number } | null;
    toughestPitchType: { pitchType: string; avg: number } | null;
    topPitch: { pitchType: string; pct: number } | null;
  } | null;
}

// Recomputed on every dashboard render rather than cached -- acceptable
// for V0 internal-testing scale (a handful of games/players); revisit if
// this ever needs to serve real traffic.
export async function generateOpponentInsight(input: OpponentInsightInput): Promise<string> {
  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 300,
    messages: [
      {
        role: "user",
        content:
          `You are a baseball analyst preparing brief pre-game notes for a coach ` +
          `about to face ${input.opponentName} again. Using only the data below, ` +
          `write 2-3 short, concrete sentences (no headers, no bullet points) ` +
          `covering our record against them and any standout player performances. ` +
          `If pitcherReport is present, also weave in our history against that ` +
          `specific starting pitcher -- our team average against him, his toughest ` +
          `pitch type for us, and our best/worst matchup hitters -- within that same ` +
          `2-3 sentence budget, not as extra sentences tacked on. ` +
          `If the data is too thin for a real pattern, say so briefly instead of ` +
          `overreaching.\n\n${JSON.stringify(input, null, 2)}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") return "";
  const text = response.content.find((block) => block.type === "text");
  return text && text.type === "text" ? text.text.trim() : "";
}

// Clubhouse batch: a personalized game-day message shown to the player
// themselves (not a coach), so it speaks directly to them by first name
// -- same free-text messages.create pattern as generateOpponentInsight
// just above (closest existing analog: "record + recent performances +
// opponent" framing), not cached here -- caching is the caller's job
// (see getPregameMessage in src/app/player/clubhouse/insights.ts, same
// unstable_cache-keyed-on-input pattern the zone insights already use).
export interface PregameMessageInput {
  playerName: string;
  position: string;
  opponentName: string;
  lineupSpot: number | null;
  recentGames: { opponent: string; line: string }[];
  recentAvg: number | null;
}

export async function generatePregameMessage(input: PregameMessageInput): Promise<string> {
  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content:
          `You are a baseball coach sending a short, personal game-day hype text directly ` +
          `to ${input.playerName}, one of your players, a few hours before their game. Using ` +
          `only the data below, write 2-4 short sentences, speaking directly to them by first ` +
          `name in second person ("you"), covering: they're playing ${input.opponentName} ` +
          `today${input.lineupSpot ? `, batting ${input.lineupSpot}${input.lineupSpot === 1 ? "st" : input.lineupSpot === 2 ? "nd" : input.lineupSpot === 3 ? "rd" : "th"} at ${input.position}` : ` at ${input.position}`}; ` +
          `a callout of their recent form if recentGames/recentAvg shows a real pattern (hot ` +
          `or cold -- be honest either way, don't invent momentum that isn't there); and one ` +
          `concrete, confident closing line. No emoji, no headers, no bullet points -- just the ` +
          `message, like a text from a coach who believes in them.\n\n${JSON.stringify(input, null, 2)}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") return "";
  const text = response.content.find((block) => block.type === "text");
  return text && text.type === "text" ? text.text.trim() : "";
}

// Whiff-rate/pitch-location maps batch: "Key Insights" block below the
// three zone maps. Only the qualifying, most-extreme zones are sent
// (not all 25 cells x however many pitch-type breakdowns) -- keeps the
// prompt focused on what's actually actionable and matches the example
// output's own specificity ("Slider low-outside: 67% whiff rate on 9
// swings"). Caching (so this only regenerates when new games are added,
// per spec) is the caller's job -- see getPlayerZoneInsights in
// src/app/coach/players/[id]/insights.ts, which wraps this in
// unstable_cache keyed on this exact input, so identical input (nothing
// new logged since last render) always hits the cache and a changed
// input (a new game confirmed) always produces a fresh call.
const ZoneInsightSchema = z.object({
  insights: z
    .array(z.string())
    .length(3)
    .describe(
      "Exactly 3 short, specific, actionable one-line bullets for a coach, each starting with an emoji: (warning sign) for a weakness to exploit/work on, (check mark) for a strength to lean on, (pin) for a pitcher-tendency observation. Use the real numbers given -- never invent a number not present in the input."
    ),
});

export interface PlayerZoneInsightInput {
  playerName: string;
  battingZones: { zoneLabel: string; avg: number; ab: number }[];
  whiffZones: { zoneLabel: string; rate: number; swings: number; pitchType: string }[];
  locationZones: { zoneLabel: string; pct: number; count: number; pitchType: string }[];
}

export async function generatePlayerZoneInsights(input: PlayerZoneInsightInput): Promise<string[]> {
  if (input.battingZones.length === 0 && input.whiffZones.length === 0 && input.locationZones.length === 0) return [];
  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content:
          `You are a baseball analyst writing a short "Key Insights" summary for a coach ` +
          `about ${input.playerName}'s zone tendencies as a hitter, from three heat maps: ` +
          `battingZones (batting average by strike-zone location, min 3 AB to qualify), ` +
          `whiffZones (swing-and-miss rate by zone, min 3 swings to qualify, "pitchType" is ` +
          `"all" or a specific pitch), and locationZones (share of pitches thrown to each ` +
          `zone against this batter, "pitchType" is "all" or a specific pitch). Pick the 3 ` +
          `most actionable patterns across all three and write one line each, per the schema's ` +
          `own instructions. If a category has no qualifying data, skip it and lean on the ` +
          `others -- never fabricate a number.\n\n${JSON.stringify(input, null, 2)}`,
      },
    ],
    output_config: { format: zodOutputFormat(ZoneInsightSchema) },
  });

  return response.parsed_output?.insights ?? [];
}

// Pitcher-maps batch: same 3-bullet schema (ZoneInsightSchema), a
// separate function rather than a "perspective" flag on
// generatePlayerZoneInsights because the input shape's own field
// meanings flip (oppAvgZones is the OPPONENT's average against this
// player, not this player's own) and the example outputs call for a
// direct, second-person coaching voice ("this is your out pitch," "Mix
// your locations") rather than the batter version's third-person
// description -- different enough prompting that sharing one function
// would mean branching most of its body anyway.
export interface PitcherZoneInsightInput {
  playerName: string;
  oppAvgZones: { zoneLabel: string; avg: number; ab: number }[];
  whiffZones: { zoneLabel: string; rate: number; swings: number; pitchType: string }[];
  locationZones: { zoneLabel: string; pct: number; count: number; pitchType: string }[];
  // Damage Rate batch: share of pitches in each zone that produced
  // dangerous contact (line drive, or a fly ball that fell for a hit, or
  // any HR), min 3 pitches to qualify. Given alongside locationZones
  // specifically so the model can cross-reference the two by zoneLabel
  // and pitchType -- a zone that's both heavily targeted (locationZones)
  // and heavily damaged (damageZones) is the single most actionable
  // combination this data can surface (see the worked example below).
  damageZones: { zoneLabel: string; rate: number; pitches: number; pitchType: string }[];
}

export async function generatePitcherZoneInsights(input: PitcherZoneInsightInput): Promise<string[]> {
  if (input.oppAvgZones.length === 0 && input.whiffZones.length === 0 && input.locationZones.length === 0 && input.damageZones.length === 0) {
    return [];
  }
  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content:
          `You are a pitching coach writing a short "Key Insights" summary directly to ${input.playerName}, ` +
          `a pitcher, about their own zone tendencies, from four heat maps: oppAvgZones (opposing ` +
          `batters' average against this pitcher by zone, min 3 AB to qualify -- a high average is bad ` +
          `for the pitcher), whiffZones (this pitcher's own swing-and-miss rate induced by zone, min 3 ` +
          `swings to qualify, "pitchType" is "all" or a specific pitch -- a high rate is good for the ` +
          `pitcher, their out-pitch location), locationZones (share of this pitcher's own pitches ` +
          `landing in each zone, "pitchType" is "all" or a specific pitch -- a high share can mean the ` +
          `pitcher is predictable/telegraphing), and damageZones (share of pitches in each zone that ` +
          `resulted in dangerous contact -- a line drive, or a fly ball that fell for a hit, or any home ` +
          `run -- min 3 pitches to qualify, "pitchType" is "all" or a specific pitch -- a high rate is ` +
          `bad for the pitcher). Cross-reference locationZones and damageZones by matching zoneLabel and ` +
          `pitchType: a zone this pitcher throws to often (high pct in locationZones) that is ALSO a zone ` +
          `where contact is dangerous (high rate in damageZones) is the single most actionable combination ` +
          `available -- flag it explicitly when one exists, e.g. "You throw 34% of fastballs middle-in AND ` +
          `batters are line-driving them at 43% -- this is your most dangerous zone combination." Pick the ` +
          `3 most actionable patterns across all four maps (the location+damage combination, if one ` +
          `qualifies, plus up to 2 more from whichever of the remaining maps has the clearest signal) and ` +
          `write one line each, per the schema's own instructions, speaking directly to the pitcher in ` +
          `second person ("your," "you") with concrete coaching advice (throw it more, avoid this zone, ` +
          `mix your locations), not just a description of the number. If a category has no qualifying ` +
          `data, skip it and lean on the others -- never fabricate a number.\n\n${JSON.stringify(input, null, 2)}`,
      },
    ],
    output_config: { format: zodOutputFormat(ZoneInsightSchema) },
  });

  return response.parsed_output?.insights ?? [];
}

// KAIROS batch, Tool 6 (voice logging). A spoken command is one of two
// real shapes this app already has a place for: a single pitch (pitch
// type + outcome + swing/take + roughly where it crossed the zone -- the
// exact same fields a manual strike-zone tap already produces), or a
// finished at-bat result (with an optional single fielder, matching the
// simpler single-fielder plays this app already supports without a full
// scorebook chain). "kind: unclear" is a real, expected outcome for a
// command that doesn't parse as either -- the caller shows it back to
// the operator to retype/retap rather than guessing.
//
// zone_row/zone_col are coarse thirds (top/middle/bottom,
// left/middle/right), not exact coordinates -- a spoken "top right
// corner" was never going to be pixel-precise, so this maps onto the
// same 3x3 thirds the strike zone grid's own zoneIndexFromCoords already
// buckets taps into, at each third's center point, rather than pretending
// at false precision.
const VoicePitchSchema = z.object({
  kind: z.literal("pitch"),
  pitch_type: z.enum(["fastball", "curveball", "changeup", "slider", "2seam", "other"]).nullable(),
  outcome: z.enum(["strike", "ball", "foul", "foul_tip", "hbp", "inplay"]),
  swing: z.boolean().nullable().describe("true if swinging, false if looking/take. Only meaningful when outcome is 'strike' -- null otherwise (ball/hbp are always a take, foul/inplay are always a swing, so it's not ambiguous for those)."),
  zone_row: z.enum(["top", "middle", "bottom"]).nullable(),
  zone_col: z.enum(["left", "middle", "right"]).nullable(),
  summary: z.string().describe("Short confirmation text, e.g. 'Strike looking — fastball — top right'"),
});

const VoiceAtBatResultSchema = z.object({
  kind: z.literal("at_bat_result"),
  result: z.enum(["single", "double", "triple", "hr", "flyout", "groundout", "lineout", "strikeout", "walk", "hbp", "error", "fc"]),
  hit_type: z.enum(["groundball", "linedrive", "flyball", "bunt", "popup"]).nullable(),
  fielded_by_position: z.enum(["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"]).nullable(),
  summary: z.string().describe("Short confirmation text using standard scorebook shorthand, e.g. '6-3 ground out' or 'Single to left field'"),
});

const VoiceUnclearSchema = z.object({ kind: z.literal("unclear"), message: z.string().describe("Brief, friendly explanation of what wasn't clear") });

const VoiceCommandSchema = z.discriminatedUnion("kind", [VoicePitchSchema, VoiceAtBatResultSchema, VoiceUnclearSchema]);
export type VoiceCommand = z.infer<typeof VoiceCommandSchema>;

export async function parseVoiceCommand(transcript: string): Promise<VoiceCommand> {
  const response = await client.messages.parse({
    model: "claude-sonnet-5",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content:
          `You are KAIROS, transcribing a baseball operator's spoken play-by-play into a ` +
          `structured command. The operator just said: "${transcript}"\n\n` +
          `Decide whether this describes a single PITCH (has a pitch type and/or an ` +
          `outcome like strike/ball/foul, e.g. "fastball, strike looking, top right ` +
          `corner") or a finished AT-BAT RESULT (the play is over -- a hit, an out, a ` +
          `walk, etc., e.g. "ground ball to shortstop, out at first"). If it's ` +
          `genuinely neither or too ambiguous to log safely, use kind "unclear" and ` +
          `explain briefly why.`,
      },
    ],
    output_config: { format: zodOutputFormat(VoiceCommandSchema) },
  });

  return response.parsed_output ?? { kind: "unclear", message: "I couldn't parse that -- try again?" };
}
