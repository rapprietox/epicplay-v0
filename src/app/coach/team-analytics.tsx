"use client";

import { useEffect, useMemo, useState } from "react";
import { computeZoneBattingLines, zoneColor, SPRAY_CATEGORY_COLOR, type AtBatWithZone, type SprayDot } from "@/lib/heat-map";
import { formatAvg } from "@/lib/stats";
import { formatGameDate } from "@/lib/dates";

export function TeamAnalytics({
  zoneAtBats,
  sprayDots,
  opponentNames,
  nextOpponentName,
}: {
  zoneAtBats: AtBatWithZone[];
  sprayDots: SprayDot[];
  opponentNames: string[];
  nextOpponentName: string | null;
}) {
  const [revealed, setRevealed] = useState(false);
  const [opponentFilter, setOpponentFilter] = useState<string>("all");
  const [selected, setSelected] = useState<SprayDot | null>(null);

  const lines = useMemo(() => computeZoneBattingLines(zoneAtBats), [zoneAtBats]);

  const weakestZoneIndex = useMemo(() => {
    let worstIndex = -1;
    let worstAvg = Infinity;
    lines.forEach((line, i) => {
      if (line.ab >= 3 && line.avg < worstAvg) {
        worstAvg = line.avg;
        worstIndex = i;
      }
    });
    return worstIndex;
  }, [lines]);

  const filteredDots = useMemo(
    () => (opponentFilter === "all" ? sprayDots : sprayDots.filter((d) => d.opponentName === opponentFilter)),
    [sprayDots, opponentFilter]
  );

  useEffect(() => {
    setRevealed(false);
    const t = setTimeout(() => setRevealed(true), 50);
    return () => clearTimeout(t);
  }, [zoneAtBats]);

  return (
    <section className="glossy rounded-lg border border-border bg-surface p-5">
      <h2 className="font-heading text-xl font-bold uppercase tracking-wide text-white">Team Analytics</h2>

      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-foreground/40">Team Batting Average by Zone</p>
          <div className="mx-auto mt-3 grid w-full max-w-[240px] grid-cols-3 grid-rows-3 gap-1 rounded-md border-2 border-border bg-background p-1">
            {lines.map((line, i) => (
              <div
                key={i}
                className={`flex aspect-square flex-col items-center justify-center rounded transition-colors duration-700 ${
                  i === weakestZoneIndex ? "ring-2 ring-accent-red" : ""
                }`}
                style={{ backgroundColor: revealed ? zoneColor(line) : "#1A3D28" }}
              >
                {line.ab > 0 ? (
                  <>
                    <span className="font-heading text-base font-bold text-background">{formatAvg(line.avg)}</span>
                    <span className="text-[9px] text-background/70">{line.ab} AB</span>
                  </>
                ) : (
                  <span className="text-[10px] text-foreground/30">—</span>
                )}
              </div>
            ))}
          </div>

          {weakestZoneIndex >= 0 && (
            <div className="mt-3 rounded-md border border-accent-red/50 bg-accent-red/10 p-3 text-center">
              <p className="text-xs font-semibold uppercase tracking-wide text-accent-red">Weakness Finder</p>
              <p className="mt-1 text-sm text-white">
                Weakest zone: {formatAvg(lines[weakestZoneIndex].avg)}
                {nextOpponentName ? ` — expect it targeted against ${nextOpponentName}` : " — expect pitchers to target it"}
              </p>
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide text-foreground/40">Team Spray Chart</p>
            <select
              value={opponentFilter}
              onChange={(e) => {
                setOpponentFilter(e.target.value);
                setSelected(null);
              }}
              className="rounded border border-border bg-background px-2 py-1 text-xs text-white"
            >
              <option value="all">All opponents</option>
              {opponentNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <svg viewBox="0 0 100 100" className="mx-auto mt-3 w-full max-w-[280px] rounded-md border border-border bg-background">
            <path d="M 50 92 L 8 50 A 60 60 0 0 1 92 50 Z" fill="#2D5A1B" stroke="#1A3D28" strokeWidth="0.5" />
            <path d="M 50 92 L 28 70 A 32 32 0 0 1 72 70 Z" fill="#3A7A25" />
            <rect x="35" y="35" width="24" height="24" fill="#A9814B" transform="rotate(45 50 62)" opacity="0.85" />
            {filteredDots.map((d, i) => (
              <circle
                key={i}
                cx={d.x}
                cy={d.y}
                r={selected === d ? 2.2 : 1.4}
                fill={SPRAY_CATEGORY_COLOR[d.category]}
                className="cursor-pointer"
                style={selected === d ? { filter: "drop-shadow(0 0 4px #00FF7F)" } : undefined}
                onClick={() => setSelected(d === selected ? null : d)}
              />
            ))}
          </svg>

          {selected ? (
            <p className="mt-2 text-center text-xs text-foreground/60">
              <span className="capitalize text-white">{selected.result.replace("_", " ")}</span> &middot; Inning {selected.inning} &middot;{" "}
              {selected.gameDate ? formatGameDate(selected.gameDate) : "—"} &middot; vs {selected.opponentName}
            </p>
          ) : (
            <p className="mt-2 text-center text-xs text-foreground/40">
              {filteredDots.length === 0 ? "No balls in play for this filter." : "Tap a dot for details."}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
