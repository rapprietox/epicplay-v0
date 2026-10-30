"use client";

import { useState } from "react";

type RoleKey = "coach" | "operator" | "player";

const ROLES: {
  key: RoleKey;
  label: string;
  title: string;
  bullets: string[];
  mock: RoleKey;
}[] = [
  {
    key: "coach",
    label: "Coach",
    title: "Lineup intelligence and opponent scouting.",
    bullets: [
      "Live lineup feedback rated EXCELLENT to BLUNDER, with a reliability score behind every call.",
      "Heat maps and spray charts for every player, built from what's already logged.",
      "AI post-game analysis -- especially after a loss, so you know what actually went wrong.",
      "Opponent scouting built from the games you've already logged against them.",
    ],
    mock: "coach",
  },
  {
    key: "operator",
    label: "Operator",
    title: "Quick Mode vs. Full Mode -- your call, every game.",
    bullets: [
      "Quick Mode logs a result in one tap when the game is moving fast.",
      "Full Mode captures every pitch -- type, location, and outcome -- for the full picture.",
      "Smart baserunner tracking with a suggested advance you can override in one tap.",
      "Runs from any phone or tablet's browser. No extra hardware or sensors.",
    ],
    mock: "operator",
  },
  {
    key: "player",
    label: "Player",
    title: "The Clubhouse -- your stats, your edge.",
    bullets: [
      "Your own season stats, game history, and heat maps in one place.",
      "EPS -- a single number that tracks your performance across the season.",
      "AI coaching notes and drill suggestions built from your own zone data (Clubhouse Pro).",
      "A personal KAIROS chat scoped to your own stats -- never another player's data.",
    ],
    mock: "player",
  },
];

export function ByRole() {
  const [active, setActive] = useState<RoleKey>("coach");
  const role = ROLES.find((r) => r.key === active) ?? ROLES[0];

  return (
    <section className="by-role-section section-full" id="by-role">
      <div className="section">
        <div className="by-role-head">
          <h2 className="section-headline headline-white">Built for everyone on your team.</h2>
        </div>

        <div className="by-role-tabs">
          {ROLES.map((r) => (
            <button
              key={r.key}
              type="button"
              className={`by-role-tab ${active === r.key ? "active" : ""}`}
              onClick={() => setActive(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="by-role-panel">
          <div className="by-role-copy">
            <p className="role-eyebrow">For the {role.label}</p>
            <h3 className="by-role-title">{role.title}</h3>
            <ul className="role-list">
              {role.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
          <div className="by-role-mock cursor-glow">
            <RoleMock kind={role.mock} />
          </div>
        </div>
      </div>
    </section>
  );
}

function RoleMock({ kind }: { kind: RoleKey }) {
  if (kind === "coach") {
    return (
      <div className="role-mock-inner">
        <p className="role-mock-label">Live Lineup Feedback</p>
        <div className="role-mock-row">
          <span>Slot 1 -- Marcus Johnson</span>
          <span className="role-mock-chip" style={{ color: "#2ECC71", borderColor: "#2ECC71" }}>
            ✅ GOOD
          </span>
        </div>
        <div className="role-mock-row">
          <span>Slot 4 -- Diego Reyes</span>
          <span className="role-mock-chip" style={{ color: "#E24B4A", borderColor: "#E24B4A" }}>
            💀 BLUNDER
          </span>
        </div>
      </div>
    );
  }
  if (kind === "operator") {
    return (
      <div className="role-mock-inner">
        <p className="role-mock-label">Quick Mode</p>
        <div className="role-mock-grid">
          {["1B", "2B", "HR", "K"].map((b) => (
            <div className="role-mock-btn" key={b}>
              {b}
            </div>
          ))}
        </div>
        <p className="role-mock-sub">One tap per result -- or switch to Full Mode for every pitch.</p>
      </div>
    );
  }
  return (
    <div className="role-mock-inner">
      <p className="role-mock-label">Carlos Mendoza&apos;s Clubhouse</p>
      <div className="role-mock-row">
        <span>EPS</span>
        <span style={{ color: "#F0C060", fontWeight: 900 }}>78 · Elite 🔥</span>
      </div>
      <p className="role-mock-sub">Sample data -- drill suggestion: two-strike approach on low-outside pitches.</p>
    </div>
  );
}
