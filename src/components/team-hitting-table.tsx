"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatAvg } from "@/lib/stats";

// Hitting-table batch. Shared, presentation-only: sorting, qualification
// styling, the mobile pinned-column scroll, and the totals row -- the
// same rules on both the coach dashboard and the read-only player
// Clubhouse mirror (per the request: "shows the table read-only, with
// the same rules"). All the actual stat math (computeBattingLines, the
// facet/single-game filters, the qualification check) happens in each
// caller's own wrapper -- this component only ever receives finished
// rows, never raw at_bats/game rows, so it can't duplicate that math.
export interface HittingTableRow {
  playerId: string;
  playerName: string;
  playerJersey: number | null;
  g: number;
  pa: number;
  ab: number;
  r: number;
  h: number;
  doubles: number;
  triples: number;
  hr: number;
  rbi: number;
  bb: number;
  k: number;
  sb: number;
  cs: number;
  avg: number;
  obp: number;
  slg: number;
  ops: number;
  // Rate-stat qualification (AVG/OBP/SLG/OPS only) -- always true for a
  // counting stat, so this one flag is enough to grey a whole row out
  // and push it below the qualified pool when sorting by a rate column.
  qualified: boolean;
}

type ColumnKey = "player" | "g" | "pa" | "ab" | "r" | "h" | "doubles" | "triples" | "hr" | "rbi" | "bb" | "k" | "sb" | "cs" | "avg" | "obp" | "slg" | "ops";

const RATE_COLUMNS = new Set<ColumnKey>(["avg", "obp", "slg", "ops"]);

const COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: "player", label: "Player" },
  { key: "g", label: "G" },
  { key: "pa", label: "PA" },
  { key: "ab", label: "AB" },
  { key: "r", label: "R" },
  { key: "h", label: "H" },
  { key: "doubles", label: "2B" },
  { key: "triples", label: "3B" },
  { key: "hr", label: "HR" },
  { key: "rbi", label: "RBI" },
  { key: "bb", label: "BB" },
  { key: "k", label: "K" },
  { key: "sb", label: "SB" },
  { key: "cs", label: "CS" },
  { key: "avg", label: "AVG" },
  { key: "obp", label: "OBP" },
  { key: "slg", label: "SLG" },
  { key: "ops", label: "OPS" },
];

function formatCell(key: ColumnKey, row: HittingTableRow): string {
  switch (key) {
    case "player":
      return row.playerName;
    case "avg":
    case "obp":
    case "slg":
      return formatAvg(row[key]);
    case "ops":
      return row.ops.toFixed(3);
    default:
      return String(row[key]);
  }
}

export function TeamHittingTable({
  rows,
  totals,
  getPlayerHref,
  minPaPerTeamGame,
  teamGames,
}: {
  rows: HittingTableRow[];
  totals: HittingTableRow | null;
  getPlayerHref: (playerId: string) => string | null;
  minPaPerTeamGame: number;
  teamGames: number;
}) {
  const [sortKey, setSortKey] = useState<ColumnKey>("ops");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function handleHeaderClick(key: ColumnKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      // Default is OPS, highest first; every other counting/rate column
      // defaults the same way on its own first click ("counting stats
      // sort highest-first", and a rate stat sorting "lowest-last" is
      // the same descending default worded for a higher-is-better rate
      // stat) -- "player" is the one text column, where A->Z reads as
      // the natural first click, not Z->A.
      setSortDir(key === "player" ? "asc" : "desc");
    }
  }

  const sorted = useMemo(() => {
    const list = [...rows];
    const isRate = RATE_COLUMNS.has(sortKey);
    list.sort((a, b) => {
      // Qualification wins regardless of sort direction: an unqualified
      // player always sorts below every qualified one when sorting by a
      // rate stat, per spec.
      if (isRate && a.qualified !== b.qualified) return a.qualified ? -1 : 1;
      if (sortKey === "player") {
        const cmp = a.playerName.localeCompare(b.playerName);
        return sortDir === "asc" ? cmp : -cmp;
      }
      const key = sortKey as Exclude<ColumnKey, "player">;
      const av = a[key];
      const bv = b[key];
      const cmp = av - bv;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [rows, sortKey, sortDir]);

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[840px] border-collapse text-sm">
          <thead>
            <tr style={{ backgroundColor: "#061409" }}>
              {COLUMNS.map((col, idx) => {
                const active = sortKey === col.key;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    onClick={() => handleHeaderClick(col.key)}
                    className={`cursor-pointer select-none whitespace-nowrap px-3 py-2 text-left font-heading text-xs font-semibold uppercase tracking-wide transition hover:text-white motion-reduce:transition-none ${
                      idx === 0 ? "sticky left-0 z-10 text-left" : "text-right"
                    }`}
                    style={{
                      backgroundColor: "#061409",
                      color: active ? "#F0C060" : "#6FA883",
                      borderBottom: "1px solid #1A3D28",
                    }}
                  >
                    <span className={idx === 0 ? "inline-flex items-center gap-1" : "inline-flex items-center justify-end gap-1"}>
                      {col.label}
                      {active && <span aria-hidden="true">{sortDir === "asc" ? "▲" : "▼"}</span>}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const href = getPlayerHref(row.playerId);
              const dim = !row.qualified;
              const nameCell = (
                <span className="truncate">
                  <span style={{ color: "#F0C060" }}>#{row.playerJersey ?? "—"}</span> {row.playerName}
                </span>
              );
              return (
                <tr
                  key={row.playerId}
                  className={`transition motion-reduce:transition-none ${dim ? "opacity-50" : ""}`}
                  style={{ borderBottom: "1px solid #102418" }}
                >
                  <td
                    className="sticky left-0 z-10 max-w-[160px] whitespace-nowrap px-3 py-2"
                    style={{ backgroundColor: "#0A1A0D" }}
                  >
                    {href ? (
                      <Link href={href} className="hover:underline">
                        {nameCell}
                      </Link>
                    ) : (
                      nameCell
                    )}
                  </td>
                  {COLUMNS.slice(1).map((col) => (
                    <td key={col.key} className="whitespace-nowrap px-3 py-2 text-right font-mono text-[13px]" style={{ color: RATE_COLUMNS.has(col.key) ? "#2ECC71" : "#C8F0D5" }}>
                      {formatCell(col.key, row)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-6 text-center text-sm text-foreground/40">
                  No hitting stats for this filter yet.
                </td>
              </tr>
            )}
            {totals && (
              <tr style={{ backgroundColor: "#0D2112", borderTop: "2px solid #2ECC71" }}>
                <td className="sticky left-0 z-10 whitespace-nowrap px-3 py-2 font-heading text-xs font-bold uppercase tracking-wide text-accent-gold" style={{ backgroundColor: "#0D2112" }}>
                  Team Total
                </td>
                {COLUMNS.slice(1).map((col) => (
                  <td key={col.key} className="whitespace-nowrap px-3 py-2 text-right font-mono text-[13px] font-semibold" style={{ color: RATE_COLUMNS.has(col.key) ? "#2ECC71" : "#F0C060" }}>
                    {formatCell(col.key, totals)}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="px-1 text-[11px] text-foreground/40">
        AVG/OBP/SLG/OPS shown for every player. A player under {minPaPerTeamGame} PA per team game played ({teamGames} team game{teamGames === 1 ? "" : "s"} ·{" "}
        {minPaPerTeamGame * teamGames} PA) appears in grey and sorts below qualified players on a rate-stat column.
      </p>
    </div>
  );
}
