"use client";

import { TRACKED_FEATURES } from "../constants";

// Slow auto-scrolling marquee of what the platform actually tracks
// (verified against the schema/lib before being listed in constants.ts).
// Doubled list + CSS keyframe translate for a seamless loop; paused
// entirely under prefers-reduced-motion (see .trust-track in
// marketing.css), which also takes care of the "respect reduced motion"
// requirement without any JS branching here.
export function TrustStrip() {
  const items = [...TRACKED_FEATURES, ...TRACKED_FEATURES];

  return (
    <section className="trust-strip" id="trust" aria-label="What EpicPlay AI tracks">
      <div className="trust-track">
        {items.map((item, i) => (
          <span className="trust-item" key={`${item}-${i}`}>
            <span className="trust-dot" aria-hidden="true" />
            {item}
          </span>
        ))}
      </div>
      <p className="trust-line">
        Built by a coach. Tested in a real league: <strong>DLL 2026</strong>.
      </p>
    </section>
  );
}
