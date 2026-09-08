import type { OperatorState } from "./types";

function key(gameId: string): string {
  return `epicplay:operator:${gameId}`;
}

export function saveOperatorStateLocal(state: OperatorState) {
  try {
    localStorage.setItem(key(state.gameId), JSON.stringify(state));
  } catch {
    // Storage full or unavailable -- Supabase remains the durable copy.
  }
}

export function loadOperatorStateLocal(gameId: string): OperatorState | null {
  try {
    const raw = localStorage.getItem(key(gameId));
    return raw ? (JSON.parse(raw) as OperatorState) : null;
  } catch {
    return null;
  }
}

export function clearOperatorStateLocal(gameId: string) {
  try {
    localStorage.removeItem(key(gameId));
  } catch {
    // Nothing to clean up if storage isn't available.
  }
}

interface PendingWrite {
  id: string;
  description: string;
  run: () => Promise<void>;
}

const queueKey = (gameId: string) => `epicplay:operator:${gameId}:offline-note`;

// The real offline queue lives in memory (functions can't survive
// JSON serialization) -- this just persists a human-readable count/notice
// so a reload shows "N actions pending sync" instead of silently losing
// the fact that something didn't make it to the server yet.
export function markOfflinePending(gameId: string, count: number) {
  try {
    if (count > 0) localStorage.setItem(queueKey(gameId), String(count));
    else localStorage.removeItem(queueKey(gameId));
  } catch {
    // Best-effort only.
  }
}

export function readOfflinePendingCount(gameId: string): number {
  try {
    return Number(localStorage.getItem(queueKey(gameId)) ?? 0);
  } catch {
    return 0;
  }
}

export type { PendingWrite };
