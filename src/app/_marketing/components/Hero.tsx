"use client";

import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";

// Three.js was removed entirely to isolate the hero video from the
// field-overlay question -- turned out neither the canvas nor this
// markup was the actual bug: middleware was redirecting the video
// request itself for anonymous visitors (see src/lib/supabase/
// middleware.ts). Confirmed fixed with this simplified version, so the
// 3D field stays out for now; reintroduce it deliberately, not blind,
// if/when it's wanted back.
//
// Mobile hero video: the source is picked in JS (matchMedia), not via
// <source media="...">, because browsers mostly ignore that attribute
// on <video> once a source has already loaded -- it's reliable for
// <picture>/<img>, not for video. The choice lives in state and starts
// as null so the <video> element itself doesn't render (and therefore
// doesn't start fetching anything) until that choice is made -- a
// phone never requests the wide desktop file even for an instant.
const MOBILE_QUERY = "(max-width: 768px)";

export function Hero() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    gsap.fromTo(
      ".hero-content",
      { opacity: 0, y: 30 },
      { opacity: 1, y: 0, duration: 1.2, ease: "power2.out", delay: 2 }
    );
  }, []);

  // Pick (and keep picking, across a phone rotation or a desktop
  // window resize past the breakpoint) which file to load.
  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    function apply(mobile: boolean) {
      setIsMobile(mobile);
      setSrc(mobile ? "/hero-video-mobile.mp4" : "/hero-video.mp4");
    }
    const onChange = (e: MediaQueryListEvent) => apply(e.matches);
    apply(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  // iOS/Android autoplay: React's `muted` prop sets the attribute but
  // not always the live DOM property in time for the browser's autoplay
  // gate, which checks the property -- so it's set directly here too,
  // alongside an explicit play() call whose rejection (Low Power Mode,
  // a browser blocking autoplay outright, etc.) is caught instead of
  // left as an unhandled promise rejection. On rejection, a tap or
  // scroll anywhere on the page retries play() once, then stops trying.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;

    let retryBound = false;
    function tryPlay() {
      video?.play().catch(() => {
        if (retryBound) return;
        retryBound = true;
        const retry = () => {
          video?.play().catch(() => {});
          window.removeEventListener("touchstart", retry);
          window.removeEventListener("scroll", retry);
        };
        window.addEventListener("touchstart", retry, { once: true, passive: true });
        window.addEventListener("scroll", retry, { once: true, passive: true });
      });
    }
    tryPlay();
  }, [src]);

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
      {/* VIDEO -- nothing covers this. The gradient background shows
          through if autoplay is blocked and no frame has painted yet,
          so the hero never looks like a blank green rectangle. */}
      {src && (
        <video
          key={src}
          ref={videoRef}
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
            background: "linear-gradient(135deg, #0A2214, #030A06)",
          }}
        >
          <source src={src} type="video/mp4" />
        </video>
      )}

      {/* Dark overlay -- slightly stronger on mobile, where the 9:16
          video fills the whole screen behind the wordmark/buttons and
          needs a bit more contrast than the desktop crop does. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: isMobile ? "rgba(3,10,6,0.55)" : "rgba(3,10,6,0.4)",
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

    </section>
  );
}
