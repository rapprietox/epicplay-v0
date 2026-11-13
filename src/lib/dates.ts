export function daysUntil(isoDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${isoDate}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function formatGameDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// Team Pass / Pro expiry batch: formats a full timestamptz (not a plain
// date like formatGameDate above), for clubhouse_unlocked_until and
// team_passes.ends_at -- "Dec 31, 2026", no weekday or time-of-day,
// since neither is meaningful for an expiry date.
export function formatTimestampDate(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
