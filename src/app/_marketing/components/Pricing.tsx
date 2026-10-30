"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { CONTACT_EMAIL } from "@/lib/legal";

gsap.registerPlugin(ScrollTrigger);

// Purchasability, checked against the actual code before writing this:
// - Free: everything a coach/operator needs to run a season is already
//   live with no payment gate anywhere in the schema or RLS -- real,
//   available today.
// - Team Pro: no Stripe subscription product exists in this codebase
//   (only a one-time Clubhouse Pro checkout does). Not purchasable
//   today -- its button scrolls to the lead form instead of /login.
// - Clubhouse Pro: a real Stripe Checkout session
//   (src/app/player/clubhouse/actions.ts, one-time payment) exists and
//   works today, but only from inside the app after a player signs in
//   -- there's no public checkout entry point on the marketing site
//   itself, so this card still links to /login, same as Free.
const PLANS = [
  {
    name: "Free",
    price: "$0",
    period: "/month",
    features: [
      "Live game logging",
      "Heat maps & spray charts",
      "Lineup intelligence",
      "Opponent scouting",
      "KAIROS chat for coaches",
      "Scorebook PDF",
    ],
    cta: "Start Your Season →",
    href: "/login",
    ghost: true,
  },
  {
    name: "Team Pro ⭐",
    price: "$49.99",
    period: "/month",
    note: "Founding-team pricing -- not billed yet",
    features: [
      "Everything in Free",
      "Priority support",
      "Early access to new features as we build them",
      "A direct line to shape the roadmap",
    ],
    cta: "Join founding teams →",
    href: "#lead-form",
    featured: true,
  },
  {
    name: "Clubhouse Pro",
    price: "$9.99",
    period: " one-time",
    note: "Per player",
    features: [
      "Personal Clubhouse page",
      "All heat maps & spray charts",
      "AI coaching notes",
      "EPS score",
      "Personal KAIROS chat (20/mo)",
    ],
    cta: "Unlock Now →",
    href: "/login",
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
          <p className="pricing-founding-line">Founding teams get early access and shape the product.</p>
        </div>
        <div className="pricing-grid">
          {PLANS.map((plan) => (
            <div className={`pricing-card cursor-glow ${plan.featured ? "featured" : ""}`} key={plan.name}>
              {plan.featured && <span className="pricing-badge">Most Popular</span>}
              <p className="pricing-plan-name">{plan.name}</p>
              <p className="pricing-price">
                {plan.price}
                <span style={{ fontSize: "0.8rem", color: "#5e8268" }}>{plan.period}</span>
              </p>
              {plan.note && <p className="pricing-note">{plan.note}</p>}
              <ul className="pricing-features">
                {plan.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <a href={plan.href} className={plan.featured ? "btn-primary" : "btn-ghost"} style={{ textAlign: "center" }}>
                {plan.cta}
              </a>
            </div>
          ))}
        </div>
        <p className="pricing-foot">
          Need a league plan? Multiple teams, one platform.{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>Contact us →</a>
        </p>
      </div>
    </section>
  );
}
