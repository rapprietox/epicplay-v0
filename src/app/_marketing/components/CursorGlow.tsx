"use client";

import { useEffect } from "react";

// A single global mousemove listener (desktop/fine-pointer only) that
// writes the cursor position into two CSS custom properties on the
// document root. Every .card (and other opted-in element) reads those
// properties for its own ::before radial-gradient glow -- see
// `.cursor-glow` in marketing.css -- so this stays one listener for the
// whole page instead of one per card.
export function CursorGlow() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!fine || reduced) return;

    function onMove(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      const card = target?.closest<HTMLElement>(".cursor-glow");
      if (!card) return;
      const rect = card.getBoundingClientRect();
      card.style.setProperty("--glow-x", `${e.clientX - rect.left}px`);
      card.style.setProperty("--glow-y", `${e.clientY - rect.top}px`);
    }

    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  return null;
}
