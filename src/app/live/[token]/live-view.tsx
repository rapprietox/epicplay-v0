"use client";

import { useEffect, useRef, useState } from "react";

type RunnerDisplay = { key: string; label: string; jersey: string | null } | null;

interface NarrationEntry {
  id: string;
  text: string;
  ts: string;
  outPlayerId?: string;
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

// viewBox + base positions mirror the operator's own diamond
// (src/app/operator/baserunner-diamond.tsx) for the same "Dark EpicPlay
// style" look -- a fresh, standalone component rather than importing
// that one, since this feature isn't allowed to touch the operator
// console and that component takes a required onBaseTap it has no use
// for here.
const BASE_POS = {
  first: { x: 156, y: 124 },
  second: { x: 100, y: 68 },
  third: { x: 44, y: 124 },
} as const;
type Base = keyof typeof BASE_POS;

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

export function LiveView({ token }: { token: string }) {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [burstKeys, setBurstKeys] = useState<Record<string, Base>>({});
  const prevRunnersRef = useRef<Record<string, Base>>({});
  const seenNarrationIdsRef = useRef<Set<string>>(new Set());
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
          (["first", "second", "third"] as const).forEach((base) => {
            const r = json.runners[base];
            if (r) newRunners[r.key] = base;
          });

          // A runner key present before but gone now: burst only if a
          // narration entry newly seen this poll says OUR player was
          // put out while on base (outPlayerId). Anything else
          // (scored, or an opponent runner's unresolvable out --
          // see the API route's own comment) just disappears quietly.
          const outPlayerIds = new Set(
            json.narration.filter((n) => n.outPlayerId && !seenNarrationIdsRef.current.has(n.id)).map((n) => n.outPlayerId)
          );
          json.narration.forEach((n) => seenNarrationIdsRef.current.add(n.id));

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
            }, 650);
          }
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
          <Diamond runners={snapshot.runners} burstKeys={burstKeys} reducedMotion={reducedMotion} />
          {snapshot.currentBatterName && (
            <div className="mt-3 text-center">
              <p className="text-xs uppercase tracking-wide text-foreground/50">Now batting</p>
              <p className="font-heading text-lg font-semibold text-white">{snapshot.currentBatterName}</p>
              {snapshot.currentBatterWalkUpSong && (
                <p className="text-xs italic text-accent-gold">{snapshot.currentBatterWalkUpSong}</p>
              )}
            </div>
          )}
        </>
      )}
      <NarrationFeed entries={snapshot.narration} />
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
        <span
          key={i}
          className={`h-2.5 w-2.5 rounded-full border border-accent-red ${i < outs ? "bg-accent-red" : "bg-transparent"}`}
        />
      ))}
    </span>
  );
}

function Diamond({
  runners,
  burstKeys,
  reducedMotion,
}: {
  runners: LiveSnapshotFound["runners"];
  burstKeys: Record<string, Base>;
  reducedMotion: boolean;
}) {
  const occupied = (["first", "second", "third"] as const).filter((b) => runners[b]);

  return (
    <section className="glossy rounded-lg border border-border bg-surface p-4">
      <svg viewBox="0 0 200 200" className="h-56 w-full">
        <path d="M 100 180 L 156 124 L 100 68 L 44 124 Z" fill="none" stroke="#1A3D28" strokeWidth="3" />
        {(["first", "second", "third"] as const).map((base) => {
          const pos = BASE_POS[base];
          const runner = runners[base];
          return (
            <g key={base}>
              <rect
                x={pos.x - 16}
                y={pos.y - 16}
                width={32}
                height={32}
                transform={`rotate(45 ${pos.x} ${pos.y})`}
                fill={runner ? "#2ECC71" : "#0A2214"}
                stroke={runner ? "#2ECC71" : "#1A3D28"}
                strokeWidth="2"
                style={runner ? { filter: "drop-shadow(0 0 5px #2ECC71)" } : undefined}
              />
            </g>
          );
        })}
        <rect x="90" y="170" width="20" height="20" transform="rotate(45 100 180)" fill="#0A2214" stroke="#1A3D28" strokeWidth="2" />

        {/* Runner dots: one <g> per runner identity (keyed by the API's
            stable `key`), transform-translated to its current base.
            Keeping the same key across polls is what lets the CSS
            transition below slide it rather than teleport it. */}
        {occupied.map((base) => {
          const r = runners[base];
          if (!r) return null;
          const pos = BASE_POS[base];
          return (
            <g
              key={r.key}
              transform={`translate(${pos.x}, ${pos.y})`}
              style={reducedMotion ? undefined : { transition: "transform 500ms ease" }}
            >
              <circle r={18} fill="#F0C060" stroke="#030A06" strokeWidth="1.2" style={{ filter: "drop-shadow(0 0 6px rgba(240,192,96,0.9))" }} />
              <text y={6} textAnchor="middle" fontSize="16" fontWeight="bold" fill="#030A06">
                {r.jersey ?? "•"}
              </text>
              <text y={34} textAnchor="middle" fontSize="11" fill="#C8F0D5">
                {r.label}
              </text>
            </g>
          );
        })}

        {/* Burst overlays: a brief expanding-ring + fade at the last
            known base of a runner caught stealing / picked off / run
            down / out advancing / out on appeal. Suppressed entirely
            under prefers-reduced-motion (burstKeys is only ever
            populated when !reducedMotion -- see the polling effect). */}
        {Object.entries(burstKeys).map(([key, base]) => {
          const pos = BASE_POS[base];
          return (
            <circle key={key} cx={pos.x} cy={pos.y} r={18} fill="none" stroke="#E24B4A" strokeWidth="3" className="live-burst" />
          );
        })}
      </svg>

      <style>{`
        @keyframes live-burst-anim {
          0% { r: 18; opacity: 1; }
          100% { r: 42; opacity: 0; }
        }
        .live-burst { animation: live-burst-anim 600ms ease-out forwards; }
        @media (prefers-reduced-motion: reduce) {
          .live-burst { animation: none; display: none; }
        }
      `}</style>
    </section>
  );
}

function NarrationFeed({ entries }: { entries: NarrationEntry[] }) {
  return (
    <section className="glossy rounded-lg border border-border bg-surface p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-foreground/50">Play by play</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {entries.length === 0 && <li className="text-sm text-foreground/40">No plays logged yet.</li>}
        {entries.map((e) => (
          <li key={e.id} className="text-sm text-foreground/90">
            {e.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
