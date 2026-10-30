"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const ROADMAP = [
  {
    key: "now",
    label: "Now",
    title: "Available today",
    bullets: ["Live game logging", "Heat maps", "Spray charts", "Lineup intelligence", "KAIROS AI", "Player Clubhouse"],
  },
  {
    key: "next",
    label: "Next",
    title: "The Replay",
    text: "An animated simulation of a logged game, shareable with anyone. In development -- not available yet.",
    inDevelopment: true,
  },
  {
    key: "later",
    label: "Later",
    title: "Recruiting profiles and player development history",
    text: "We're building toward a shareable, verified record of a player's statistical history over time. This is a direction we're building toward, not a promise of what it will become.",
    inDevelopment: true,
  },
];

export function Roadmap() {
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
    <section className="roadmap-section section-full" id="roadmap" ref={sectionRef}>
      <div className="section">
        <div className="future-head">
          <h2 className="section-headline headline-white">Built for today.</h2>
          <h2 className="section-headline headline-gold">Honest about what&apos;s next.</h2>
        </div>
        <div className="timeline">
          {ROADMAP.map((item, i) => (
            <div className="timeline-item" key={item.key}>
              <div className="timeline-rail">
                <div className="timeline-dot" />
                {i < ROADMAP.length - 1 && <div className="timeline-line" />}
              </div>
              <div className="timeline-body">
                <p className="timeline-year">{item.label}</p>
                <p className="timeline-title">
                  {item.title}
                  {item.inDevelopment && <span className="stack-soon" style={{ marginLeft: 10 }}>In development</span>}
                </p>
                {item.text && <p className="timeline-text">{item.text}</p>}
                {item.bullets && (
                  <ul className="timeline-bullets">
                    {item.bullets.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
