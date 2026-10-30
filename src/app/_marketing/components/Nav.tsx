"use client";

import { useEffect, useState } from "react";
import { ScrollProgressBar } from "./ScrollProgressBar";

const NAV_LINKS = [
  { href: "#problem", label: "Problem" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#demo", label: "Demo" },
  { href: "#kairos", label: "KAIROS" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 40);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={`marketing-nav ${scrolled ? "scrolled" : ""}`}>
      <div className="nav-inner">
        <a href="#top" className="nav-brand">
          <span>⚾</span>EPICPLAY AI
        </a>
        <div className="nav-links">
          {NAV_LINKS.map((link) => (
            <a href={link.href} key={link.href}>
              {link.label}
            </a>
          ))}
          <a href="/login" className="nav-cta">
            Get Started →
          </a>
        </div>
        <button
          type="button"
          className="burger"
          aria-label="Open menu"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
      </div>
      {mobileOpen && (
        <div className="nav-mobile-sheet">
          {NAV_LINKS.map((link) => (
            <a href={link.href} key={link.href} onClick={() => setMobileOpen(false)}>
              {link.label}
            </a>
          ))}
          <a href="/login" className="nav-cta" style={{ textAlign: "center" }} onClick={() => setMobileOpen(false)}>
            Get Started →
          </a>
        </div>
      )}
      <ScrollProgressBar />
    </nav>
  );
}
