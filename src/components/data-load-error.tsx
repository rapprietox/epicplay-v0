"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Data-reliability batch: the one UI this app shows when a chunked fetch
// (src/lib/supabase/safe-fetch.ts) throws, instead of the normal "not
// enough data yet" empty state a page already shows for a real, successful
// zero-rows result. The two must stay visually distinct -- an empty state
// is a true fact about the data, this is a statement that the data
// couldn't even be checked. router.refresh() re-runs the server
// component's own data fetching in place, the simplest "retry" available
// without a dedicated API route for each of the four pages this appears on.
export function DataLoadError({ label = "Couldn't load this data. Try again." }: { label?: string }) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);

  function retry() {
    setRetrying(true);
    router.refresh();
    // refresh() doesn't resolve when the server round-trip finishes, so
    // this just gives the button a brief, honest "doing something" state
    // rather than claiming to know when the retry actually lands.
    setTimeout(() => setRetrying(false), 1500);
  }

  return (
    <div className="glossy rounded-lg border border-accent-red/40 bg-accent-red/10 p-5 text-center">
      <p className="text-sm text-accent-red">{label}</p>
      <button
        type="button"
        onClick={retry}
        disabled={retrying}
        className="mt-3 rounded-full border border-accent-red/60 px-4 py-1.5 text-xs font-semibold text-accent-red transition hover:bg-accent-red/10 disabled:opacity-50"
      >
        {retrying ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}
