// Time-of-day/day-of-week filters batch.

export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";
export type DayType = "weekday" | "weekend";

export const TIME_OF_DAY_LABELS: Record<TimeOfDay, string> = {
  morning: "Morning (before 12pm)",
  afternoon: "Afternoon (12-5pm)",
  evening: "Evening (5-8pm)",
  night: "Night (after 8pm)",
};

export const DAY_TYPE_LABELS: Record<DayType, string> = {
  weekday: "Weekday",
  weekend: "Weekend",
};

// games.game_time is free text -- "TBD", the "H:MM AM/PM" shape
// src/lib/time-options.ts's dropdown produces, or (checked against the
// live data before writing this) "H:MM a.m./p.m." from the AI PDF
// extraction path, and occasionally bare "H:MM" with no AM/PM marker at
// all. The regex tolerates optional periods and either case on the
// am/pm marker; a bare "H:MM" with no marker is genuinely ambiguous
// (could be either), so it's left unparsed rather than guessed --
// same treatment as "TBD."
export function parseGameTimeText(text: string | null): number | null {
  if (!text) return null;
  const match = text.trim().match(/^(\d{1,2}):(\d{2})\s*([ap])\.?m\.?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const isPM = match[3].toLowerCase() === "p";
  if (isPM && hour !== 12) hour += 12;
  if (!isPM && hour === 12) hour = 0;
  return hour * 60 + minute;
}

// start_time (a real `time` column -- "HH:MM:SS") wins when set, since
// it's the more authoritative structured value; game_time's free text
// is the fallback. No game-creation/edit form writes start_time today
// (out of scope for this batch -- see the migration's comment), so this
// fallback is what keeps the filter working for every game created after
// this batch ships, not just the ones a one-time backfill could reach.
export function resolveStartMinutes(game: { start_time: string | null; game_time: string | null }): number | null {
  if (game.start_time) {
    const [h, m] = game.start_time.split(":").map(Number);
    if (Number.isFinite(h) && Number.isFinite(m)) return h * 60 + m;
  }
  return parseGameTimeText(game.game_time);
}

export function timeOfDayBucket(minutes: number | null): TimeOfDay | null {
  if (minutes === null) return null;
  const hour = minutes / 60;
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 20) return "evening";
  return "night";
}

// gameDate is "YYYY-MM-DD" -- constructed at local midnight (matching
// lib/dates.ts's own formatGameDate/daysUntil) rather than parsed as a
// bare date string, which JS reads as UTC midnight and can land on the
// wrong local day-of-week right at either end of a day.
export function dayTypeBucket(gameDate: string): DayType {
  const day = new Date(`${gameDate}T00:00:00`).getDay();
  return day === 0 || day === 6 ? "weekend" : "weekday";
}
