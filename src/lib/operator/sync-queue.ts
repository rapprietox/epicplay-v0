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
      } catch {
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
  } catch {
    enqueue(description, fn);
  }
}
