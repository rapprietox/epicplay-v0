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
    // KAIROS zone-query batch: fixes the gap behind "I don't have pitch-
    // location data" for a player whose games genuinely do have it --
    // query_team_stats above never looked at pitches/zone_x/zone_y at
    // all, only at-bat-level batting/pitching lines. This is the only
    // KAIROS_TOOLS entry that reads the pitches table.
    name: "get_zone_breakdown",
    description:
      "Look up a real, data-backed breakdown of pitch locations in the 9-cell strike zone grid for one of our own players (or the whole team) -- per zone: pitches seen, swings, whiffs, batting average, and a split by pitch type (fastball/curveball/changeup/slider/2seam/other), plus the 3 weakest and 3 strongest zones with their sample size and a confidence label. Use this for ANY question about where a player (or the team) is strong or weak by pitch location, hits well/poorly in a specific zone, or struggles against a specific pitch type by location -- always call this before answering a zone/location question, never guess or invent a hot/cold zone. Works for a batter (pitches he saw) or a pitcher (pitches he threw, i.e. what opposing batters did against him) -- set role accordingly. Only reflects games logged in Full Mode (pitch-by-pitch); a player with only Quick Mode games will come back with zero pitches, which is a real, correct answer -- say so plainly rather than treating it as missing data.",
    input_schema: {
      type: "object",
      properties: {
        player_name: {
          type: "string",
          description: "A specific player's name. Omit for a team-wide zone breakdown across every batter (or pitcher, per role) on the roster.",
        },
        role: {
          type: "string",
          enum: ["batter", "pitcher"],
          description: "'batter' (default): pitches this player/team saw at the plate. 'pitcher': pitches this player/team threw -- use this for a question about what a pitcher gives up.",
        },
      },
    },
  },
  {
    // Spray-tool batch: the companion gap to get_zone_breakdown -- pull vs.
    // opposite-field is a batted-ball LANDING SPOT question (field_x/
    // field_y), not a pitch-location question (zone_x/zone_y); neither
    // existing tool could ever answer it.
    name: "get_spray_tendencies",
    description:
      "Look up real pull / middle / opposite-field tendencies for one of our own hitters (or the whole team), from where their batted balls actually landed -- the same field_x/field_y data the spray chart itself plots, read with the same geometry, so this can never disagree with what a coach sees on that chart. Returns, per hitter: balls in play with a saved landing spot, the share pulled/up-the-middle/opposite-field (using their batting hand -- a right-handed batter pulls to the LEFT side of the field, a lefty pulls RIGHT), the sample size, and a confidence label. A switch hitter or a player with no recorded batting hand comes back with raw field thirds and no pull/opposite label at all -- report that honestly rather than guessing a side. Use this for ANY pull/opposite-field/spray question. Only covers games with a saved landing spot (both Quick and Full Mode capture this on a ball in play) -- if a hitter has none yet, say so plainly rather than treating it as missing data.",
    input_schema: {
      type: "object",
      properties: {
        player_name: {
          type: "string",
          description: "A specific player's name. Omit for a team-wide breakdown across every hitter with at least one saved landing spot.",
        },
      },
    },
  },
  {
    // Team-comparison batch: the system prompt below points every "who's
    // best/worst at X" question here instead of letting the model call
    // get_zone_breakdown once per player it wants to compare -- that
    // per-player-call pattern is what ran a single 3-hitter fastball
    // comparison up to ~22,000 tokens before this tool existed. One call,
    // one pass over the team's at-bats/pitches, every hitter's line at once.
    name: "get_team_zone_summary",
    description:
      "Get a compact, one-call comparison table across the WHOLE roster: every hitter's fastballs seen, fastball whiff rate, and their single overall weakest and strongest strike-zone cell (each with its sample size). Use this for any 'who is best/worst at X' or multi-player comparison question -- NEVER call get_zone_breakdown once per player to build the same comparison yourself, that is much more expensive for the same answer. Only call get_zone_breakdown afterward if the coach then asks to drill into one specific player's full zone grid.",
    input_schema: { type: "object", properties: {} },
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
