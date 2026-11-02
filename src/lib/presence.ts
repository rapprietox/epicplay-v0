// Team activity batch: shared between the tracker (every signed-in page,
// src/components/presence-tracker.tsx) and the coach-only display
// (src/app/coach/team-activity-client.tsx) -- same topic convention and
// payload shape on both ends, or the two would silently stop matching
// each other's channel/state shape.
export function presenceTopic(teamId: string): string {
  return `team-presence:${teamId}`;
}

export interface PresenceEntry {
  // Index signature required by RealtimeChannel#presenceState<T>()'s own
  // generic constraint (T extends { [key: string]: any }) -- the named
  // fields below are the ones this app actually reads/writes.
  [key: string]: unknown;
  userId: string;
  role: string;
  playerName: string | null;
  page: string;
}

// Deliberately NOT persisted anywhere -- this is the Presence payload
// tracked on the channel itself, which Realtime holds in memory only for
// as long as the socket is connected. last_seen_at (the one thing that
// IS persisted) is a completely separate, much coarser signal -- see
// src/components/presence-tracker.tsx.
export const LAST_SEEN_UPDATE_INTERVAL_MS = 5 * 60 * 1000;
