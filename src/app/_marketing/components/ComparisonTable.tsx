"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const ROWS: { label: string; paper: boolean; sheet: boolean; epicplay: boolean }[] = [
  { label: "Live scoring", paper: false, sheet: false, epicplay: true },
  { label: "Heat maps", paper: false, sheet: false, epicplay: true },
  { label: "Spray charts", paper: false, sheet: false, epicplay: true },
  { label: "Lineup analysis", paper: false, sheet: false, epicplay: true },
  { label: "Opponent history", paper: false, sheet: false, epicplay: true },
  { label: "Player-facing stats", paper: false, sheet: false, epicplay: true },
  { label: "Sharing with parents", paper: false, sheet: false, epicplay: true },
];

export function ComparisonTable() {
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const rows = section.querySelectorAll<HTMLElement>(".cmp-row");
    if (!rows.length) return;

    gsap.fromTo(
      rows,
      { opacity: 0, x: -16 },
      {
        opacity: 1,
        x: 0,
        duration: 0.5,
        stagger: 0.08,
        ease: "power2.out",
        scrollTrigger: { trigger: section, start: "top 78%" },
      }
    );
  }, []);

  return (
    <section className="cmp-section section-full" id="comparison" ref={sectionRef}>
      <div className="section">
        <div className="cmp-head">
          <h2 className="section-headline headline-white">What you&apos;re actually comparing.</h2>
        </div>
        <div className="cmp-table">
          <div className="cmp-row cmp-header-row">
            <span>Capability</span>
            <span>Paper scorebook</span>
            <span>Spreadsheet</span>
            <span className="cmp-epicplay-col">EpicPlay AI</span>
          </div>
          {ROWS.map((r) => (
            <div className="cmp-row" key={r.label}>
              <span className="cmp-label">{r.label}</span>
              <CmpCell yes={r.paper} />
              <CmpCell yes={r.sheet} />
              <CmpCell yes={r.epicplay} highlight />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CmpCell({ yes, highlight }: { yes: boolean; highlight?: boolean }) {
  return (
    <span className={`cmp-cell ${highlight ? "cmp-cell-highlight" : ""}`}>
      {yes ? (
        <span className="cmp-check" aria-label="Yes">
          ✓
        </span>
      ) : (
        <span className="cmp-cross" aria-label="No">
          ✗
        </span>
      )}
    </span>
  );
}
