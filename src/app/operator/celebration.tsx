"use client";

import { useMemo } from "react";

// Refinement pass: the two "dramatic" celebration effects, split into
// their own file since operator-console.tsx is already huge and these
// are self-contained, purely decorative particle systems -- neither
// reads or writes any app state beyond the `triggerKey` that tells them
// when to (re)fire. Both use per-particle CSS custom properties
// (--dx/--dy/etc, set inline) read by ONE shared keyframe each, rather
// than generating a unique keyframe per particle -- the standard way to
// animate many randomized trajectories without exploding the stylesheet.
// `triggerKey === 0` renders nothing (the initial/at-rest state); any
// other value remounts the particle set (key={triggerKey}) with a fresh
// batch of randomized particles and restarts the animations, the same
// flashKey-remount idiom used throughout this app for one-shot CSS
// animations.

// RBI celebration: 40 small square particles bursting from the score
// area (upper-middle of the screen, where the right panel's scoreboard
// sits) and falling with a simple simulated "gravity" (a large downward
// --dy, eased in). Real DOM particles + CSS, not a canvas/WebGL system --
// this is a tablet-first internal tool, not worth a rendering dependency
// for 40 divs.
export function ConfettiBurst({ triggerKey }: { triggerKey: number }) {
  const particles = useMemo(() => {
    const colors = ["#2ECC71", "#F0C060", "#FFFFFF"];
    return Array.from({ length: 40 }, (_, i) => ({
      id: i,
      color: colors[i % colors.length],
      leftPct: 50 + (Math.random() * 60 - 30),
      dx: Math.random() * 240 - 120,
      dy: 260 + Math.random() * 260,
      rotate: Math.random() * 720 - 360,
      delayMs: Math.random() * 200,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerKey]);

  if (triggerKey === 0) return null;

  return (
    <div key={triggerKey} className="pointer-events-none fixed inset-0 z-[9999] overflow-hidden">
      {particles.map((p) => (
        <span
          key={p.id}
          className="confetti-particle absolute h-1.5 w-1.5"
          style={
            {
              left: `${p.leftPct}%`,
              top: "18%",
              backgroundColor: p.color,
              animationDelay: `${p.delayMs}ms`,
              "--dx": `${p.dx}px`,
              "--dy": `${p.dy}px`,
              "--rot": `${p.rotate}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

// Home run celebration: 6 bursts of 12 particles each, radiating evenly
// (i/12 of a full circle) from random points on screen -- "star/circle
// shapes" per spec simplified to plain circles (rounded-full); a real
// star shape would need either an SVG per particle or a clip-path, and
// at this particle count/size a circle reads the same at a glance while
// staying cheap to render, a documented simplification rather than a
// silently-dropped requirement.
export function Fireworks({ triggerKey }: { triggerKey: number }) {
  const bursts = useMemo(() => {
    const colors = ["#F0C060", "#2ECC71", "#FFFFFF", "#E24B4A"];
    return Array.from({ length: 6 }, (_, b) => {
      const radius = 70 + Math.random() * 60;
      return {
        id: b,
        leftPct: 15 + Math.random() * 70,
        topPct: 10 + Math.random() * 50,
        delayMs: b * 150 + Math.random() * 80,
        particles: Array.from({ length: 12 }, (_, i) => {
          const angle = (i / 12) * 2 * Math.PI;
          return {
            id: i,
            dx: Math.cos(angle) * radius,
            dy: Math.sin(angle) * radius,
            color: colors[i % colors.length],
          };
        }),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerKey]);

  if (triggerKey === 0) return null;

  return (
    <div key={triggerKey} className="pointer-events-none fixed inset-0 z-[9999] overflow-hidden">
      {bursts.map((b) => (
        <div key={b.id} className="absolute" style={{ left: `${b.leftPct}%`, top: `${b.topPct}%` }}>
          {b.particles.map((p) => (
            <span
              key={p.id}
              className="firework-particle absolute h-1.5 w-1.5 rounded-full"
              style={
                {
                  backgroundColor: p.color,
                  animationDelay: `${b.delayMs}ms`,
                  "--dx": `${p.dx}px`,
                  "--dy": `${p.dy}px`,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      ))}
    </div>
  );
}
