"use client";

import { useEffect, useState } from "react";

// Mobile-only sticky "Start Your Season" bar. Hidden until the viewer
// scrolls past the hero (so it never competes with the hero's own
// buttons), hidden again entirely above the tablet breakpoint via CSS
// (.sticky-mobile-cta) -- the hero + nav CTA already cover desktop.
export function StickyMobileCta() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function onScroll() {
      setVisible(window.scrollY > window.innerHeight * 0.85);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className={`sticky-mobile-cta ${visible ? "visible" : ""}`}>
      <a href="/login" className="sticky-mobile-cta-btn">
        Start Your Season →
      </a>
    </div>
  );
}
