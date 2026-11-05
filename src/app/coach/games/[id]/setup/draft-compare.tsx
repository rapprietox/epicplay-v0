"use client";

import { useState } from "react";
import type { LineupDraft } from "./draft-actions";

// Feature B: "a simple compare view for drafts (reliability and AI
// summary side by side)" -- reads straight off each draft's own cached
// analysis/reliability (no new AI calls), so this is free to open at
// any time regardless of which draft is active.
export function DraftCompare({ drafts }: { drafts: LineupDraft[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground/70 hover:border-accent-primary"
      >
        {open ? "Hide" : "Compare"} drafts
      </button>

      {open && (
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {drafts.map((draft) => {
            const summary = typeof draft.analysis?.overallAssessment === "string" ? draft.analysis.overallAssessment : null;
            return (
              <div key={draft.id} className="rounded-md border border-border bg-background/40 p-3">
                <p className="font-heading text-sm font-semibold text-white">{draft.name}</p>
                {draft.reliability !== null ? (
                  <p className="mt-1 text-xs font-semibold" style={{ color: "#F0C060" }}>
                    📊 {draft.reliability}% reliable
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-foreground/40">Not analyzed yet</p>
                )}
                <p className="mt-2 text-xs text-foreground/70">{summary ?? "No AI summary yet -- run Analyze Full Lineup on this draft."}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
