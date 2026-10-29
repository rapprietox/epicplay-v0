"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const STACK_ITEMS = [
  {
    num: "01",
    title: "Pitch Tracking",
    desc: "Every pitch. Location, type, outcome. Automatically organized.",
    sub: "The data that turns a good coach into a great one. Build heat maps from day one.",
    visual: "⚾",
  },
  {
    num: "02",
    title: "Heat Maps",
    desc: "Three zone maps per player. Built from real game data.",
    sub: "Batting average · Whiff rate · Pitch location tendency. See what the eye misses.",
    visual: "▦",
  },
  {
    num: "03",
    title: "Spray Charts",
    desc: "See where every ball lands. 2D precision. 3D animated trajectories.",
    sub: "Identify pull tendencies. Find the gaps. Adjust your defense before they do.",
    visual: "◎",
  },
  {
    num: "04",
    title: "Lineup Intelligence",
    desc: "Live AI feedback as you build. Deep analysis before every game.",
    sub: "KAIROS flags every suboptimal decision before it costs you runs.",
    visual: "☰",
  },
  {
    num: "05",
    title: "KAIROS AI",
    desc: "Your team's baseball intelligence. Available 24/7.",
    sub: "Named after the Greek god of the perfect moment. Ask anything. Get real answers.",
    visual: "█",
  },
  {
    num: "06",
    title: "The Clubhouse",
    desc: "Every player gets their personal analytics page.",
    sub: "Heat maps. Spray charts. AI coaching. Drill recommendations. EPS score.",
    visual: "24",
  },
  {
    num: "07",
    title: "Opponent Scouting",
    desc: "Build pitcher profiles automatically from logged games.",
    sub: "After 3 games against the same pitcher — you know their patterns cold.",
    visual: "◈",
  },
  {
    num: "08",
    title: "The Replay ★",
    desc: "Animated simulation of every game. Share with anyone.",
    sub: "Every pitch. Every hit. Every stolen base. Replayed.",
    visual: "▶",
    soon: true,
  },
];

export function IntelligenceStack() {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const items = listRef.current?.querySelectorAll(".stack-item");
    if (!items?.length) return;

    items.forEach((item) => {
      gsap.fromTo(
        item,
        { x: -80, opacity: 0 },
        {
          x: 0,
          opacity: 1,
          duration: 0.8,
          ease: "power3.out",
          scrollTrigger: {
            trigger: item,
            start: "top 80%",
            end: "top 50%",
            toggleActions: "play none none reverse",
          },
        }
      );
    });
  }, []);

  return (
    <section className="section-full stack-section">
      <div className="section">
        <div className="stack-head">
          <h2 className="section-headline headline-white">What MLB Teams Have.</h2>
          <h2 className="section-headline headline-gold">Now For Every Team.</h2>
        </div>
        <div className="stack-list" ref={listRef}>
          {STACK_ITEMS.map((item) => (
            <div className="stack-item" key={item.num}>
              <div className="stack-number">{item.num}</div>
              <div className="stack-copy">
                <p className="stack-title">{item.title}</p>
                <p className="stack-desc">{item.desc}</p>
                <p className="stack-sub">{item.sub}</p>
                {item.soon && <span className="stack-soon">Coming Soon</span>}
              </div>
              <div className="stack-visual" aria-hidden="true">
                {item.visual}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
