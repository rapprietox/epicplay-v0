"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const LINES: { text: string; gold: boolean }[] = [
  { text: "The teams that win in October", gold: false },
  { text: "are the ones who paid attention", gold: false },
  { text: "in September.", gold: true },
];

export function TheSignal() {
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const words = sectionRef.current?.querySelectorAll(".signal-word");
    if (!words?.length) return;

    gsap.fromTo(
      words,
      { opacity: 0, y: 20 },
      {
        opacity: 1,
        y: 0,
        duration: 0.5,
        stagger: 0.08,
        ease: "power2.out",
        scrollTrigger: { trigger: sectionRef.current, start: "top 60%" },
      }
    );
  }, []);

  return (
    <section className="signal-section" ref={sectionRef}>
      <div>
        <blockquote className="signal-quote">
          {LINES.map((line, lineIdx) => (
            <span key={line.text} style={{ display: "block" }}>
              {line.text.split(" ").map((word, wordIdx) => (
                <span
                  key={`${lineIdx}-${wordIdx}`}
                  className={`signal-word ${line.gold ? "gold" : ""}`}
                >
                  {word}
                </span>
              ))}
            </span>
          ))}
        </blockquote>
        <cite className="signal-cite">— EpicPlay AI</cite>
      </div>
    </section>
  );
}
