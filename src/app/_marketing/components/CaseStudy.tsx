"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { CASE_STUDY } from "../constants";

gsap.registerPlugin(ScrollTrigger);

// Only facts confirmed against this codebase's own
// supabase/data-ops/*.sql scripts -- team name, league label, and
// season year. No scores, records, or player names (those scripts
// contain real youth players' game data, not marketing copy).
const TIMELINE = [
  {
    year: CASE_STUDY.season,
    title: `The ${CASE_STUDY.teamName} founding season`,
    text: `EpicPlay AI was built around a real team and a real operator -- the ${CASE_STUDY.teamName}, playing their ${CASE_STUDY.season} ${CASE_STUDY.league} season.`,
  },
  {
    year: CASE_STUDY.season,
    title: "First games logged",
    text: "The first live games went through the operator screen exactly the way any team's games do now -- pitch by pitch, at-bat by at-bat.",
  },
  {
    year: CASE_STUDY.season,
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
    <section className="case-study-section section-full" id="case-study" ref={sectionRef}>
      <div className="section">
        <div className="future-head">
          <h2 className="section-headline headline-white">A real team.</h2>
          <h2 className="section-headline headline-gold">A real founding season.</h2>
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

// Hidden entirely unless CASE_STUDY.quote is a real, confirmed quote --
// currently empty on purpose. Set CASE_STUDY.quote (and
// quoteAttribution) in src/app/_marketing/constants.ts once there's a
// real one to show; no other code change needed.
function QuoteCard() {
  if (!CASE_STUDY.quote) return null;
  return (
    <div className="card quote-card">
      <p className="quote-text">&ldquo;{CASE_STUDY.quote}&rdquo;</p>
      {CASE_STUDY.quoteAttribution && <p className="quote-attribution">&mdash; {CASE_STUDY.quoteAttribution}</p>}
    </div>
  );
}
