"use client";

import { useEffect, useState } from "react";

const DISMISS_KEY = "epicplay_launch_banner_dismissed";

// A reusable inline-SVG "double stitch" strip -- two parallel, slightly
// wavy dashed red lines on a white ground, tiled horizontally via an
// SVG <pattern> so it reads correctly at any banner width. One copy
// frames the banner's top edge, a vertically-flipped copy frames the
// bottom -- "the edges made of baseball stitching (the red double-stitch
// curve on a white ball)," per the request.
function StitchEdge({ flip }: { flip?: boolean }) {
  return (
    <svg
      className="launch-banner-stitch"
      style={flip ? { transform: "scaleY(-1)" } : undefined}
      width="100%"
      height="9"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <pattern id={`stitch-${flip ? "b" : "t"}`} width="26" height="9" patternUnits="userSpaceOnUse">
          <rect width="26" height="9" fill="#EAF7EE" />
          <path d="M0 3 Q6.5 0 13 3 T26 3" stroke="#E24B4A" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeDasharray="2.5 2.5" />
          <path d="M0 6.5 Q6.5 3.5 13 6.5 T26 6.5" stroke="#E24B4A" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeDasharray="2.5 2.5" />
        </pattern>
      </defs>
      <rect width="100%" height="9" fill={`url(#stitch-${flip ? "b" : "t"})`} />
    </svg>
  );
}

export function LaunchBanner() {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      setVisible(localStorage.getItem(DISMISS_KEY) !== "1");
    } catch {
      // Storage blocked (private window, locked-down browser) -- default
      // to showing it; there's no persisted dismissal to honor anyway.
      setVisible(true);
    }
  }, []);

  // The fixed-position Nav (.marketing-nav, top: 0) needs to shift down
  // by the banner's own height while it's visible, or the two overlap --
  // a body class is the simplest way to reach that sibling-in-a-different-
  // component element from here without prop-drilling or a layout
  // context just for this.
  useEffect(() => {
    document.body.classList.toggle("has-launch-banner", visible);
    return () => {
      document.body.classList.remove("has-launch-banner");
    };
  }, [visible]);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Dismissal just won't be remembered on the next visit -- the
      // banner itself still closes for this one.
    }
  }

  if (!mounted || !visible) return null;

  return (
    <div className="launch-banner">
      <StitchEdge />
      {/* Stadium lights: two soft, blurred light cones that slowly sweep
          left-to-right and flicker, CSS-only (no video/canvas/image) --
          see .launch-banner-light-a/-b in marketing.css. The global
          prefers-reduced-motion rule at the bottom of that file already
          collapses these to a static, non-animating state. */}
      <div className="launch-banner-light launch-banner-light-a" aria-hidden="true" />
      <div className="launch-banner-light launch-banner-light-b" aria-hidden="true" />

      <a href="#lead-form" className="launch-banner-link">
        <strong>Free access until Dec 31, 2026.</strong> Join the founding list.
      </a>
      <button type="button" onClick={dismiss} aria-label="Dismiss this banner" className="launch-banner-dismiss">
        ×
      </button>
      <StitchEdge flip />
    </div>
  );
}
