"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const TIMELINE = [
  {
    year: "2026",
    title: "The Season",
    text: "Every game logged. Every pattern tracked. Every at-bat analyzed. Your first full season of real data.",
  },
  {
    year: "2027",
    title: "The Recruiting Profile",
    text: "Your player's complete statistical career. Shareable with college coaches. Verified by EpicPlay AI. The difference between noticed and overlooked.",
  },
  {
    year: "2028",
    title: "The Scholarship",
    text: "Data-driven player development creates opportunities. EpicPlay AI is building the infrastructure for the next generation of baseball talent.",
  },
];

export function TheFuture() {
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const items = sectionRef.current?.querySelectorAll(".timeline-item");
    if (!items?.length) return;

    gsap.fromTo(
      items,
      { opacity: 0, y: 24 },
      {
        opacity: 1,
        y: 0,
        duration: 0.6,
        stagger: 0.15,
        ease: "power2.out",
        scrollTrigger: { trigger: sectionRef.current, start: "top 75%" },
      }
    );
  }, []);

  return (
    <section className="section-full future-section" ref={sectionRef}>
      <div className="section">
        <div className="future-head">
          <h2 className="section-headline headline-white">Built for Today.</h2>
          <h2 className="section-headline headline-gold">Designed for What Comes Next.</h2>
        </div>
        <div className="timeline">
          {TIMELINE.map((item, i) => (
            <div className="timeline-item" key={item.year}>
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
      </div>
    </section>
  );
}
