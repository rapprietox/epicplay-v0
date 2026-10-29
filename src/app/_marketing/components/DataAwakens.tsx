"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SectionVideo } from "./SectionVideo";

gsap.registerPlugin(ScrollTrigger);

const ZONE_COLORS = [
  "#2ECC71",
  "#EF9F27",
  "#2ECC71",
  "#E24B4A",
  "#EF9F27",
  "#2ECC71",
  "#EF9F27",
  "#2ECC71",
  "#E24B4A",
];
const ZONE_OPACITIES = [0.75, 0.75, 0.55, 0.85, 0.65, 0.7, 0.6, 0.8, 0.5];

export function DataAwakens() {
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cards = sectionRef.current?.querySelectorAll(".data-reveal");
    if (!cards?.length) return;

    gsap.fromTo(
      cards,
      { opacity: 0, y: 24 },
      {
        opacity: 1,
        y: 0,
        duration: 0.7,
        stagger: 0.1,
        ease: "power2.out",
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top 75%",
        },
      }
    );
  }, []);

  return (
    <section className="section-full data-section" id="platform-data" ref={sectionRef}>
      <SectionVideo src="/hero-video2.mp4" loop={false} opacity={0.5} />
      <div className="section" style={{ paddingBottom: 0 }}>
        <div className="data-head">
          <h2 className="section-headline headline-white">Every game tells a story.</h2>
          <p>Most coaches never read it. Until now.</p>
        </div>
        <div className="data-grid">
          <div className="card data-card-item data-reveal">
            <p className="data-eyebrow">Spray Data · LF</p>
            <p className="data-value">Marcus Johnson · 2B · field_x: 23, field_y: 45</p>
          </div>
          <div className="card data-card-item green data-reveal">
            <p className="data-eyebrow">Spray Data · CF</p>
            <p className="data-value">Tyler Chen · Triple · CF gap</p>
          </div>
          <div className="card data-card-item data-reveal">
            <p className="data-eyebrow">Pitching</p>
            <p className="data-value">Kenji Tanaka · ERA 2.14 · 12 K last 3 games</p>
          </div>
          <div className="card data-card-item data-reveal">
            <p className="data-eyebrow">Zone Heat Map · Home</p>
            <div className="zone-grid-mini">
              {ZONE_COLORS.map((color, i) => (
                <div
                  key={i}
                  className="cell"
                  style={{ background: color, opacity: ZONE_OPACITIES[i] }}
                />
              ))}
            </div>
          </div>
          <div className="card data-card-item warn data-reveal">
            <p className="data-eyebrow">⚠ KAIROS Alert</p>
            <p className="data-value">Low-outside zone — 67% whiff rate detected</p>
          </div>
        </div>
      </div>
    </section>
  );
}
