"use client";

import { useState } from "react";
import type { LoggingMode } from "@/lib/supabase/types";

const MOTIVATION_POINTS = [
  {
    icon: "⚾",
    title: "PLAYOFF PREPARATION",
    body: "By the time you reach the playoffs you'll have heat maps on every opposing batter. You'll know exactly where to pitch them. Quick mode gives you nothing.",
  },
  {
    icon: "📋",
    title: "LINEUP STRATEGY",
    body: "Full logging tells you which of YOUR hitters performs best against right-handed vs left-handed pitchers. You'll know your optimal playoff lineup before you step on the field.",
  },
  {
    icon: "🎯",
    title: "PITCHING INTELLIGENCE",
    body: "After 10 full games you'll know which pitch your pitcher throws most effectively in each zone. You'll know when he's tiring before he does.",
  },
  {
    icon: "📈",
    title: "OPPONENT PITCHER FILES",
    body: "Every pitcher you face gets profiled. Next time you face them — you'll know exactly how YOUR batters have historically performed against them. Quick mode builds nothing.",
  },
  {
    icon: "📈",
    title: "THE DATA COMPOUNDS",
    body: "Game 1 gives you a little. Game 5 gives you patterns. Game 15 gives you a competitive advantage no other team in your league has.",
  },
];

// Quick Mode batch: a controlled component -- the parent (LineupBuilder)
// owns `value` since it's what gets sent to startGame, this component
// only owns the transient "is the motivation card open right now" state.
// Selecting Full Logging is a direct, unconfirmed choice (it's the
// recommended path -- no friction needed); selecting Quick Mode always
// routes through the motivation card first, per spec, and only commits
// on "Continue with Quick Mode."
export function LoggingModeSelector({ value, onChange }: { value: LoggingMode; onChange: (mode: LoggingMode) => void }) {
  const [showMotivation, setShowMotivation] = useState(false);

  return (
    <section className="glossy rounded-lg border border-border bg-surface p-5">
      <h2 className="font-heading text-lg font-semibold uppercase tracking-wide text-white">How will you log this game?</h2>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => onChange("full")}
          className={`rounded-lg border-2 p-4 text-left transition ${
            value === "full" ? "border-accent-gold bg-accent-gold/10" : "border-border hover:border-accent-gold/50"
          }`}
        >
          <p className="font-heading text-base font-bold text-accent-gold">⭐ FULL LOGGING (Recommended)</p>
          <p className="mt-1 text-xs text-foreground/60">Every pitch · Heat maps · Spray charts · AI coaching · Playoff intelligence</p>
        </button>

        <button
          type="button"
          onClick={() => setShowMotivation(true)}
          className={`rounded-lg border-2 p-4 text-left transition ${
            value === "quick" ? "border-accent-amber bg-accent-amber/10" : "border-border hover:border-accent-amber/50"
          }`}
        >
          <p className="font-heading text-base font-bold text-accent-amber">⚡ QUICK MODE</p>
          <p className="mt-1 text-xs text-foreground/60">At-bat outcomes only · Basic stats · No heat maps</p>
        </button>
      </div>

      {value === "quick" && (
        <p className="mt-3 text-xs text-accent-amber">
          Quick Mode selected for this game.{" "}
          <button type="button" onClick={() => onChange("full")} className="underline hover:text-white">
            Switch back to Full Logging
          </button>
        </p>
      )}

      {showMotivation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4">
          <div className="glossy max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-accent-gold/40 bg-surface p-6 shadow-[0_0_40px_rgba(240,192,96,0.15)]">
            <h2 className="font-heading text-center text-2xl font-bold text-white">
              &ldquo;Quick mode won&apos;t give you what you need to win.&rdquo;
            </h2>
            <p className="mt-4 text-center text-sm font-semibold uppercase tracking-wide text-accent-red">
              What you lose without full logging:
            </p>

            <div className="mt-4 flex flex-col gap-4">
              {MOTIVATION_POINTS.map((p) => (
                <div key={p.title} className="flex gap-3">
                  <span className="text-2xl">{p.icon}</span>
                  <div>
                    <p className="font-heading text-sm font-bold text-accent-gold">{p.title}</p>
                    <p className="mt-0.5 text-sm text-foreground/70">{p.body}</p>
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-6 text-center text-sm italic text-foreground/50">
              &ldquo;The teams that win in October are the ones who paid attention in September.&rdquo;
            </p>

            <div className="mt-6 flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  onChange("full");
                  setShowMotivation(false);
                }}
                className="min-h-[56px] w-full max-w-sm rounded-md bg-accent-green px-6 text-base font-bold text-white shadow-[0_0_20px_rgba(46,204,113,0.4)] transition hover:bg-accent-green/90"
              >
                USE FULL LOGGING
              </button>
              <button
                type="button"
                onClick={() => {
                  onChange("quick");
                  setShowMotivation(false);
                }}
                className="text-xs text-foreground/40 underline hover:text-foreground/60"
              >
                Continue with Quick Mode
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
