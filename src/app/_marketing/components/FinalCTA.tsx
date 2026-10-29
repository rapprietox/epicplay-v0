"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SectionVideo } from "./SectionVideo";

gsap.registerPlugin(ScrollTrigger);

export function FinalCTA() {
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const content = sectionRef.current?.querySelector(".cta-content");
    if (!content) return;

    gsap.fromTo(
      content,
      { opacity: 0, y: 24 },
      {
        opacity: 1,
        y: 0,
        duration: 0.8,
        ease: "power2.out",
        scrollTrigger: { trigger: sectionRef.current, start: "top 70%" },
      }
    );
  }, []);

  return (
    <section className="cta-section" ref={sectionRef}>
      <SectionVideo src="/hero-video4.mp4" opacity={0.5} />

      {/* Populated field diagram, dimmed to 15% as a background accent --
          literal hex colors, not CSS vars, matching this app's established
          practice for raw SVG presentation attributes. */}
      <div className="cta-field" aria-hidden="true">
        <svg viewBox="0 0 800 700">
          <path
            d="M80,200 Q400,60 720,200"
            stroke="#1A6B3C"
            strokeWidth="2"
            fill="none"
            filter="drop-shadow(0 0 4px #1A6B3C)"
          />
          <path
            d="M400,620 L50,100"
            stroke="#2ECC71"
            strokeWidth="1"
            fill="none"
            filter="drop-shadow(0 0 4px #2ECC71)"
          />
          <path
            d="M400,620 L750,100"
            stroke="#2ECC71"
            strokeWidth="1"
            fill="none"
            filter="drop-shadow(0 0 4px #2ECC71)"
          />
          <path
            d="M400,620 L580,440 L400,260 L220,440 Z"
            stroke="#F0C060"
            strokeWidth="1"
            fill="none"
            filter="drop-shadow(0 0 4px #F0C060)"
          />
          <circle cx="400" cy="460" r="26" stroke="rgba(255,255,255,0.3)" strokeWidth="1" fill="none" />
          <g opacity="0.85">
            <rect x="250" y="280" width="90" height="90" fill="#2ECC71" opacity="0.12" />
            <rect x="340" y="280" width="90" height="90" fill="#EF9F27" opacity="0.18" />
            <rect x="430" y="280" width="90" height="90" fill="#E24B4A" opacity="0.22" />
            <rect x="250" y="370" width="90" height="90" fill="#EF9F27" opacity="0.15" />
            <rect x="340" y="370" width="90" height="90" fill="#E24B4A" opacity="0.25" />
            <rect x="430" y="370" width="90" height="90" fill="#2ECC71" opacity="0.14" />
          </g>
          <rect
            x="571"
            y="431"
            width="18"
            height="18"
            fill="#F0C060"
            transform="rotate(45 580 440)"
            filter="drop-shadow(0 0 8px rgba(240,192,96,0.8))"
          />
          <rect
            x="391"
            y="251"
            width="18"
            height="18"
            fill="#F0C060"
            transform="rotate(45 400 260)"
            filter="drop-shadow(0 0 8px rgba(240,192,96,0.8))"
          />
          <rect
            x="211"
            y="431"
            width="18"
            height="18"
            fill="#F0C060"
            transform="rotate(45 220 440)"
            filter="drop-shadow(0 0 8px rgba(240,192,96,0.8))"
          />
          <path
            d="M385,608 L415,608 L415,620 L400,634 L385,620 Z"
            fill="#EAF7EE"
            filter="drop-shadow(0 0 8px rgba(234,247,238,0.7))"
          />
          <circle cx="400" cy="460" r="4" fill="#EAF7EE" />
          <circle cx="580" cy="440" r="4" fill="#EAF7EE" />
          <circle cx="400" cy="260" r="4" fill="#EAF7EE" />
          <circle cx="220" cy="440" r="4" fill="#EAF7EE" />
          <circle cx="340" cy="150" r="4" fill="#EAF7EE" />
          <circle cx="460" cy="150" r="4" fill="#EAF7EE" />
          <circle cx="620" cy="300" r="4" fill="#EAF7EE" />
          <circle cx="180" cy="300" r="4" fill="#EAF7EE" />
          <circle cx="400" cy="560" r="4" fill="#EAF7EE" />
          <circle cx="300" cy="200" r="3" fill="#F0C060" />
          <circle cx="520" cy="190" r="3" fill="#EF9F27" />
          <circle cx="650" cy="260" r="3" fill="#2ECC71" />
          <circle cx="170" cy="260" r="3" fill="#F0C060" />
          <circle cx="400" cy="130" r="3" fill="#EF9F27" />
        </svg>
      </div>

      <div className="cta-content">
        <h2>Your War Room Is Ready.</h2>
        <p>Join the teams already using EpicPlay AI to gain the competitive edge.</p>
        <a href="/login" className="btn-primary">
          Start Your Season →
        </a>
        <a href="/login" className="cta-signin">
          Already have an account? Sign in →
        </a>
      </div>
    </section>
  );
}
