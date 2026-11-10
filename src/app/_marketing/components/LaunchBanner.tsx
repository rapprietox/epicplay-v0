"use client";

import { useEffect, useState } from "react";
import { SPORT_WORDING } from "@/lib/pricing";
import { WHATSAPP_COMMUNITY_URL } from "@/lib/legal";

const DISMISS_KEY = "epicplay_launch_banner_dismissed";

// Banner-redesign batch: gold/dark NES-pixel look, replacing the
// green/stadium-light version entirely (see marketing.css's own
// comment on why that one had to go -- a flex/SVG sizing bug, not a
// style choice worth keeping). The pixel-art baseball frame along the
// top/bottom edges is now a CSS background-image (data: URI, still
// literally "inline SVG," just not a DOM element this time) rather
// than an inline <svg> flex child -- the exact class of element that
// caused the earlier blowout. A background-image can't participate in
// flex sizing at all, so that bug is now structurally impossible here,
// not just patched.
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
  // by the banner's own height while it's visible, or the two overlap.
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

  // Same "scroll to an existing field, no popup" pattern
  // StickyMobileCta.tsx already uses -- only reached when
  // WHATSAPP_COMMUNITY_URL is empty (the <a> branch below handles the
  // "URL is set" case with a real link instead).
  function scrollToWhatsappCheckbox(e: React.MouseEvent) {
    e.preventDefault();
    document.getElementById("whatsapp-optin-field")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  if (!mounted || !visible) return null;

  return (
    <div className="launch-banner">
      <div className="launch-banner-frame" aria-hidden="true" />
      <div className="launch-banner-row">
        <a href="#lead-form" className="launch-banner-main">
          TRACK YOUR {SPORT_WORDING} SEASON. FREE UNTIL DEC 31.
        </a>

        {WHATSAPP_COMMUNITY_URL ? (
          <a href={WHATSAPP_COMMUNITY_URL} target="_blank" rel="noopener noreferrer" className="launch-banner-whatsapp">
            Join the WhatsApp channel, learn more
          </a>
        ) : (
          <a href="#whatsapp-optin-field" onClick={scrollToWhatsappCheckbox} className="launch-banner-whatsapp">
            Join the WhatsApp channel, learn more
          </a>
        )}
      </div>

      <button type="button" onClick={dismiss} aria-label="Dismiss this banner" className="launch-banner-dismiss">
        ×
      </button>
      <div className="launch-banner-frame" aria-hidden="true" />
    </div>
  );
}
