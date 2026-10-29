"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const ROLES = [
  {
    eyebrow: "For the Coach 🧠",
    title: "Strategy. Intelligence. Advantage.",
    items: [
      "AI lineup recommendations before every game",
      "Heat maps showing exactly where to attack",
      "Post-game loss analysis from KAIROS",
      "Opponent pitcher profiles built automatically",
    ],
  },
  {
    eyebrow: "For the Operator ⚡",
    title: "Every play. Two seconds. Done.",
    items: [
      "Log at-bats in Quick Mode or Full pitch tracking",
      "Smart baserunner tracking with auto-advance",
      "Works on any phone, any field, any conditions",
      "Real-time scoreboard and game management",
    ],
  },
  {
    eyebrow: "For the Player ⚾",
    title: "Your personal analytics. Your edge.",
    items: [
      "Personal Clubhouse with your complete stats",
      "AI coaching report based on YOUR heat map data",
      "Specific drill recommendations for YOUR weaknesses",
      "EPS score — your single career performance number",
    ],
  },
];

export function Platform() {
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cards = sectionRef.current?.querySelectorAll(".role-card");
    if (!cards?.length) return;

    gsap.fromTo(
      cards,
      { opacity: 0, y: 32 },
      {
        opacity: 1,
        y: 0,
        duration: 0.7,
        stagger: 0.15,
        ease: "power2.out",
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top 75%",
        },
      }
    );
  }, []);

  return (
    <section className="section-full platform-section" id="platform" ref={sectionRef}>
      <div className="section">
        <div className="platform-head">
          <h2 className="section-headline headline-white">Built for Everyone on Your Team.</h2>
        </div>
        <div className="role-grid">
          {ROLES.map((role) => (
            <div className="card role-card" key={role.eyebrow}>
              <p className="role-eyebrow">{role.eyebrow}</p>
              <h3>{role.title}</h3>
              <ul className="role-list">
                {role.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
