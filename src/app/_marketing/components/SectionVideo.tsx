"use client";

import { useEffect, useRef } from "react";

interface SectionVideoProps {
  src: string;
  opacity?: number;
  loop?: boolean;
  className?: string;
}

// A per-section accent video -- unlike the hero's always-on background
// loop, this only plays while scrolled into view (and pauses once it
// leaves), so it reads as a moment the section reveals rather than
// something looping behind the fold the whole time. Renders absolutely
// positioned at inset:0 (see .section-video in marketing.css) -- the
// parent section/column must set position: relative (and usually
// overflow: hidden) for that to size correctly.
export function SectionVideo({ src, opacity = 0.6, loop = true, className }: SectionVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || typeof IntersectionObserver === "undefined") return;

    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          video.play().catch((e) => console.error(`Section video play failed (${src}):`, e));
        } else {
          video.pause();
        }
      },
      { threshold: 0.3 }
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [src]);

  return (
    <video
      ref={videoRef}
      className={className ?? "section-video"}
      muted
      playsInline
      loop={loop}
      style={{ opacity }}
      aria-hidden="true"
    >
      <source src={src} type="video/mp4" />
    </video>
  );
}
