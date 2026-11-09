import { GAME_NOT_ACTIVE_ERROR } from "./chain-substitution";

// A permanent rejection (the game is no longer active) will never
// succeed on a later retry, unlike a transient network failure -- so it
// must be told apart and dropped rather than retried forever. Matched
// on the exact message requireOperatorGame throws (actions.ts); Next.js
// Server Actions do propagate a thrown Error's message to the caller.
function isPermanentFailure(err: unknown): boolean {
  return err instanceof Error && err.message === GAME_NOT_ACTIVE_ERROR;
}

// Best-effort retry queue for server writes made while offline. Retries
// live in memory (closures can't survive JSON serialization), so they
// persist for the lifetime of this browser tab/session -- if the tab is
// closed or reloaded while a write is still queued offline, that specific
// queued write is lost. This is an inherent limit of a client-only queue
// without a service worker + IndexedDB job store (real cross-reload
// durability); out of scope for V0, but nothing here blocks adding it
// later. What *does* survive a reload: the operator's in-progress local
// state (see local-storage.ts), so the operator can see what they were
// mid-logging and re-trigger the save by hand.
interface QueueEntry {
  id: string;
  description: string;
  run: () => Promise<void>;
  attempts: number;
}

const queue: QueueEntry[] = [];
const listeners = new Set<(pending: number) => void>();
let flushing = false;
let flushTimer: ReturnType<typeof setInterval> | null = null;

function notify() {
  for (const l of Array.from(listeners)) l(queue.length);
}

export function onQueueChange(fn: (pending: number) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function pendingCount(): number {
  return queue.length;
}

export function enqueue(description: string, run: () => Promise<void>) {
  queue.push({ id: `${Date.now()}-${Math.random()}`, description, run, attempts: 0 });
  notify();
  ensureFlushTimer();
}

async function flush() {
  if (flushing || queue.length === 0) return;
  flushing = true;
  try {
    while (queue.length > 0) {
      const entry = queue[0];
      try {
        await entry.run();
        queue.shift();
        notify();
      } catch (err) {
        if (isPermanentFailure(err)) {
          // This game will never become active again for this action --
          // retrying forever would just burn cycles, and could still
          // race a manual data fix the way a live retry once did (see
          // CLAUDE.md's stale-writes note). Drop it and keep draining
          // the rest of the queue; this one entry's failure doesn't mean
          // the whole queue is blocked the way an offline error does.
          queue.shift();
          notify();
          continue;
        }
        entry.attempts += 1;
        break; // stop and retry the whole queue later, in order
      }
    }
  } finally {
    flushing = false;
  }
}

function ensureFlushTimer() {
  if (flushTimer || typeof window === "undefined") return;
  flushTimer = setInterval(() => {
    void flush();
  }, 5000);
  window.addEventListener("online", () => void flush());
}

// Runs fn() immediately; if it throws (most commonly a network error while
// offline), queues it for retry instead of surfacing the error to the
// caller. Callers that need to know about non-network failures (bad
// input, auth) should validate before calling this.
export async function withOfflineRetry(description: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    if (isPermanentFailure(err)) return; // this game will never become active again for this action -- retrying is pointless
    enqueue(description, fn);
  }
}
