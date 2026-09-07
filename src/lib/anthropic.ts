import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const client = new Anthropic();

const ScheduleGameSchema = z.object({
  date: z.string().describe("ISO 8601 date, YYYY-MM-DD"),
  time: z.string().nullable().describe("Game time as printed on the schedule, or null if not shown"),
  opponent_name: z.string(),
  home_away: z.enum(["home", "away"]),
  game_type: z.enum(["friendly", "preseason", "season", "playoff", "tournament", "championship"]),
});
const ScheduleSchema = z.object({ games: z.array(ScheduleGameSchema) });
export type ExtractedGame = z.infer<typeof ScheduleGameSchema>;

export async function extractSeasonSchedule(pdfBase64: string): Promise<ExtractedGame[]> {
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
              "This is a baseball season schedule. Extract every game listed: " +
              "date (ISO 8601 YYYY-MM-DD), time (as printed, or null if not shown), " +
              "opponent_name, home_away ('home' or 'away'), and game_type " +
              "('season' as default unless clearly marked otherwise, e.g. scrimmage/" +
              "friendly, preseason, playoff, tournament, or championship).",
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
          `If the data is too thin for a real pattern, say so briefly instead of ` +
          `overreaching.\n\n${JSON.stringify(input, null, 2)}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") return "";
  const text = response.content.find((block) => block.type === "text");
  return text && text.type === "text" ? text.text.trim() : "";
}
