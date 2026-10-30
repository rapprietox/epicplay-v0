"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const CARDS = [
  {
    key: "paper",
    title: "Lost paper scorebooks",
    text: "The one game you needed is the one nobody can find. Handwritten stats don't survive a season, let alone a career.",
    icon: "paper",
  },
  {
    key: "losing",
    title: "No idea why you keep losing",
    text: "You know the score. You don't know the pattern -- which zone, which count, which lineup slot is actually costing you.",
    icon: "question",
  },
  {
    key: "gut",
    title: "Lineup decisions made on gut feel",
    text: "Batting order, who to pinch hit, who to trust with two outs in the 7th -- all guesswork, every single game.",
    icon: "dice",
  },
  {
    key: "parents",
    title: "Nothing to show players or parents",
    text: "A kid who improved all season has no record of it. A parent who asks \"how's he doing?\" gets a shrug.",
    icon: "frame",
  },
];

export function Problem() {
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const cards = section.querySelectorAll<HTMLElement>(".problem-card");
    if (!cards.length) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    gsap.fromTo(
      cards,
      { opacity: 0, y: 28 },
      {
        opacity: 1,
        y: 0,
        duration: 0.7,
        stagger: 0.15,
        ease: "power2.out",
        scrollTrigger: { trigger: section, start: "top 75%" },
      }
    );

    if (reduced) return;

    cards.forEach((card) => {
      const icon = card.querySelector(".problem-icon");
      if (!icon) return;
      const kind = card.dataset.icon;

      ScrollTrigger.create({
        trigger: card,
        start: "top 78%",
        once: true,
        onEnter: () => {
          if (kind === "paper") {
            gsap.fromTo(
              icon.querySelectorAll(".paper-half"),
              { rotate: 0, x: 0 },
              {
                rotate: (i) => (i === 0 ? -14 : 14),
                x: (i) => (i === 0 ? -4 : 4),
                duration: 0.5,
                delay: 0.3,
                ease: "power2.out",
              }
            );
          } else if (kind === "question") {
            gsap.fromTo(
              icon.querySelector(".question-mark"),
              { opacity: 1 },
              { opacity: 0.15, duration: 0.1, repeat: 5, yoyo: true, delay: 0.2, ease: "none" }
            );
          } else if (kind === "dice") {
            gsap.fromTo(
              icon.querySelector(".dice-shape"),
              { rotate: -8 },
              { rotate: 10, duration: 0.18, repeat: 5, yoyo: true, delay: 0.2, ease: "none" }
            );
          } else if (kind === "frame") {
            gsap.fromTo(
              icon.querySelector(".frame-content"),
              { opacity: 0.9 },
              { opacity: 0.1, duration: 0.09, repeat: 4, yoyo: true, delay: 0.25, ease: "none" }
            );
          }
        },
      });
    });
  }, []);

  return (
    <section className="problem-section section-full" id="problem" ref={sectionRef}>
      <div className="section">
        <div className="problem-head">
          <h2 className="section-headline headline-white">Your season is a black box.</h2>
        </div>
        <div className="problem-grid">
          {CARDS.map((card) => (
            <div className="card problem-card cursor-glow" key={card.key} data-icon={card.icon}>
              <div className="problem-icon" aria-hidden="true">
                <ProblemIcon kind={card.icon} />
              </div>
              <h3 className="problem-title">{card.title}</h3>
              <p className="problem-text">{card.text}</p>
            </div>
          ))}
        </div>
        <p className="problem-transition">
          Every one of those is a data problem. EpicPlay AI is the fix.
        </p>
      </div>
    </section>
  );
}

function ProblemIcon({ kind }: { kind: string }) {
  if (kind === "paper") {
    return (
      <svg viewBox="0 0 64 64" width="48" height="48">
        <g className="paper-half" transform="translate(32 20)">
          <path d="M-20,-18 L20,-18 L18,4 L-18,4 Z" fill="none" stroke="#E24B4A" strokeWidth="2" />
        </g>
        <g className="paper-half" transform="translate(32 44)">
          <path d="M-18,-4 L18,-4 L20,18 L-20,18 Z" fill="none" stroke="#2ECC71" strokeWidth="2" />
        </g>
      </svg>
    );
  }
  if (kind === "question") {
    return (
      <svg viewBox="0 0 64 64" width="48" height="48">
        <text
          className="question-mark"
          x="32"
          y="42"
          textAnchor="middle"
          fontSize="40"
          fontFamily="'Barlow Condensed', sans-serif"
          fontWeight="900"
          fill="#EF9F27"
        >
          ?
        </text>
      </svg>
    );
  }
  if (kind === "dice") {
    return (
      <svg viewBox="0 0 64 64" width="48" height="48">
        <g className="dice-shape" transform="translate(32 32)">
          <rect x="-18" y="-18" width="36" height="36" rx="6" fill="none" stroke="#F0C060" strokeWidth="2" />
          <circle cx="-7" cy="-7" r="2.6" fill="#F0C060" />
          <circle cx="7" cy="7" r="2.6" fill="#F0C060" />
          <circle cx="0" cy="0" r="2.6" fill="#F0C060" />
        </g>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 64 64" width="48" height="48">
      <rect x="10" y="10" width="44" height="44" rx="4" fill="none" stroke="#9FC4AC" strokeWidth="2" />
      <g className="frame-content">
        <line x1="18" y1="24" x2="46" y2="24" stroke="#9FC4AC" strokeWidth="2" />
        <line x1="18" y1="32" x2="40" y2="32" stroke="#9FC4AC" strokeWidth="2" />
        <line x1="18" y1="40" x2="34" y2="40" stroke="#9FC4AC" strokeWidth="2" />
      </g>
    </svg>
  );
}
