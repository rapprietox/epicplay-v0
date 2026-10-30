"use client";

import { useMemo, useState } from "react";
import { calculateReliability } from "@/lib/reliability";

// Drives the meter with the real calculateReliability() formula from
// src/lib/reliability.ts -- not a re-invented threshold set. AB and
// opponent counts scale proportionally with the games slider (8 AB/game,
// one new opponent roughly every 3 games, capped at 5) purely to give
// the slider something plausible to feed the real formula; the formula
// itself, its score, and its four tier labels/colors are exactly what
// ships in the app.
const COLOR_HEX: Record<string, string> = {
  red: "#E24B4A",
  amber: "#EF9F27",
  green: "#2ECC71",
  diamond: "#8AABCC",
};

const BAND_COPY: { color: string; range: string; meaning: string }[] = [
  { color: "red", range: "Under 30%", meaning: "Very early data. Treat any suggestion as a starting point, not an answer." },
  { color: "amber", range: "30-60%", meaning: "A pattern is emerging, but it could still shift as more games come in." },
  { color: "green", range: "61-85%", meaning: "A real pattern, backed by consistent data across games and opponents." },
  { color: "diamond", range: "86%+", meaning: "Deep dataset. High confidence in what the recommendation is telling you." },
];

export function ReliabilitySection() {
  const [games, setGames] = useState(6);

  const result = useMemo(() => {
    const totalAB = games * 8;
    const opponentsCount = Math.min(5, Math.ceil(games / 3));
    return calculateReliability({ totalAB, gamesPlayed: games, opponentsCount });
  }, [games]);

  const color = COLOR_HEX[result.color];

  return (
    <section className="reliability-section section-full" id="reliability">
      <div className="section">
        <div className="reliability-head">
          <h2 className="section-headline headline-white">
            Most tools guess confidently. <span className="headline-gold">KAIROS tells you how sure it is.</span>
          </h2>
          <p className="reliability-sub">
            Drag the slider below -- this runs the exact same reliability formula the app uses, live.
          </p>
        </div>

        <div className="card reliability-card cursor-glow">
          <div className="reliability-meter-wrap">
            <div className="reliability-meter-track">
              <div
                className="reliability-meter-fill"
                style={{ width: `${result.score}%`, background: color, boxShadow: `0 0 24px ${color}` }}
              />
            </div>
            <div className="reliability-meter-labels">
              <span>🔴 0%</span>
              <span>🟡 30%</span>
              <span>🟢 60%</span>
              <span>💎 86%</span>
              <span>100%</span>
            </div>
          </div>

          <div className="reliability-readout" style={{ color }}>
            {result.score}% Reliable -- {result.label}
          </div>
          <p className="reliability-description">{result.description}</p>

          <input
            type="range"
            min={2}
            max={15}
            step={1}
            value={games}
            onChange={(e) => setGames(Number(e.target.value))}
            className="reliability-slider"
            aria-label="Games played"
          />
          <div className="reliability-slider-labels">
            <span>2 games</span>
            <span>15 games</span>
          </div>
        </div>

        <div className="reliability-bands">
          {BAND_COPY.map((b) => (
            <div className="reliability-band" key={b.color}>
              <p className="reliability-band-range" style={{ color: COLOR_HEX[b.color] }}>
                {b.range}
              </p>
              <p className="reliability-band-meaning">{b.meaning}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
