"use client";

import { useEffect, useState } from "react";

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

  const links = (
    <>
      <a href="#platform">Features</a>
      <a href="#kairos">KAIROS</a>
      <a href="#pricing">Pricing</a>
    </>
  );

  return (
    <nav className={`marketing-nav ${scrolled ? "scrolled" : ""}`}>
      <div className="nav-inner">
        <a href="#top" className="nav-brand">
          <span>⚾</span>EPICPLAY AI
        </a>
        <div className="nav-links">
          {links}
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
          style={{
            display: "none",
            flexDirection: "column",
            gap: 5,
            background: "none",
            border: "none",
            padding: 8,
          }}
        >
          <span style={{ width: 22, height: 2, background: "#eaf7ee", display: "block" }} />
          <span style={{ width: 22, height: 2, background: "#eaf7ee", display: "block" }} />
          <span style={{ width: 22, height: 2, background: "#eaf7ee", display: "block" }} />
        </button>
      </div>
      {mobileOpen && (
        <div
          style={{
            background: "rgba(3,10,6,0.97)",
            borderBottom: "1px solid #1a3d28",
            padding: "18px 24px 22px",
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          <a href="#platform" onClick={() => setMobileOpen(false)} style={{ color: "#9fc4ac", fontSize: 16 }}>
            Features
          </a>
          <a href="#kairos" onClick={() => setMobileOpen(false)} style={{ color: "#9fc4ac", fontSize: 16 }}>
            KAIROS
          </a>
          <a href="#pricing" onClick={() => setMobileOpen(false)} style={{ color: "#9fc4ac", fontSize: 16 }}>
            Pricing
          </a>
          <a href="/login" className="nav-cta" style={{ textAlign: "center" }} onClick={() => setMobileOpen(false)}>
            Get Started →
          </a>
        </div>
      )}
    </nav>
  );
}
