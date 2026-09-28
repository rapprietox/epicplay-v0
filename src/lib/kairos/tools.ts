import type Anthropic from "@anthropic-ai/sdk";

// KAIROS batch: classic Anthropic tool-use schemas (not the zod-based
// messages.parse() helper lib/anthropic.ts already uses for one-shot PDF/
// photo extraction) -- KAIROS needs a real multi-turn loop where the
// model itself decides which tool applies (or none, for a general
// baseball question), which the structured-output helper doesn't do.
//
// query_team_stats and suggest_lineup are read-only: the server executes
// a real query and feeds the result back to the model for a second turn
// that turns it into natural language. propose_roster_import/
// propose_schedule_import never write to the database themselves --
// Claude's own extracted arguments ARE the parsed data; the server
// returns them straight to the client as a pending confirmation (see
// askKairos in actions.ts), and a separate explicit confirm action does
// the actual insert. This is what "always confirm before executing"
// means in practice here -- the write path never goes through the model
// loop at all.
export const KAIROS_TOOLS: Anthropic.Tool[] = [
  {
    name: "query_team_stats",
    description:
      "Look up real stats for our own team from the database -- a player's batting/pitching line, splits, team leaders, or our history and best/worst performers against a specific opponent (pre-game intelligence). Use this for ANY question about player or team performance. Do not guess or make up numbers -- always call this first.",
    input_schema: {
      type: "object",
      properties: {
        player_name: {
          type: "string",
          description: "A specific player's name, if the question is about one player. Omit for team-wide/leaderboard questions.",
        },
        opponent_name: {
          type: "string",
          description: "A specific opponent team name, if the question is about our history/performance against them (pre-game intelligence).",
        },
        pitcher_hand_filter: {
          type: "string",
          enum: ["left", "right"],
          description: "Set this only if the question specifically asks about performance against left- or right-handed pitching.",
        },
      },
    },
  },
  {
    name: "propose_roster_import",
    description:
      "Call this the moment the user's message contains pasted roster text -- player names, possibly with jersey numbers and/or positions, in ANY format (a WhatsApp message, an email, a plain list, anything messy). Extract every player you can identify. Never write to the database yourself; this only proposes the list for the user to confirm.",
    input_schema: {
      type: "object",
      properties: {
        players: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              jersey_number: { type: "string", description: "As text, omit the field entirely if not found in the source text." },
              position: {
                type: "string",
                description: "Standard abbreviation (P, C, 1B, 2B, 3B, SS, LF, CF, RF) if found, otherwise omit the field.",
              },
            },
            required: ["name"],
          },
        },
      },
      required: ["players"],
    },
  },
  {
    name: "propose_schedule_import",
    description:
      "Call this the moment the user's message contains a pasted game schedule in any text format. Extract every game -- date, time, opponent, and whether it's home or away.",
    input_schema: {
      type: "object",
      properties: {
        season_name: { type: "string", description: "A reasonable season name, e.g. '2026 Season' -- infer from context if not stated." },
        season_year: { type: "number" },
        games: {
          type: "array",
          items: {
            type: "object",
            properties: {
              date: { type: "string", description: "ISO 8601, YYYY-MM-DD." },
              time: { type: "string", description: "Game time as printed, or 'TBD' if not shown." },
              opponent_name: { type: "string" },
              home_away: { type: "string", enum: ["home", "away"] },
            },
            required: ["date", "opponent_name", "home_away"],
          },
        },
      },
      required: ["season_name", "season_year", "games"],
    },
  },
  {
    name: "suggest_lineup",
    description: "Generate a suggested batting order for tonight's game, optionally against a specific opposing pitcher handedness.",
    input_schema: {
      type: "object",
      properties: {
        pitcher_hand_filter: {
          type: "string",
          enum: ["left", "right"],
          description: "The opposing pitcher's throwing hand, if the coach specified it.",
        },
      },
    },
  },
];
