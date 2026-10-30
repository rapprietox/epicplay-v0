"use client";

import { useEffect, useState } from "react";

// Thin gold bar fixed under the nav, width tracking scroll position.
// Plain scroll-position math, not GSAP -- it needs to read on every
// scroll frame, which is exactly what GSAP's ScrollTrigger is already
// doing per-section; a second system for one number would be redundant.
export function ScrollProgressBar() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    function onScroll() {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - doc.clientHeight;
      setProgress(scrollable > 0 ? Math.min(window.scrollY / scrollable, 1) : 0);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="scroll-progress-track" aria-hidden="true">
      <div className="scroll-progress-fill" style={{ transform: `scaleX(${progress})` }} />
    </div>
  );
}
