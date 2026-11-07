"use client";

import { useEffect, useRef, useState } from "react";
import { parabolaPath, TRAJECTORY_STYLE } from "@/lib/trajectory";
import type { LineHitCategory } from "@/lib/heat-map";
import { LIVE_BASE_POS, LIVE_FIELD_CALIBRATION, fielderPositionFromDot } from "@/lib/live/field";
import { narrateStolenBaseForBase } from "@/lib/live/narration";

type RunnerDisplay = { key: string; label: string; jersey: string | null } | null;

interface NarrationEntry {
  id: string;
  text: string;
  ts: string;
  outPlayerId?: string;
  stolenBasePlayerId?: string;
  stolenBaseRunnerName?: string;
  fieldX?: number | null;
  fieldY?: number | null;
  hitType?: string | null;
  isCaughtBall?: boolean;
  isHomeRun?: boolean;
}

interface LiveSnapshotFound {
  found: true;
  status: "setup" | "active" | "completed" | "cancelled";
  teamName: string;
  opponentName: string;
  homeAway: "home" | "away";
  gameDate: string;
  ourScore: number;
  opponentScore: number;
  inning: number;
  inningHalf: "top" | "bottom";
  outs: number;
  mode: "hitting" | "pitching";
  runners: { first: RunnerDisplay; second: RunnerDisplay; third: RunnerDisplay };
  currentBatterName: string | null;
  currentBatterWalkUpSong: string | null;
  narration: NarrationEntry[];
  updatedAt: string;
}
type LiveSnapshot = LiveSnapshotFound | { found: false };

const POLL_MS = 3000;

type Base = keyof typeof LIVE_BASE_POS;
const BASES: Base[] = ["first", "second", "third"];

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function trajectoryCategoryFor(entry: NarrationEntry): LineHitCategory {
  if (entry.isHomeRun) return "hr";
  if (entry.hitType === "flyball" || entry.hitType === "groundball" || entry.hitType === "linedrive" || entry.hitType === "popup") {
    return entry.hitType;
  }
  return "other"; // Quick Mode's null hit_type -- the spec's own "generic arc" case
}

interface BallFlight {
  key: number;
  path: string;
  endX: number;
  endY: number;
  style: (typeof TRAJECTORY_STYLE)[LineHitCategory];
}
interface FielderCatch {
  key: number;
  x: number;
  y: number;
  label: string;
}

export function LiveView({ token }: { token: string }) {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [burstKeys, setBurstKeys] = useState<Record<string, Base>>({});
  const [ballFlight, setBallFlight] = useState<BallFlight | null>(null);
  const [fielderCatch, setFielderCatch] = useState<FielderCatch | null>(null);
  const [batterBurstKey, setBatterBurstKey] = useState<number | null>(null);
  const [stolenBaseText, setStolenBaseText] = useState<Record<string, string>>({});
  const prevRunnersRef = useRef<Record<string, Base>>({});
  const seenNarrationIdsRef = useRef<Set<string>>(new Set());
  const animKeyRef = useRef(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch(`/api/live/${token}`, { cache: "no-store" });
        const json: LiveSnapshot = await res.json();
        if (stopped) return;
        setSnapshot(json);

        if (json.found) {
          const newRunners: Record<string, Base> = {};
          BASES.forEach((base) => {
            const r = json.runners[base];
            if (r) newRunners[r.key] = base;
          });

          const newlySeen = json.narration.filter((n) => !seenNarrationIdsRef.current.has(n.id));

          // A runner key present before but gone now: burst only if a
          // narration entry newly seen this poll says OUR player was
          // put out while on base (outPlayerId). Anything else
          // (scored, or an opponent runner's unresolvable out --
          // see the API route's own comment) just disappears quietly.
          const outPlayerIds = new Set(newlySeen.filter((n) => n.outPlayerId).map((n) => n.outPlayerId));
          const bursts: Record<string, Base> = {};
          for (const [key, base] of Object.entries(prevRunnersRef.current)) {
            if (newRunners[key]) continue;
            const playerId = key.startsWith("player:") ? key.slice("player:".length) : null;
            if (playerId && outPlayerIds.has(playerId) && !reducedMotion) {
              bursts[key] = base;
            }
          }
          if (Object.keys(bursts).length > 0) {
            setBurstKeys((prev) => ({ ...prev, ...bursts }));
            setTimeout(() => {
              setBurstKeys((prev) => {
                const next = { ...prev };
                for (const k of Object.keys(bursts)) delete next[k];
                return next;
              });
            }, 900);
          }

          // Steals: stolen_bases has no "to which base" column -- comparing
          // this player's base just before this poll (prevRunnersRef, still
          // the PREVIOUS poll's map at this point) against just after
          // (newRunners) is the only place that comparison is actually
          // possible. Computed once, the moment the steal is first seen,
          // and kept -- recomputing on a later poll could see the runner
          // having moved again for an unrelated reason and mislabel it.
          const newStolenBaseText: Record<string, string> = {};
          for (const n of newlySeen) {
            if (!n.stolenBasePlayerId || !n.stolenBaseRunnerName) continue;
            const key = `player:${n.stolenBasePlayerId}`;
            const before = prevRunnersRef.current[key];
            const after = newRunners[key];
            if (after === "second" || after === "third") {
              newStolenBaseText[n.id] = narrateStolenBaseForBase(n.id, n.stolenBaseRunnerName, after);
            } else if (before && !after) {
              // A stolen_bases row only exists for a SUCCESSFUL steal (a
              // caught stealing is a separate game_events row) -- no
              // longer on any base right after one means they scored.
              newStolenBaseText[n.id] = narrateStolenBaseForBase(n.id, n.stolenBaseRunnerName, "home");
            }
          }
          if (Object.keys(newStolenBaseText).length > 0) {
            setStolenBaseText((prev) => ({ ...prev, ...newStolenBaseText }));
          }

          // Ball flight: the single most recent newly-seen at-bat with a
          // saved dot. Skipped entirely under prefers-reduced-motion,
          // same "suppressed, not just slowed" treatment the runner-out
          // burst already gets.
          if (!reducedMotion) {
            const ballEntry = newlySeen.find((n) => n.fieldX != null && n.fieldY != null);
            if (ballEntry && ballEntry.fieldX != null && ballEntry.fieldY != null) {
              const category = trajectoryCategoryFor(ballEntry);
              const style = TRAJECTORY_STYLE[category];
              const home = LIVE_FIELD_CALIBRATION.home_plate;
              const { d, endX, endY } = parabolaPath(home.x, home.y, ballEntry.fieldX, ballEntry.fieldY, style.peakPct, style.overshootFactor);
              animKeyRef.current += 1;
              const key = animKeyRef.current;
              setBallFlight({ key, path: d, endX, endY, style });
              setTimeout(() => setBallFlight((cur) => (cur?.key === key ? null : cur)), style.durationMs + 1200);

              if (ballEntry.isCaughtBall) {
                setTimeout(() => {
                  setFielderCatch({ key, x: ballEntry.fieldX as number, y: ballEntry.fieldY as number, label: fielderPositionFromDot(ballEntry.fieldX as number, ballEntry.fieldY as number) });
                  setBatterBurstKey(key);
                  setTimeout(() => setFielderCatch((cur) => (cur?.key === key ? null : cur)), 1800);
                  setTimeout(() => setBatterBurstKey((cur) => (cur === key ? null : cur)), 900);
                }, style.durationMs);
              }
            }
          }

          newlySeen.forEach((n) => seenNarrationIdsRef.current.add(n.id));
          prevRunnersRef.current = newRunners;
        }

        const shouldStop = json.found && (json.status === "completed" || json.status === "cancelled");
        if (!stopped && !shouldStop) {
          timer = setTimeout(poll, POLL_MS);
        }
      } catch {
        if (!stopped) timer = setTimeout(poll, POLL_MS);
      }
    }

    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [token, reducedMotion]);

  if (!snapshot) {
    return <Shell><p className="text-center text-sm text-foreground/50">Loading game…</p></Shell>;
  }

  if (!snapshot.found) {
    return (
      <Shell>
        <p className="text-center text-sm text-foreground/60">
          This live link isn&apos;t available. It may have been turned off, or the address may be wrong.
        </p>
      </Shell>
    );
  }

  const isDone = snapshot.status === "completed" || snapshot.status === "cancelled";

  return (
    <Shell>
      <Scoreboard snapshot={snapshot} isDone={isDone} />
      {!isDone && (
        <>
          <Stadium
            runners={snapshot.runners}
            burstKeys={burstKeys}
            ballFlight={ballFlight}
            fielderCatch={fielderCatch}
            batterBurstKey={batterBurstKey}
            reducedMotion={reducedMotion}
          />
          {snapshot.currentBatterName && (
            <div className="text-center">
              <p className="text-xs uppercase tracking-wide text-foreground/50">Now batting</p>
              <p className="font-heading text-lg font-semibold text-white">{snapshot.currentBatterName}</p>
            </div>
          )}
        </>
      )}
      <NarrationFeed entries={snapshot.narration} overrides={stolenBaseText} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground">
      <div className="mx-auto flex max-w-md flex-col gap-4">{children}</div>
    </main>
  );
}

function Scoreboard({ snapshot, isDone }: { snapshot: LiveSnapshotFound; isDone: boolean }) {
  return (
    <section className="glossy rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <span className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${isDone ? "text-foreground/50" : "text-accent-green"}`}>
          {isDone ? "Final" : "Live"}
        </span>
        {!isDone && <span className="text-[10px] uppercase tracking-wide text-foreground/50">updates every 3s</span>}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3 text-center">
        <div>
          <p className="truncate text-sm text-foreground/70">{snapshot.teamName}</p>
          <p className="font-heading text-4xl font-black text-accent-gold">{snapshot.ourScore}</p>
        </div>
        <div>
          <p className="truncate text-sm text-foreground/70">{snapshot.opponentName}</p>
          <p className="font-heading text-4xl font-black text-white">{snapshot.opponentScore}</p>
        </div>
      </div>
      {!isDone && (
        <div className="mt-3 flex items-center justify-center gap-4 text-sm">
          <span className="font-semibold text-white">
            {snapshot.inningHalf === "top" ? "Top" : "Bot"} {ordinal(snapshot.inning)}
          </span>
          <OutsDots outs={snapshot.outs} />
          <span className="text-xs capitalize text-foreground/60">{snapshot.mode === "hitting" ? "batting" : "fielding"}</span>
        </div>
      )}
    </section>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

function OutsDots({ outs }: { outs: number }) {
  return (
    <span className="flex items-center gap-1" aria-label={`${outs} outs`}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={`h-2.5 w-2.5 rounded-full border border-accent-red ${i < outs ? "bg-accent-red" : "bg-transparent"}`} />
      ))}
    </span>
  );
}

// Bigger, nicer explosion than Phase 1's single thin ring: a fast inner
// flash, a thicker primary ring, and a slower-fading outer ring, plus a
// small radiating starburst (the same 8-line idea PlayerSprayChart's
// home-run decoration already uses) -- one shared shape used for both
// a runner caught on the bases and a batter retired on a caught ball.
function Burst({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={3} fill="#F0C060" className="live-burst-flash" />
      <circle cx={x} cy={y} r={3} fill="none" stroke="#E24B4A" strokeWidth={2.2} className="live-burst-ring-1" />
      <circle cx={x} cy={y} r={3} fill="none" stroke="#E24B4A" strokeWidth={1.4} opacity={0.6} className="live-burst-ring-2" />
      {Array.from({ length: 8 }).map((_, k) => {
        const angle = (k / 8) * Math.PI * 2;
        return (
          <line
            key={k}
            x1={x}
            y1={y}
            x2={x + Math.cos(angle) * 1.2}
            y2={y + Math.sin(angle) * 1.2}
            stroke="#F0C060"
            strokeWidth={0.6}
            strokeLinecap="round"
            className="live-burst-spark"
            style={{ ["--spark-dx" as string]: `${Math.cos(angle) * 9}`, ["--spark-dy" as string]: `${Math.sin(angle) * 9}` }}
          />
        );
      })}
    </g>
  );
}

function Stadium({
  runners,
  burstKeys,
  ballFlight,
  fielderCatch,
  batterBurstKey,
  reducedMotion,
}: {
  runners: LiveSnapshotFound["runners"];
  burstKeys: Record<string, Base>;
  ballFlight: BallFlight | null;
  fielderCatch: FielderCatch | null;
  batterBurstKey: number | null;
  reducedMotion: boolean;
}) {
  const occupied = BASES.filter((b) => runners[b]);
  const home = LIVE_FIELD_CALIBRATION.home_plate;

  return (
    <section className="glossy relative aspect-[16/9] w-full overflow-hidden rounded-lg border border-border">
      <div
        className="absolute inset-0"
        style={{ backgroundImage: "url('/field-3d.png')", backgroundSize: "cover", backgroundPosition: "center" }}
      />
      <div className="pointer-events-none absolute inset-0" style={{ background: "rgba(3,10,6,0.25)" }} />

      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        {/* Base markers -- no diamond/base-path lines drawn (the stadium
            photo already paints its own dirt basepaths); lit when
            occupied, matching the old diamond's green-glow treatment. */}
        {BASES.map((base) => {
          const pos = LIVE_BASE_POS[base];
          const isOccupied = Boolean(runners[base]);
          return (
            <rect
              key={base}
              x={pos.x - 2.2}
              y={pos.y - 2.2}
              width={4.4}
              height={4.4}
              transform={`rotate(45 ${pos.x} ${pos.y})`}
              fill={isOccupied ? "#2ECC71" : "rgba(10,34,20,0.5)"}
              stroke={isOccupied ? "#2ECC71" : "rgba(26,61,40,0.8)"}
              strokeWidth={0.4}
              style={isOccupied ? { filter: "drop-shadow(0 0 2px #2ECC71)" } : undefined}
            />
          );
        })}

        {/* Ball trajectory -- reuses PlayerSprayChart's own arc/glow
            shape per hit type (src/lib/trajectory.ts), home plate to the
            saved dot. Keyed so a new play always restarts the animation
            rather than jump-cutting mid-flight. */}
        {ballFlight && (
          <g key={ballFlight.key}>
            <path
              d={ballFlight.path}
              fill="none"
              stroke={ballFlight.style.color}
              strokeWidth={ballFlight.style.strokeWidth}
              strokeLinecap="round"
              pathLength={1}
              style={{
                strokeDasharray: 1,
                strokeDashoffset: reducedMotion ? 0 : 1,
                animation: reducedMotion ? "none" : `live-ball-draw ${ballFlight.style.durationMs}ms ease-out forwards`,
                filter: ballFlight.style.glow,
              }}
            />
            <circle r={2.4} fill={ballFlight.style.color} style={{ filter: ballFlight.style.glow }}>
              <animateMotion dur={`${ballFlight.style.durationMs}ms`} fill="freeze" path={ballFlight.path} />
            </circle>
            {ballFlight.style.starburst &&
              Array.from({ length: 8 }).map((_, k) => {
                const angle = (k / 8) * Math.PI * 2;
                return (
                  <line
                    key={k}
                    x1={ballFlight.endX}
                    y1={ballFlight.endY}
                    x2={ballFlight.endX + Math.cos(angle) * 5}
                    y2={ballFlight.endY + Math.sin(angle) * 5}
                    stroke="#F0C060"
                    strokeWidth={0.7}
                    strokeLinecap="round"
                    style={{ animation: `live-hr-starburst 0.5s ease-out ${ballFlight.style.durationMs}ms forwards` }}
                  />
                );
              })}
          </g>
        )}

        {/* Fielder catching the ball -- placed at the saved dot, labeled
            with the position worked out from that dot via the same
            field-zone logic the operator's own at-bat notation uses. */}
        {fielderCatch && (
          <g key={fielderCatch.key} style={{ animation: "live-fielder-in 250ms ease-out" }}>
            <circle cx={fielderCatch.x} cy={fielderCatch.y} r={3.4} fill="#0A2214" stroke="#F0C060" strokeWidth={0.6} />
            <text x={fielderCatch.x} y={fielderCatch.y + 1.3} textAnchor="middle" fontSize="3" fontWeight="bold" fill="#F0C060">
              {fielderCatch.label}
            </text>
          </g>
        )}

        {/* The batter, implicitly standing at home plate -- only ever
            rendered as a burst the instant a caught ball retires them;
            otherwise there's nothing to draw there (the runners already
            cover "who's on base"). */}
        {batterBurstKey !== null && <Burst x={home.x} y={home.y} />}

        {/* Runner dots: one <g> per runner identity (keyed by the API's
            stable `key`), transform-translated to its current base.
            Keeping the same key across polls is what lets the CSS
            transition below slide it rather than teleport it -- the
            runner slide itself is unchanged from Phase 1, just replotted
            onto the stadium's own base positions. */}
        {occupied.map((base) => {
          const r = runners[base];
          if (!r) return null;
          const pos = LIVE_BASE_POS[base];
          return (
            <g key={r.key} transform={`translate(${pos.x}, ${pos.y})`} style={reducedMotion ? undefined : { transition: "transform 500ms ease" }}>
              <circle r={3.6} fill="#F0C060" stroke="#030A06" strokeWidth={0.3} style={{ filter: "drop-shadow(0 0 3px rgba(240,192,96,0.9))" }} />
              <text y={1.2} textAnchor="middle" fontSize="3.2" fontWeight="bold" fill="#030A06">
                {r.jersey ?? "•"}
              </text>
              <text y={6.5} textAnchor="middle" fontSize="2.3" fill="#C8F0D5" style={{ paintOrder: "stroke", stroke: "#030A06", strokeWidth: 0.6 }}>
                {r.label}
              </text>
            </g>
          );
        })}

        {/* Runner-out bursts: bigger, nicer explosion (see Burst above). */}
        {Object.entries(burstKeys).map(([key, base]) => {
          const pos = LIVE_BASE_POS[base];
          return <Burst key={key} x={pos.x} y={pos.y} />;
        })}
      </svg>

      <style>{`
        @keyframes live-ball-draw { to { stroke-dashoffset: 0; } }
        @keyframes live-hr-starburst { 0% { opacity: 0; } 25% { opacity: 1; } 100% { opacity: 0; } }
        @keyframes live-fielder-in { 0% { opacity: 0; transform: scale(0.4); } 100% { opacity: 1; transform: scale(1); } }
        .live-burst-flash { animation: live-burst-flash-anim 250ms ease-out forwards; }
        .live-burst-ring-1 { animation: live-burst-ring-anim 700ms ease-out forwards; }
        .live-burst-ring-2 { animation: live-burst-ring-anim 950ms ease-out 80ms forwards; }
        .live-burst-spark { animation: live-burst-spark-anim 700ms ease-out forwards; }
        @keyframes live-burst-flash-anim { 0% { r: 1; opacity: 1; } 100% { r: 9; opacity: 0; } }
        @keyframes live-burst-ring-anim { 0% { r: 3; opacity: 1; } 100% { r: 16; opacity: 0; } }
        @keyframes live-burst-spark-anim {
          0% { opacity: 1; transform: translate(0, 0); }
          100% { opacity: 0; transform: translate(calc(var(--spark-dx) * 1px), calc(var(--spark-dy) * 1px)); }
        }
        @media (prefers-reduced-motion: reduce) {
          .live-burst-flash, .live-burst-ring-1, .live-burst-ring-2, .live-burst-spark { animation: none; display: none; }
        }
      `}</style>
    </section>
  );
}

function NarrationFeed({ entries, overrides }: { entries: NarrationEntry[]; overrides: Record<string, string> }) {
  return (
    <section className="glossy rounded-lg border border-border bg-surface p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-foreground/50">Play by play</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {entries.length === 0 && <li className="text-sm text-foreground/40">No plays logged yet.</li>}
        {entries.map((e) => (
          <li key={e.id} className="text-sm text-foreground/90">
            {overrides[e.id] ?? e.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
