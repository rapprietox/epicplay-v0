"use client";

export function PitchCountModal({ count, onAcknowledge }: { count: number; onAcknowledge: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4">
      <div className="glossy w-full max-w-md rounded-lg border-2 border-accent-red bg-surface p-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-accent-red">Pitch Count Alert</p>
        <p className="font-heading mt-3 text-5xl font-bold text-white">{count}</p>
        <p className="mt-2 text-sm text-foreground/70">
          This pitcher has thrown {count} pitches. Confirm you want to keep logging before continuing.
        </p>
        <button
          type="button"
          onClick={onAcknowledge}
          className="mt-5 w-full rounded-md bg-accent-red px-4 py-3 text-sm font-semibold text-white transition hover:bg-accent-red/90"
        >
          Acknowledge and continue
        </button>
      </div>
    </div>
  );
}
