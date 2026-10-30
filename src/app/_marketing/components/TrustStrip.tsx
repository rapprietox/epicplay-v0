"use client";

import { TRACKED_FEATURES } from "../constants";

// Desktop: a slow (60s+) auto-scrolling marquee, paused on hover (see
// .trust-track:hover and the prefers-reduced-motion override in
// marketing.css). Mobile (<=768px): the marquee is dropped entirely in
// favor of a static wrapped grid of chips -- a moving line of text is
// hard to read on a narrow screen no matter how slow it scrolls, and a
// static grid reads fine at any width. Both markups render always;
// which one is visible is pure CSS (.trust-track vs .trust-grid), so
// there's no hydration mismatch risk from a JS-computed breakpoint.
export function TrustStrip() {
  const doubled = [...TRACKED_FEATURES, ...TRACKED_FEATURES];

  return (
    <section className="trust-strip" id="trust" aria-label="What EpicPlay AI tracks">
      <div className="trust-track-wrap">
        <div className="trust-track">
          {doubled.map((item, i) => (
            <span className="trust-item" key={`${item}-${i}`}>
              <span className="trust-dot" aria-hidden="true" />
              {item}
            </span>
          ))}
        </div>
      </div>
      <div className="trust-grid">
        {TRACKED_FEATURES.map((item) => (
          <span className="trust-chip" key={item}>
            <span className="trust-dot" aria-hidden="true" />
            {item}
          </span>
        ))}
      </div>
      <p className="trust-line">Built by a coach. Tested in a real league.</p>
    </section>
  );
}
