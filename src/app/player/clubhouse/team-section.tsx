"use client";

import { useState } from "react";
import Link from "next/link";
import { formatGameDate } from "@/lib/dates";
import { resultLetter } from "@/lib/opponent-history";
import { computeBattingLines, computePitchingLines, formatAvg, type BattingLine, type PitchingLine } from "@/lib/stats";
import { computeEpsForRoster } from "@/lib/eps";
import { StatIcon } from "@/app/coach/stat-icons";
import type { Database } from "@/lib/supabase/types";

type Game = Database["public"]["Tables"]["games"]["Row"];
type Player = Database["public"]["Tables"]["players"]["Row"];
type AtBat = Database["public"]["Tables"]["at_bats"]["Row"];
type StolenBase = Database["public"]["Tables"]["stolen_bases"]["Row"];
type GameEvent = Pick<Database["public"]["Tables"]["game_events"]["Row"], "event_type" | "player_id" | "game_id">;

interface Props {
  games: Game[];
  players: Player[];
  atBats: AtBat[];
  stolenBases: StolenBase[];
  gameEvents: GameEvent[];
  viewerPlayerId: string;
}

// Player team-view batch: a read-only mirror of three pieces of the
// coach dashboard (Team Leaders board, Last Game card, season
// schedule + record) for the player's own Clubhouse. Deliberately a
// fresh, self-contained component rather than importing/modifying
// anything under src/app/coach -- the request was explicit that no
// coach file gets touched, and the one coach-side behavior this
// genuinely can't reuse unmodified is LeaderboardModal's per-row link
// (every row links to /coach/players/[id] there; here only the
// viewer's own row may link anywhere, everyone else is plain text).
// Same underlying computations (computeBattingLines/computePitchingLines/
// computeEpsForRoster) as the coach's own board, so the numbers agree --
// not a second, separately-derived source of truth.
export function TeamSection({ games, players, atBats, stolenBases, gameEvents, viewerPlayerId }: Props) {
  const hitting = atBats.filter((ab) => ab.mode === "hitting");
  const pitching = atBats.filter((ab) => ab.mode === "pitching");
  const battingLines = computeBattingLines(hitting, stolenBases);
  const pitchingLines = computePitchingLines(pitching, games);
  const epsLines = computeEpsForRoster(players.map((p) => p.id), hitting, gameEvents);

  const completed = games.filter((g) => g.status === "completed");
  const wins = completed.filter((g) => g.our_score > g.opponent_score).length;
  const losses = completed.filter((g) => g.our_score < g.opponent_score).length;
  const ties = completed.length - wins - losses;
  const record = `${wins}-${losses}${ties > 0 ? `-${ties}` : ""}`;

  const lastGame = [...completed].sort((a, b) => b.game_date.localeCompare(a.game_date))[0] ?? null;
  const upcomingAndPast = [...games].sort((a, b) => a.game_date.localeCompare(b.game_date));

  const rows = buildLeaderRows(players, battingLines, pitchingLines, epsLines);

  return (
    <section className="flex flex-col gap-4">
      <div className="rounded-md border border-accent-amber/30 bg-accent-amber/5 px-4 py-2 text-center text-xs text-accent-amber">
        Stats are updated after each game and may be corrected as we finish setting up.
      </div>

      {lastGame && (
        <section className="glossy rounded-lg border border-border bg-surface p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-primary">Last Game</p>
          <h2 className="font-heading mt-2 text-xl font-bold text-white">
            vs {lastGame.opponent_name} — {formatGameDate(lastGame.game_date)}
          </h2>
          <p className="mt-1 text-sm text-foreground/60">
            {lastGame.our_score}&ndash;{lastGame.opponent_score}
            {(() => {
              const r = resultLetter(lastGame);
              return r ? (
                <span className={`ml-2 font-heading font-semibold ${r === "W" ? "text-accent-green" : r === "L" ? "text-accent-red" : "text-foreground/60"}`}>{r}</span>
              ) : null;
            })()}
          </p>
        </section>
      )}

      <section className="glossy rounded-lg border border-border bg-surface p-5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-primary">Season Schedule</p>
          <p className="text-sm font-semibold text-accent-gold">Record: {record}</p>
        </div>
        <ul className="mt-3 flex flex-col divide-y divide-border">
          {upcomingAndPast.map((g) => {
            const r = resultLetter(g);
            return (
              <li key={g.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="text-foreground/70">
                  {formatGameDate(g.game_date)} · {g.home_away === "home" ? "vs" : "@"} {g.opponent_name}
                </span>
                <span className="font-mono text-xs text-foreground/50">
                  {g.status === "completed" ? (
                    <>
                      {g.our_score}&ndash;{g.opponent_score}{" "}
                      <span className={r === "W" ? "text-accent-green" : r === "L" ? "text-accent-red" : "text-foreground/60"}>{r}</span>
                    </>
                  ) : g.status === "cancelled" ? (
                    "Cancelled"
                  ) : (
                    g.game_time ?? "TBD"
                  )}
                </span>
              </li>
            );
          })}
          {upcomingAndPast.length === 0 && <li className="py-2 text-sm text-foreground/40">No games on the schedule yet.</li>}
        </ul>
      </section>

      <TeamLeaders rows={rows} viewerPlayerId={viewerPlayerId} />
    </section>
  );
}

// -- Team Leaders -----------------------------------------------------

interface Leader {
  playerId: string;
  playerName: string;
  playerJersey: number | null;
}
interface RankedPlayer extends Leader {
  value: number;
}
interface LeaderRow {
  label: string;
  value: number | null;
  leaders: Leader[];
  ranking: RankedPlayer[];
  format: (v: number) => string;
  lowerIsBetter: boolean;
}

function buildRanking<T>(
  players: Player[],
  lines: Map<string, T>,
  getValue: (line: T) => number,
  hasQualified: (line: T) => boolean,
  lowerIsBetter: boolean
): RankedPlayer[] {
  const entries: RankedPlayer[] = [];
  for (const player of players) {
    const line = lines.get(player.id);
    if (!line || !hasQualified(line)) continue;
    const value = getValue(line);
    if (!Number.isFinite(value)) continue;
    entries.push({ playerId: player.id, playerName: player.name, playerJersey: player.jersey_number, value });
  }
  entries.sort((a, b) => (lowerIsBetter ? a.value - b.value : b.value - a.value));
  return entries;
}

function leadersFromRanking(ranking: RankedPlayer[], lowerIsBetter: boolean): { value: number | null; leaders: Leader[] } {
  const topValue = ranking[0]?.value ?? null;
  if (topValue === null || (topValue === 0 && !lowerIsBetter)) return { value: null, leaders: [] };
  return { value: topValue, leaders: ranking.filter((r) => r.value === topValue) };
}

// Same stat set as the coach's Team Leaders board (src/app/coach/leaders-board.tsx)
// -- kept in sync by hand since this is a deliberately separate,
// read-only file (see this file's own top comment).
function buildLeaderRows(
  players: Player[],
  battingLines: Map<string, BattingLine>,
  pitchingLines: Map<string, PitchingLine>,
  epsLines: Map<string, number | null>
): LeaderRow[] {
  const battingHasAb = (l: BattingLine) => l.ab > 0;
  const battingHasPa = (l: BattingLine) => l.ab + l.bb + l.hbp > 0;
  const pitchingHasIp = (l: PitchingLine) => l.ip > 0;

  const battingSpecs: { label: string; get: (l: BattingLine) => number; qualifies: (l: BattingLine) => boolean; format: (v: number) => string }[] = [
    { label: "Batting Average", get: (l) => l.avg, qualifies: battingHasAb, format: formatAvg },
    { label: "Home Runs", get: (l) => l.hr, qualifies: battingHasAb, format: (v) => String(v) },
    { label: "RBI", get: (l) => l.rbi, qualifies: () => true, format: (v) => String(v) },
    { label: "OPS", get: (l) => l.ops, qualifies: battingHasPa, format: (v) => v.toFixed(3) },
    { label: "Stolen Bases", get: (l) => l.sb, qualifies: (l) => l.sb > 0, format: (v) => String(v) },
  ];
  const pitchingSpecs: { label: string; get: (l: PitchingLine) => number; qualifies: (l: PitchingLine) => boolean; format: (v: number) => string; lowerIsBetter?: boolean }[] = [
    { label: "ERA", get: (l) => l.era ?? Infinity, qualifies: pitchingHasIp, format: (v) => v.toFixed(2), lowerIsBetter: true },
    { label: "Strikeouts (P)", get: (l) => l.k, qualifies: pitchingHasIp, format: (v) => String(v) },
  ];

  const rows: LeaderRow[] = battingSpecs.map((spec) => {
    const ranking = buildRanking(players, battingLines, spec.get, spec.qualifies, false);
    const { value, leaders } = leadersFromRanking(ranking, false);
    return { label: spec.label, value, leaders, ranking, format: spec.format, lowerIsBetter: false };
  });
  for (const spec of pitchingSpecs) {
    const lowerIsBetter = !!spec.lowerIsBetter;
    const ranking = buildRanking(players, pitchingLines, spec.get, spec.qualifies, lowerIsBetter);
    const { value, leaders } = leadersFromRanking(ranking, lowerIsBetter);
    rows.push({ label: spec.label, value, leaders, ranking, format: spec.format, lowerIsBetter });
  }
  const epsPresent = new Map(Array.from(epsLines.entries()).filter(([, v]) => v !== null) as [string, number][]);
  const epsRanking = buildRanking(players, epsPresent, (v) => v, () => true, false);
  const { value: epsValue, leaders: epsLeaders } = leadersFromRanking(epsRanking, false);
  rows.push({ label: "Performance Score", value: epsValue, leaders: epsLeaders, ranking: epsRanking, format: (v) => v.toFixed(1), lowerIsBetter: false });

  return rows;
}

function TeamLeaders({ rows, viewerPlayerId }: { rows: LeaderRow[]; viewerPlayerId: string }) {
  const [selected, setSelected] = useState<LeaderRow | null>(null);

  return (
    <section className="glossy rounded-lg border border-accent-gold/30 bg-surface p-5">
      <h2 className="font-heading text-xl font-bold uppercase tracking-wide text-accent-gold">Team Leaders</h2>
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {rows.map((row) => {
          const hasData = row.value !== null && row.leaders.length > 0;
          const shown = row.leaders.length > 3 ? row.leaders.slice(0, 2) : row.leaders;
          const extra = row.leaders.length > 3 ? row.leaders.length - 2 : 0;
          return (
            <button key={row.label} type="button" onClick={() => setSelected(row)} className="block w-full text-left transition hover:brightness-110">
              <div className="min-h-[90px] rounded-md p-3" style={{ backgroundColor: "#080E08", border: "1px solid #1A3D28" }}>
                <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.15em] text-accent-green">
                  <StatIcon label={row.label} />
                  {row.label}
                </p>
                <p className="mt-1 pl-4 text-[13px]" style={{ color: "#8AABCC" }}>
                  {hasData ? (
                    <>
                      {shown.map((l, i) => (
                        <span key={l.playerId}>
                          {i > 0 && " · "}
                          <span style={{ color: "#F0C060" }}>#{l.playerJersey ?? "—"}</span> {l.playerName}
                        </span>
                      ))}
                      {extra > 0 && <span> and {extra} more</span>}
                    </>
                  ) : (
                    "No data yet"
                  )}
                </p>
                <p className="mt-1 text-center font-heading text-3xl font-black text-accent-gold" style={{ opacity: hasData ? 1 : 0.35 }}>
                  {hasData ? row.format(row.value as number) : "—"}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {selected && <LeaderModal row={selected} viewerPlayerId={viewerPlayerId} onClose={() => setSelected(null)} />}
    </section>
  );
}

function barPct(value: number, leaderValue: number, lowerIsBetter: boolean): number {
  if (leaderValue === 0) return lowerIsBetter ? (value === 0 ? 100 : 0) : 0;
  const ratio = lowerIsBetter ? leaderValue / value : value / leaderValue;
  return Math.max(0, Math.min(100, ratio * 100));
}

// Only the viewer's own row links anywhere (back to this same Clubhouse
// page -- a player has no separate "/players/[id]" route, this page IS
// their profile) -- every other row is plain text. This is the one
// piece of the coach's own LeaderboardModal that genuinely can't be
// reused unmodified: there, every row links to /coach/players/[id].
function LeaderModal({ row, viewerPlayerId, onClose }: { row: LeaderRow; viewerPlayerId: string; onClose: () => void }) {
  const leaderValue = row.ranking[0]?.value ?? 0;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="glossy max-h-[80vh] w-full max-w-md overflow-y-auto rounded-lg border-2 p-5" style={{ backgroundColor: "#080E08", borderColor: "#2ECC71" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-heading text-xl font-bold uppercase tracking-wide text-white">{row.label}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md px-2 py-1 text-foreground/50 transition hover:text-white">
            ✕
          </button>
        </div>
        {row.ranking.length === 0 ? (
          <p className="mt-4 text-sm text-foreground/50">No qualifying players yet.</p>
        ) : (
          <div className="mt-4 flex flex-col gap-2">
            {row.ranking.map((r, i) => {
              const isSelf = r.playerId === viewerPlayerId;
              const content = (
                <>
                  <span className="w-5 shrink-0 text-right text-xs text-foreground/40">{i + 1}</span>
                  <span className="w-24 shrink-0 truncate text-sm text-white">
                    <span style={{ color: "#F0C060" }}>#{r.playerJersey ?? "—"}</span> {r.playerName}
                    {isSelf && <span className="text-foreground/40"> (you)</span>}
                  </span>
                  <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                    <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${barPct(r.value, leaderValue, row.lowerIsBetter)}%`, backgroundColor: "#2ECC71" }} />
                  </span>
                  <span className="w-12 shrink-0 text-right font-mono text-sm text-accent-gold">{row.format(r.value)}</span>
                </>
              );
              const rowClass = "flex items-center gap-3 rounded-md px-2 py-2";
              return isSelf ? (
                <Link key={r.playerId} href="/player/clubhouse" onClick={onClose} className={`${rowClass} transition hover:bg-white/5`}>
                  {content}
                </Link>
              ) : (
                <div key={r.playerId} className={rowClass}>
                  {content}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
