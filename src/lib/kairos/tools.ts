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
        rank_direction: {
          type: "string",
          enum: ["best", "worst"],
          description: "For team-wide leaderboard questions (no player_name/opponent_name given): 'best' (default) for top performers by OPS, 'worst' for bottom performers, e.g. 'who is struggling?' Players with 0 AB are never included in either ranking.",
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
  {
    // KAIROS fixes batch, Fix 3. Deliberately separate from
    // propose_schedule_import (which always creates a NEW season
    // alongside a batch of games, e.g. from a pasted full schedule) --
    // a single ad-hoc game ("start a friendly," "create a new game")
    // needs a real game_type and no season at all, which is a different
    // shape and a different write path than a season import. This tool
    // writes directly (see the system prompt's own note on why it skips
    // the propose/confirm pattern the bulk import tools use).
    name: "create_single_game",
    description:
      "Create one game directly once you have all the required details from the conversation: opponent, date, time (or 'TBD'), home/away, and game type. Never call this with a guessed game_type -- ask the user first if it's unclear.",
    input_schema: {
      type: "object",
      properties: {
        opponent_name: { type: "string" },
        date: { type: "string", description: "ISO 8601, YYYY-MM-DD." },
        time: { type: "string", description: "Game time, or 'TBD' if not given." },
        home_away: { type: "string", enum: ["home", "away"] },
        game_type: { type: "string", enum: ["friendly", "season", "playoff", "tournament", "championship"] },
      },
      required: ["opponent_name", "date", "time", "home_away", "game_type"],
    },
  },
  {
    // KAIROS fixes batch, Fix 2 (second fixes batch). Writes directly
    // (games.logging_mode, same as create_single_game's reasoning for
    // skipping the propose/confirm pattern) -- switching modes mid-game
    // is a small, single-field, easily-reversed change, and the operator
    // console has to be told to refresh anyway (it reads logging_mode
    // once on load, not live), so there's no real "undo" cost to getting
    // it wrong that a confirm step would meaningfully protect against.
    name: "switch_game_mode",
    description:
      "Switch a game's logging mode between 'full' (pitch-by-pitch, strike zone, heat maps) and 'quick' (result-only scorekeeper, no pitch detail). Use this when the user says things like 'switch to full logging', 'I want to track pitches now', or 'switch this game to quick mode'. Use the active game from your own context unless the user names a different one.",
    input_schema: {
      type: "object",
      properties: {
        game_id: { type: "string", description: "The game's id -- use the active game's id from your own context unless told otherwise." },
        new_mode: { type: "string", enum: ["full", "quick"] },
      },
      required: ["game_id", "new_mode"],
    },
  },
];
