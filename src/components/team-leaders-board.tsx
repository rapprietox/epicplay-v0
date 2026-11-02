"use client";

import { useState } from "react";
import Link from "next/link";
import { StatIcon } from "@/app/coach/stat-icons";
import { EpsInfoTrigger } from "./eps-info-panel";
import type { LeaderRow, RankedPlayer } from "@/lib/leader-stats";

// Same-cards batch: the card grid + ranking modal shared by the coach
// Team Leaders Board and the player Clubhouse's read-only Team Leaders
// board -- same component, not just the same stat list, so the two
// can't drift apart visually either. The coach board keeps its own
// filter dropdowns and heading around this; the player board renders
// it directly with no filters.
//
// getPlayerHref decides whether a ranking-modal row links anywhere:
// the coach board links every row to /coach/players/[id]; the player
// board links only the viewer's own row back to /player/clubhouse
// (null for everyone else -- a player has no separate profile route).
export function TeamLeadersBoard({ rows, getPlayerHref }: { rows: LeaderRow[]; getPlayerHref: (playerId: string) => string | null }) {
  const [selected, setSelected] = useState<LeaderRow | null>(null);

  return (
    <>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => {
          const hasData = row.value !== null && row.leaders.length > 0;
          const shown = row.leaders.length > 3 ? row.leaders.slice(0, 2) : row.leaders;
          const extraCount = row.leaders.length > 3 ? row.leaders.length - 2 : 0;
          const emptyText = row.rateQualification ? "Not enough games yet" : "No data yet";

          return (
            <div
              key={row.label}
              role="button"
              tabIndex={0}
              onClick={() => setSelected(row)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setSelected(row);
              }}
              className="block w-full cursor-pointer text-left transition hover:brightness-110"
            >
              <StatDivider label={row.label}>
                <p className="pl-4 text-[14px]" style={{ fontFamily: "var(--font-sans)", color: "#8AABCC" }}>
                  {hasData ? (
                    <>
                      {shown.map((l, idx) => (
                        <span key={l.playerId}>
                          {idx > 0 && " · "}
                          <span style={{ color: "#F0C060" }}>#{l.playerJersey ?? "—"}</span> {l.playerName}
                        </span>
                      ))}
                      {extraCount > 0 && <span> and {extraCount} more</span>}
                    </>
                  ) : (
                    emptyText
                  )}
                </p>
                <p
                  className="text-center leading-none"
                  style={{ fontFamily: "var(--font-heading)", fontWeight: 900, fontSize: 52, color: "#F0C060", opacity: hasData ? 1 : 0.35 }}
                >
                  {hasData ? row.format(row.value as number) : "—"}
                </p>
              </StatDivider>
            </div>
          );
        })}
      </div>

      {selected && <LeaderModal row={selected} getPlayerHref={getPlayerHref} onClose={() => setSelected(null)} />}
    </>
  );
}

function barPct(value: number, leaderValue: number, lowerIsBetter: boolean): number {
  if (leaderValue === 0) return lowerIsBetter ? (value === 0 ? 100 : 0) : 0;
  const ratio = lowerIsBetter ? leaderValue / value : value / leaderValue;
  return Math.max(0, Math.min(100, ratio * 100));
}

function RankedRow({ r, i, leaderValue, row, getPlayerHref, onClose }: { r: RankedPlayer; i: number | null; leaderValue: number; row: LeaderRow; getPlayerHref: (id: string) => string | null; onClose: () => void }) {
  const href = getPlayerHref(r.playerId);
  const content = (
    <>
      <span className="w-5 shrink-0 text-right text-xs text-foreground/40">{i !== null ? i + 1 : "—"}</span>
      <span className="w-24 shrink-0 truncate text-sm text-white">
        <span style={{ color: "#F0C060" }}>#{r.playerJersey ?? "—"}</span> {r.playerName}
      </span>
      {r.qualified ? (
        <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/10">
          <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${barPct(r.value, leaderValue, row.lowerIsBetter)}%`, backgroundColor: "#2ECC71" }} />
        </span>
      ) : (
        <span className="flex-1 truncate text-xs text-foreground/40">
          {row.format(r.value)} · {r.shortfall} more {row.rateQualification === "ip" ? "IP" : "PA"} needed
        </span>
      )}
      {r.qualified && <span className="w-12 shrink-0 text-right font-mono text-sm text-accent-gold">{row.format(r.value)}</span>}
    </>
  );
  const className = `flex items-center gap-3 rounded-md px-2 py-2 ${r.qualified ? "" : "opacity-50"}`;
  return href ? (
    <Link href={href} onClick={onClose} className={`${className} transition hover:bg-white/5`}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}

function LeaderModal({ row, getPlayerHref, onClose }: { row: LeaderRow; getPlayerHref: (id: string) => string | null; onClose: () => void }) {
  const qualified = row.ranking.filter((r) => r.qualified);
  const unqualified = row.rateQualification ? row.ranking.filter((r) => !r.qualified) : [];
  const leaderValue = qualified[0]?.value ?? row.ranking[0]?.value ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="glossy max-h-[80vh] w-full max-w-md overflow-y-auto rounded-lg border-2 p-5"
        style={{ backgroundColor: "#080E08", borderColor: "#2ECC71" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-1.5 font-heading text-xl font-bold uppercase tracking-wide text-white">
            {row.label}
            {row.label === "Performance Score" && <EpsInfoTrigger />}
          </h3>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md px-2 py-1 text-foreground/50 transition hover:text-white">
            ✕
          </button>
        </div>

        {row.ranking.length === 0 ? (
          <p className="mt-4 text-sm text-foreground/50">No qualifying players yet.</p>
        ) : (
          <>
            <div className="mt-4 flex flex-col gap-2">
              {qualified.map((r, i) => (
                <RankedRow key={r.playerId} r={r} i={i} leaderValue={leaderValue} row={row} getPlayerHref={getPlayerHref} onClose={onClose} />
              ))}
              {qualified.length === 0 && <p className="text-sm text-foreground/50">Not enough games yet.</p>}
            </div>

            {unqualified.length > 0 && (
              <>
                <p className="mt-5 text-xs uppercase tracking-wide text-foreground/40">Not enough at-bats yet</p>
                <div className="mt-2 flex flex-col gap-2">
                  {unqualified.map((r) => (
                    <RankedRow key={r.playerId} r={r} i={null} leaderValue={leaderValue} row={row} getPlayerHref={getPlayerHref} onClose={onClose} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Team Leaders Board card chrome -- a thin hairline with the stat name
// floated on top of it, same treatment on both boards now.
function StatDivider({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-h-[100px]" style={{ backgroundColor: "#080E08", padding: "8px 12px" }}>
      <div className="relative h-px w-full" style={{ backgroundColor: "#1A3D28" }}>
        <span
          className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 whitespace-nowrap px-2 uppercase"
          style={{ backgroundColor: "#080E08", color: "#2ECC71", fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.15em", textShadow: "0 0 8px #2ECC71, 0 0 16px rgba(46,204,113,0.4)" }}
        >
          <StatIcon label={label} />
          {label}
        </span>
      </div>
      <div className="flex flex-col justify-center gap-1 py-2">{children}</div>
      <div className="h-px w-full" style={{ backgroundColor: "#1A3D28" }} />
    </div>
  );
}
