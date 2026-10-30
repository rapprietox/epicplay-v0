"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { FOUNDING_SEASON } from "../constants";

gsap.registerPlugin(ScrollTrigger);

// Deliberately no team name and no league name -- generic, true facts
// only (see FOUNDING_SEASON's own comment in constants.ts for why).
const TIMELINE = [
  {
    year: "Season 1",
    title: "Built around a real team",
    text: "EpicPlay AI wasn't designed in a vacuum -- it was built around a real youth team and a real operator logging games at the field, from day one.",
  },
  {
    year: "Season 1",
    title: "First games logged",
    text: "The first live games went through the exact same operator screen every team uses today -- pitch by pitch, at-bat by at-bat, no special treatment.",
  },
  {
    year: "Season 1",
    title: "Built from what a real season needed",
    text: "Every feature on this page exists because a real coach, running a real season, needed it -- not because it looked good on a roadmap.",
  },
];

export function CaseStudy() {
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const items = section.querySelectorAll<HTMLElement>(".timeline-item");
    if (!items.length) return;

    gsap.fromTo(
      items,
      { opacity: 0, y: 24 },
      {
        opacity: 1,
        y: 0,
        duration: 0.6,
        stagger: 0.15,
        ease: "power2.out",
        scrollTrigger: { trigger: section, start: "top 75%" },
      }
    );
  }, []);

  return (
    <section className="case-study-section section-full" id="founding-season" ref={sectionRef}>
      <div className="section">
        <div className="future-head">
          <h2 className="section-headline headline-white">Built with a real team,</h2>
          <h2 className="section-headline headline-gold">in a real founding season.</h2>
        </div>
        <div className="timeline">
          {TIMELINE.map((item, i) => (
            <div className="timeline-item" key={item.title}>
              <div className="timeline-rail">
                <div className="timeline-dot" />
                {i < TIMELINE.length - 1 && <div className="timeline-line" />}
              </div>
              <div className="timeline-body">
                <p className="timeline-year">{item.year}</p>
                <p className="timeline-title">{item.title}</p>
                <p className="timeline-text">{item.text}</p>
              </div>
            </div>
          ))}
        </div>

        <QuoteCard />
      </div>
    </section>
  );
}

// Hidden entirely unless FOUNDING_SEASON.quote is a real, confirmed
// quote -- currently empty on purpose. Set it (and quoteAttribution)
// in src/app/_marketing/constants.ts once there's a real one to show;
// no other code change needed.
function QuoteCard() {
  if (!FOUNDING_SEASON.quote) return null;
  return (
    <div className="card quote-card">
      <p className="quote-text">&ldquo;{FOUNDING_SEASON.quote}&rdquo;</p>
      {FOUNDING_SEASON.quoteAttribution && <p className="quote-attribution">&mdash; {FOUNDING_SEASON.quoteAttribution}</p>}
    </div>
  );
}
