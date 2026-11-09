"use client";

import { useEffect, useState } from "react";

const DISMISS_KEY = "epicplay_launch_banner_dismissed";

// A reusable inline-SVG "double stitch" strip -- two parallel, slightly
// wavy dashed red lines on a white ground, tiled horizontally via an
// SVG <pattern> so it reads correctly at any banner width. One copy
// frames the banner's top edge, a vertically-flipped copy frames the
// bottom -- "the edges made of baseball stitching (the red double-stitch
// curve on a white ball)," per the request.
//
// Bug fix: this used to be a direct flex child of .launch-banner,
// alongside the link text and dismiss button, with width="100%" as an
// SVG attribute. As a replaced element, it refused to shrink in the
// flex row (no min-width:0 escape hatch applies to an SVG's own
// intrinsic sizing), so each copy claimed almost the row's entire
// width, squeezed the link text into a ~58px column, and that text
// wrapping across 7 lines ballooned the whole banner to ~186px/164px
// tall -- nowhere near "a thin stitched edge." Fixed by taking both
// copies OUT of the flex row entirely: each is now absolutely
// positioned (top:0 / bottom:0, full width) as a thin edge "frame"
// around the row, which is what the request actually asked for.
function StitchEdge({ flip }: { flip?: boolean }) {
  return (
    <svg
      className={`launch-banner-stitch ${flip ? "launch-banner-stitch-bottom" : "launch-banner-stitch-top"}`}
      width="100%"
      height="6"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <pattern id={`stitch-${flip ? "b" : "t"}`} width="22" height="6" patternUnits="userSpaceOnUse">
          <rect width="22" height="6" fill="#EAF7EE" />
          <path d="M0 2 Q5.5 0 11 2 T22 2" stroke="#E24B4A" strokeWidth="1.1" fill="none" strokeLinecap="round" strokeDasharray="2 2" />
          <path d="M0 4.3 Q5.5 2.3 11 4.3 T22 4.3" stroke="#E24B4A" strokeWidth="1.1" fill="none" strokeLinecap="round" strokeDasharray="2 2" />
        </pattern>
      </defs>
      <rect width="100%" height="6" fill={`url(#stitch-${flip ? "b" : "t"})`} />
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
      <StitchEdge flip />
      {/* Stadium lights: two soft, blurred light cones that slowly sweep
          left-to-right and flicker, CSS-only (no video/canvas/image) --
          see .launch-banner-light-a/-b in marketing.css. Kept subtle
          (low opacity, narrow) and clipped to the banner's own now-thin
          box (overflow: hidden), so they never reach the hero below.
          The global prefers-reduced-motion rule at the bottom of that
          file already collapses these to a static, non-animating state. */}
      <div className="launch-banner-light launch-banner-light-a" aria-hidden="true" />
      <div className="launch-banner-light launch-banner-light-b" aria-hidden="true" />

      <div className="launch-banner-row">
        <a href="#lead-form" className="launch-banner-link">
          <strong>Free access until Dec 31, 2026.</strong> Join the founding list.
        </a>
        <button type="button" onClick={dismiss} aria-label="Dismiss this banner" className="launch-banner-dismiss">
          ×
        </button>
      </div>
    </div>
  );
}
