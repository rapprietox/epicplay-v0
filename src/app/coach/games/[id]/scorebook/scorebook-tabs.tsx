"use client";

import { useState } from "react";

// Part 4: "New Game Analysis tab on the completed game scorebook page."
// Both tabs' content are already fully rendered server-side (the
// scorebook table and the analysis panel each need their own data
// fetches, already done in page.tsx) -- this just toggles which one is
// visible, so the scorebook itself never has to become a client
// component.
export function ScorebookTabs({
  scorebook,
  analysis,
  defaultTab,
}: {
  scorebook: React.ReactNode;
  analysis: React.ReactNode;
  defaultTab: "scorebook" | "analysis";
}) {
  const [tab, setTab] = useState<"scorebook" | "analysis">(defaultTab);

  return (
    <div>
      <div className="mx-auto mb-4 flex w-full max-w-[1400px] gap-2 print:hidden">
        <button
          type="button"
          onClick={() => setTab("scorebook")}
          className={`rounded-md px-4 py-2 text-sm font-semibold transition ${
            tab === "scorebook" ? "bg-accent-primary text-white" : "border border-border text-foreground/60 hover:text-white"
          }`}
        >
          Scorebook
        </button>
        <button
          type="button"
          onClick={() => setTab("analysis")}
          className={`rounded-md px-4 py-2 text-sm font-semibold transition ${
            tab === "analysis" ? "bg-accent-gold text-background" : "border border-border text-foreground/60 hover:text-white"
          }`}
        >
          Game Analysis
        </button>
      </div>

      <div className={tab === "scorebook" ? "" : "hidden print:block"}>{scorebook}</div>
      <div className={tab === "analysis" ? "" : "hidden"}>{analysis}</div>
    </div>
  );
}
