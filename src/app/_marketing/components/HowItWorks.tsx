"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const STEPS = [
  { key: "log", label: "Log", title: "Tap the result. That's it.", text: "Quick Mode logs an at-bat result in one tap -- no pitch-by-pitch required unless you want it." },
  { key: "analyze", label: "Analyze", title: "Every zone, every landing spot.", text: "Heat maps and spray charts build themselves from what you just logged." },
  { key: "win", label: "Win", title: "KAIROS tells you what it means.", text: "Lineup calls and in-game insight, rated by how much data actually backs them." },
];

const QUICK_BUTTONS = ["1B", "2B", "3B", "HR", "K", "BB"];

export function HowItWorks() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const scoreRef = useRef<HTMLSpanElement>(null);
  const runnerRef = useRef<SVGCircleElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const mm = gsap.matchMedia();

    mm.add("(min-width: 860px)", () => {
      const panels = section.querySelectorAll<HTMLElement>(".how-mock-panel");
      const dots = section.querySelectorAll<HTMLElement>(".how-dot");
      const copyBlocks = section.querySelectorAll<HTMLElement>(".how-copy-block");
      const logBtns = section.querySelectorAll<HTMLElement>(".log-btn");
      const zones = section.querySelectorAll<HTMLElement>(".how-zone-cell");
      const sprayDot = section.querySelector<HTMLElement>(".how-spray-dot");
      const kairosLine = section.querySelector<HTMLElement>(".how-kairos-line");
      const lineupFlip = section.querySelector<HTMLElement>(".how-lineup-flip");

      gsap.set(panels, { autoAlpha: 0 });
      gsap.set(panels[0], { autoAlpha: 1 });
      gsap.set(copyBlocks, { autoAlpha: 0, y: 16 });
      gsap.set(copyBlocks[0], { autoAlpha: 1, y: 0 });

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          start: "top top",
          end: "+=300%",
          scrub: true,
          pin: true,
          anticipatePin: 1,
          onUpdate: (self) => {
            const idx = Math.min(2, Math.floor(self.progress * 3));
            dots.forEach((d, i) => d.classList.toggle("active", i === idx));
          },
        },
      });

      // --- Segment 1: Log (0 -> 1) ---
      logBtns.forEach((btn, i) => {
        tl.to(btn, { backgroundColor: "#2ECC71", color: "#030A06", duration: 0.08 }, 0.1 + i * 0.1)
          .to(btn, { backgroundColor: "transparent", color: "#EAF7EE", duration: 0.08 }, 0.1 + i * 0.1 + 0.08);
      });
      if (runnerRef.current) {
        const bases: [number, number][] = [[50, 92], [78, 64], [50, 36], [22, 64]];
        bases.forEach(([x, y], i) => {
          tl.to(runnerRef.current, { attr: { cx: x, cy: y }, duration: 0.15 }, 0.15 + i * 0.15);
        });
      }
      tl.call(() => { if (scoreRef.current) scoreRef.current.textContent = "0"; }, undefined, 0)
        .call(() => { if (scoreRef.current) scoreRef.current.textContent = "1"; }, undefined, 0.55)
        .call(() => { if (scoreRef.current) scoreRef.current.textContent = "2"; }, undefined, 0.85);

      // --- Crossfade 1 -> 2 ---
      tl.to(panels[0], { autoAlpha: 0, duration: 0.08 }, 0.95)
        .to(panels[1], { autoAlpha: 1, duration: 0.08 }, 0.95)
        .to(copyBlocks[0], { autoAlpha: 0, y: -12, duration: 0.08 }, 0.95)
        .to(copyBlocks[1], { autoAlpha: 1, y: 0, duration: 0.08 }, 1.0);

      // --- Segment 2: Analyze (1 -> 2) ---
      zones.forEach((zone, i) => {
        tl.to(zone, { autoAlpha: 1, duration: 0.05 }, 1.1 + i * 0.07);
      });
      if (sprayDot) {
        tl.fromTo(
          sprayDot,
          { autoAlpha: 0, attr: { cx: 50, cy: 85 } },
          { autoAlpha: 1, attr: { cx: 72, cy: 38 }, duration: 0.3, ease: "power2.out" },
          1.65
        );
      }

      // --- Crossfade 2 -> 3 ---
      tl.to(panels[1], { autoAlpha: 0, duration: 0.08 }, 1.95)
        .to(panels[2], { autoAlpha: 1, duration: 0.08 }, 1.95)
        .to(copyBlocks[1], { autoAlpha: 0, y: -12, duration: 0.08 }, 1.95)
        .to(copyBlocks[2], { autoAlpha: 1, y: 0, duration: 0.08 }, 2.0);

      // --- Segment 3: Win (2 -> 3) ---
      if (kairosLine) {
        const full = kairosLine.dataset.full ?? "";
        tl.to(
          { progress: 0 },
          {
            progress: 1,
            duration: 0.5,
            ease: "none",
            onUpdate: function () {
              const n = Math.floor((this.targets()[0] as { progress: number }).progress * full.length);
              kairosLine.textContent = full.slice(0, n);
            },
          },
          2.15
        );
      }
      if (lineupFlip) {
        tl.to(lineupFlip, { rotateY: 180, duration: 0.25, ease: "power1.inOut" }, 2.7);
      }

      return () => {
        tl.kill();
      };
    });

    mm.add("(max-width: 859px)", () => {
      const steps = section.querySelectorAll<HTMLElement>(".how-mobile-step");
      const reveal = gsap.fromTo(
        steps,
        { opacity: 0, y: 24 },
        {
          opacity: 1,
          y: 0,
          duration: 0.6,
          stagger: 0.15,
          ease: "power2.out",
          scrollTrigger: { trigger: section, start: "top 80%" },
        }
      );
      return () => {
        reveal.scrollTrigger?.kill();
        reveal.kill();
      };
    });

    return () => mm.revert();
  }, []);

  return (
    <section className="how-section section-full" id="how-it-works" ref={sectionRef}>
      <div className="section how-inner">
        <div className="how-head">
          <h2 className="section-headline headline-white">Log. Analyze. Win.</h2>
        </div>

        {/* Desktop pinned story */}
        <div className="how-pin-stage" aria-hidden="false">
          <div className="how-dots">
            {STEPS.map((s, i) => (
              <div className={`how-dot ${i === 0 ? "active" : ""}`} key={s.key}>
                <span className="how-dot-mark" />
                <span className="how-dot-label">{s.label}</span>
              </div>
            ))}
          </div>

          <div className="how-copy-col">
            {STEPS.map((s) => (
              <div className="how-copy-block" key={s.key}>
                <p className="how-step-eyebrow">{s.label}</p>
                <h3 className="how-step-title">{s.title}</h3>
                <p className="how-step-text">{s.text}</p>
              </div>
            ))}
          </div>

          <div className="how-mock-col">
            {/* Panel 1: Log */}
            <div className="how-mock-panel glossy" data-panel="log">
              <div className="log-grid">
                {QUICK_BUTTONS.map((b) => (
                  <div className="log-btn" key={b}>
                    {b}
                  </div>
                ))}
              </div>
              <svg className="log-diamond" viewBox="0 0 100 110" aria-hidden="true">
                <path d="M50,92 L78,64 L50,36 L22,64 Z" fill="none" stroke="#1A3D28" strokeWidth="2" />
                <circle cx="50" cy="92" r="9" fill="#2ECC71" ref={runnerRef} />
              </svg>
              <div className="log-score-row">
                <span className="log-score-label">SCORE</span>
                <span className="log-score" ref={scoreRef}>
                  0
                </span>
              </div>
            </div>

            {/* Panel 2: Analyze */}
            <div className="how-mock-panel glossy" data-panel="analyze">
              <div className="how-zone-grid">
                {Array.from({ length: 9 }).map((_, i) => (
                  <div className="how-zone-cell" key={i} style={{ background: ZONE_COLORS[i] }} />
                ))}
              </div>
              <svg className="how-spray-mini" viewBox="0 0 100 100" aria-hidden="true">
                <path d="M50,96 L10,30 M50,96 L90,30 M50,96 Q50,10 50,10" fill="none" stroke="#1A3D28" strokeWidth="1.5" />
                <circle className="how-spray-dot" cx="50" cy="85" r="4" fill="#F0C060" />
              </svg>
            </div>

            {/* Panel 3: Win */}
            <div className="how-mock-panel glossy" data-panel="win">
              <div className="how-kairos-card">
                <p className="how-kairos-label">KAIROS</p>
                <p className="how-kairos-line" data-full="Move Carlos Mendoza to slot 2 -- his OBP vs this type of pitching is your best on-base option.">
                  {" "}
                </p>
              </div>
              <div className="how-lineup-flip-wrap">
                <div className="how-lineup-flip">
                  <div className="how-lineup-face how-lineup-front">Slot 1: ?</div>
                  <div className="how-lineup-face how-lineup-back">
                    <span style={{ color: "#2ECC71" }}>✅ GOOD</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile stacked fallback */}
        <div className="how-mobile-stack">
          {STEPS.map((s) => (
            <div className="card how-mobile-step cursor-glow" key={s.key}>
              <p className="how-step-eyebrow">{s.label}</p>
              <h3 className="how-step-title">{s.title}</h3>
              <p className="how-step-text">{s.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const ZONE_COLORS = [
  "rgba(46,204,113,0.5)",
  "rgba(240,192,96,0.5)",
  "rgba(226,75,74,0.4)",
  "rgba(239,159,39,0.5)",
  "rgba(46,204,113,0.65)",
  "rgba(240,192,96,0.35)",
  "rgba(226,75,74,0.55)",
  "rgba(46,204,113,0.4)",
  "rgba(240,192,96,0.6)",
];
