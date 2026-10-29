"use client";

import { useEffect } from "react";
import { gsap } from "gsap";

// Three.js was removed entirely to isolate the hero video from the
// field-overlay question -- turned out neither the canvas nor this
// markup was the actual bug: middleware was redirecting the video
// request itself for anonymous visitors (see src/lib/supabase/
// middleware.ts). Confirmed fixed with this simplified version, so the
// 3D field stays out for now; reintroduce it deliberately, not blind,
// if/when it's wanted back.
export function Hero() {
  useEffect(() => {
    gsap.fromTo(
      ".hero-content",
      { opacity: 0, y: 30 },
      { opacity: 1, y: 0, duration: 1.2, ease: "power2.out", delay: 2 }
    );
  }, []);

  return (
    <section
      className="hero-section"
      style={{
        position: "relative",
        width: "100%",
        height: "100vh",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#030A06",
      }}
    >
      {/* VIDEO -- nothing covers this */}
      <video
        autoPlay
        muted
        loop
        playsInline
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: 0.75,
          zIndex: 0,
        }}
      >
        <source src="/hero-video.mp4" type="video/mp4" />
      </video>

      {/* Dark overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(3,10,6,0.4)",
          zIndex: 1,
        }}
      />

      {/* Content */}
      <div
        className="hero-content"
        style={{
          position: "relative",
          zIndex: 10,
          textAlign: "center",
          padding: "0 24px",
          opacity: 0,
        }}
      >
        <div className="hero-wordmark">
          <span className="wordmark-ball">⚾</span>
          <span className="wordmark-epic">EPICPLAY</span>
          <span className="wordmark-ai">AI</span>
        </div>
        <p className="hero-tagline">The Intelligence Layer Amateur Baseball Has Been Missing.</p>
        <div className="hero-buttons">
          <a href="/login" className="btn-primary">
            Start Your Season →
          </a>
          <a href="#platform" className="btn-ghost">
            See How It Works ↓
          </a>
        </div>
      </div>

      {/* Skip button */}
      <button
        type="button"
        className="hero-skip"
        onClick={() => {
          const content = document.querySelector(".hero-content") as HTMLElement | null;
          if (content) {
            content.style.opacity = "1";
            content.style.transform = "translateY(0)";
          }
        }}
      >
        Skip →
      </button>

      {/* Scroll indicator */}
      <div className="scroll-indicator">
        <div className="scroll-line" />
        <span>Scroll</span>
      </div>
    </section>
  );
}
