"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const PLANS = [
  {
    name: "Free",
    price: "$0",
    period: "/month",
    features: ["1 game/month", "Basic stats", "Team leaders", "Scorebook PDF"],
    cta: "Get Started",
    ghost: true,
  },
  {
    name: "Team Pro ⭐",
    price: "$49.99",
    period: "/month",
    features: [
      "Unlimited games",
      "Full analytics",
      "All 3 heat maps",
      "Spray charts",
      "Lineup AI",
      "KAIROS chat",
      "Opponent scouting",
      "Post-game analysis",
    ],
    cta: "Start Season →",
    featured: true,
  },
  {
    name: "Clubhouse Pro",
    price: "$9.99",
    period: " one-time",
    features: [
      "Per player",
      "Personal page",
      "All 3 heat maps",
      "AI coaching",
      "Drill plans",
      "EPS score",
      "KAIROS (20/mo)",
    ],
    cta: "Unlock Now →",
    ghost: true,
  },
];

export function Pricing() {
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cards = sectionRef.current?.querySelectorAll(".pricing-card");
    if (!cards?.length) return;

    gsap.fromTo(
      cards,
      { opacity: 0, y: 32 },
      {
        opacity: 1,
        y: 0,
        duration: 0.7,
        stagger: 0.12,
        ease: "power2.out",
        scrollTrigger: { trigger: sectionRef.current, start: "top 75%" },
      }
    );
  }, []);

  return (
    <section className="section-full" id="pricing" ref={sectionRef}>
      <div className="section">
        <div className="data-head" style={{ marginBottom: 0 }}>
          <h2 className="section-headline headline-white">Simpler Than You Think.</h2>
        </div>
        <div className="pricing-grid">
          {PLANS.map((plan) => (
            <div
              className={`pricing-card ${plan.featured ? "featured" : ""}`}
              key={plan.name}
            >
              {plan.featured && <span className="pricing-badge">Most Popular</span>}
              <p className="pricing-plan-name">{plan.name}</p>
              <p className="pricing-price">
                {plan.price}
                <span style={{ fontSize: "0.8rem", color: "#5e8268" }}>{plan.period}</span>
              </p>
              <ul className="pricing-features">
                {plan.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <a
                href="/login"
                className={plan.featured ? "btn-primary" : "btn-ghost"}
                style={{ textAlign: "center" }}
              >
                {plan.cta}
              </a>
            </div>
          ))}
        </div>
        <p className="pricing-foot">
          Need a league plan? Multiple teams, one platform.{" "}
          <a href="mailto:hello@epicplayai.com">Contact us →</a>
        </p>
      </div>
    </section>
  );
}
