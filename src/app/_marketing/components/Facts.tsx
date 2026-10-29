"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const FACTS = [
  { num: "2 sec", label: "To log any at-bat" },
  { num: "3 maps", label: "Per player heat maps included" },
  { num: "0", label: "Extra hardware needed" },
  { num: "∞", label: "At-bats stored forever", infinity: true },
];

export function Facts() {
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cards = sectionRef.current?.querySelectorAll(".fact-card");
    if (!cards?.length) return;

    gsap.fromTo(
      cards,
      { opacity: 0, y: 24 },
      {
        opacity: 1,
        y: 0,
        duration: 0.6,
        stagger: 0.1,
        ease: "power2.out",
        scrollTrigger: { trigger: sectionRef.current, start: "top 80%" },
      }
    );
  }, []);

  return (
    <section className="section-full facts-section" ref={sectionRef}>
      <div className="section facts-grid">
        {FACTS.map((fact) => (
          <div className="card fact-card" key={fact.label}>
            <p className={`fact-number ${fact.infinity ? "infinity" : ""}`}>{fact.num}</p>
            <p className="fact-label">{fact.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
