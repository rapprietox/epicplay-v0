"use client";

import { useState } from "react";
import { EPS_TIER_LABEL, type EpsTier } from "@/lib/eps";
import { EPS_PLAIN_LANGUAGE, EPS_MIN_PA_NOTE, EPS_DISCLAIMER, EPS_EXAMPLE } from "@/lib/clubhouse-copy";

// Explain-EPS batch: the tier boundaries mirror epsTier's own thresholds
// in src/lib/eps.ts exactly (>=85/70/55/40/25, else beginner) -- listed
// here as plain data for the scale table rather than re-deriving them,
// since epsTier itself only ever needs to classify one number, not
// describe the whole scale.
const EPS_TIER_SCALE: { tier: EpsTier; range: string }[] = [
  { tier: "legendary", range: "85-100" },
  { tier: "elite", range: "70-84" },
  { tier: "strong", range: "55-69" },
  { tier: "solid", range: "40-54" },
  { tier: "developing", range: "25-39" },
  { tier: "beginner", range: "0-24" },
];

// A single, self-contained trigger+modal island -- dropped into the
// Performance Score card (both Team Leaders boards), the player
// profile header, and the Clubhouse Pro "What you get" list, with no
// props and no shared state between them. Each instance manages its
// own open/closed state, so using it in three unrelated places needs
// no prop-threading through any of those pages.
export function EpsInfoTrigger() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="inline-flex items-center text-foreground/40 transition hover:text-accent-gold"
        aria-label="What is EPS?"
        title="What is EPS?"
      >
        <span className="text-xs">ⓘ</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(false);
          }}
        >
          <div
            className="glossy max-h-[80vh] w-full max-w-md overflow-y-auto rounded-lg border-2 p-5 text-left"
            style={{ backgroundColor: "#080E08", borderColor: "#2ECC71" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-heading text-lg font-bold uppercase tracking-wide text-white">What is EPS?</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-md px-2 py-1 text-foreground/50 transition hover:text-white"
              >
                ✕
              </button>
            </div>

            <p className="mt-3 text-sm text-foreground/80">{EPS_PLAIN_LANGUAGE}</p>

            <div className="mt-4 flex flex-col gap-1.5">
              {EPS_TIER_SCALE.map((t) => (
                <div key={t.tier} className="flex items-center justify-between text-sm">
                  <span className="text-white">{EPS_TIER_LABEL[t.tier]}</span>
                  <span className="font-mono text-xs text-foreground/50">{t.range}</span>
                </div>
              ))}
            </div>

            <p className="mt-4 text-xs text-foreground/60">{EPS_EXAMPLE}</p>

            <div className="mt-4 border-t border-border pt-3">
              <p className="text-xs text-foreground/50">{EPS_MIN_PA_NOTE}</p>
              <p className="mt-1 text-xs text-foreground/50">{EPS_DISCLAIMER}</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
