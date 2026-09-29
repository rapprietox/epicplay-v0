"use client";

import { Fragment, useState } from "react";
import { formatAvg } from "@/lib/stats";
import type { HeadToHeadEntry } from "@/lib/head-to-head";

// Clubhouse Pro enhancement, Part 4. "Click opponent -> see their
// individual game results" as an inline expand/collapse (the
// grid-template-rows 0fr->1fr trick schedule-table.tsx's Past Games
// accordion already established) rather than a new route -- keeps this
// self-contained within Clubhouse Pro.
function Collapsible({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div className="grid transition-[grid-template-rows] duration-300 ease-in-out" style={{ gridTemplateRows: open ? "1fr" : "0fr" }}>
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}

export function HeadToHead({ entries }: { entries: HeadToHeadEntry[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  if (entries.length === 0) {
    return (
      <section className="glossy rounded-lg border border-border bg-surface p-5">
        <h2 className="font-heading text-lg font-semibold uppercase tracking-wide text-white">Head to Head vs Opponents</h2>
        <p className="mt-3 text-sm text-foreground/50">No games logged yet.</p>
      </section>
    );
  }

  return (
    <section className="glossy rounded-lg border border-border bg-surface p-5">
      <h2 className="font-heading text-lg font-semibold uppercase tracking-wide text-white">Head to Head vs Opponents</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-foreground/50">
              <th className="py-2 pr-2">Opponent</th>
              <th className="py-2 pr-2 text-right">Games</th>
              <th className="py-2 pr-2 text-right">AVG</th>
              <th className="py-2 pr-2 text-right">HR</th>
              <th className="py-2 text-right">RBI</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const open = openKey === entry.key;
              return (
                <Fragment key={entry.key}>
                  <tr
                    onClick={() => setOpenKey(open ? null : entry.key)}
                    className="cursor-pointer border-b border-border/50 hover:bg-white/5"
                  >
                    <td className="py-2 pr-2 text-white">
                      <span className="mr-1 inline-block text-foreground/40">{open ? "▾" : "▸"}</span>
                      {entry.opponentName}
                    </td>
                    <td className="py-2 pr-2 text-right text-foreground/70">{entry.games.length}</td>
                    <td className="py-2 pr-2 text-right font-semibold text-accent-gold">{formatAvg(entry.line?.avg ?? 0)}</td>
                    <td className="py-2 pr-2 text-right text-foreground/70">{entry.line?.hr ?? 0}</td>
                    <td className="py-2 text-right text-foreground/70">{entry.line?.rbi ?? 0}</td>
                  </tr>
                  <tr>
                    <td colSpan={5} className="p-0">
                      <Collapsible open={open}>
                        <div className="flex flex-col gap-1 bg-background/40 px-3 py-2">
                          {entry.games.map((g) => (
                            <div key={g.game.id} className="flex items-center justify-between text-xs text-foreground/70">
                              <span>
                                {g.game.game_date} {g.result && <span className="ml-1 text-foreground/50">({g.result})</span>}
                              </span>
                              <span>
                                {g.line ? `${g.line.h}-${g.line.ab}` : "0-0"}
                                {g.line && g.line.hr > 0 ? `, ${g.line.hr} HR` : ""}
                              </span>
                            </div>
                          ))}
                        </div>
                      </Collapsible>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
