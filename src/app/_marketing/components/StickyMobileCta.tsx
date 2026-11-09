"use client";

import { useEffect, useState } from "react";

const PREFILL_EMAIL_KEY = "epicplay_lead_email";

// Mobile-only sticky bar, shown once the viewer scrolls past the hero
// (unchanged from before). Launch-capture batch: the plain "Start Your
// Season" button is now an inline email field + a button -- typing an
// email and tapping through hands it to the real lead form (hero's
// compact one, or the Founding Access section's) via sessionStorage,
// rather than inserting a second, partial lead row with no name/role.
// "No popups": this never opens a modal, it just scrolls to an
// existing form already on the page.
export function StickyMobileCta() {
  const [visible, setVisible] = useState(false);
  const [email, setEmail] = useState("");

  useEffect(() => {
    function onScroll() {
      setVisible(window.scrollY > window.innerHeight * 0.85);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (email.trim()) sessionStorage.setItem(PREFILL_EMAIL_KEY, email.trim());
    } catch {
      // Storage blocked -- the scroll-to-form below still works, the
      // email just won't be prefilled there.
    }
    document.getElementById("lead-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className={`sticky-mobile-cta ${visible ? "visible" : ""}`}>
      <form className="sticky-mobile-cta-form" onSubmit={handleSubmit}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Your email"
          aria-label="Your email"
          className="sticky-mobile-cta-input"
        />
        <button type="submit" className="sticky-mobile-cta-btn">
          Join →
        </button>
      </form>
    </div>
  );
}
