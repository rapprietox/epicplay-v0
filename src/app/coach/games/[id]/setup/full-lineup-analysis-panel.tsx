"use client";

import { useEffect, useRef, useState } from "react";
import { getFullLineupAnalysis, type FullLineupAnalysis } from "./full-lineup-analysis-actions";

// Debounce for the auto-re-run-on-change behavior below -- long enough
// that a coach actively dragging several players in a row doesn't fire
// one AI call per drop, short enough that it still feels responsive
// once they pause.
const ANALYZE_DEBOUNCE_MS = 2500;

const SLOT_RATING_STYLE: Record<string, { emoji: string; color: string }> = {
  optimal: { emoji: "✅", color: "#2ECC71" },
  suboptimal: { emoji: "⚠️", color: "#EF9F27" },
  problematic: { emoji: "💀", color: "#E24B4A" },
};

// Part 3 (pre-game deep analysis). Shown once the lineup is full --
// LineupBuilder decides when to render this at all; this component just
// owns the button/loading/expandable-panel lifecycle and the "apply
// suggested lineup" callback.
//
// Feature B (lineup drafts): LineupBuilder keys this component by
// activeDraftId, so switching drafts fully remounts it -- that's what
// makes initialAnalysis/initialReliability show the right draft's
// cached result on open with zero extra wiring here, and "reopening a
// draft doesn't re-run the AI" is just "mount doesn't call analyze()",
// enforced below by skipping the very first run of the change-watching
// effect. Every edit *after* that first render schedules a debounced
// auto re-analyze; onAnalysisSaved persists whatever comes back (manual
// click or auto-run alike) onto the active draft.
export function FullLineupAnalysisPanel({
  gameId,
  placements,
  initialAnalysis,
  onApplyOptimalLineup,
  onAnalysisSaved,
}: {
  gameId: string;
  placements: { playerId: string; battingOrder: number }[];
  initialAnalysis: FullLineupAnalysis | null;
  onApplyOptimalLineup: (order: { playerId: string; slot: number }[]) => void;
  onAnalysisSaved: (analysis: FullLineupAnalysis) => void;
}) {
  const [analysis, setAnalysis] = useState<FullLineupAnalysis | null>(initialAnalysis);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const isFirstRender = useRef(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function analyze() {
    setLoading(true);
    setError(null);
    const lineup = placements.map((p) => ({ slot: p.battingOrder, playerId: p.playerId }));
    const result = await getFullLineupAnalysis(gameId, lineup);
    setLoading(false);
    if (result.ok) {
      setAnalysis(result.analysis);
      setExpanded(true);
      onAnalysisSaved(result.analysis);
    } else {
      setError(result.error);
    }
  }

  // "Run the AI only when the lineup changes (debounced) or on the
  // button" -- the mount itself never counts as a change.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void analyze();
    }, ANALYZE_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(placements)]);

  const reliabilityEmoji = (pct: number) => (pct < 30 ? "🔴" : pct < 60 ? "🟡" : pct < 86 ? "🟢" : "💎");

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={analyze}
        disabled={loading}
        className="rounded-md border border-accent-gold/50 px-4 py-2 text-sm font-semibold text-accent-gold transition hover:bg-accent-gold/10 disabled:opacity-50"
      >
        {loading ? "Analyzing…" : analysis ? "Re-Analyze Full Lineup" : "Analyze Full Lineup"}
      </button>

      {loading && (
        <p className="mt-2 flex items-center gap-2 text-sm text-foreground/60">
          <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-accent-gold" />
          KAIROS is analyzing your lineup…
        </p>
      )}
      {error && <p className="mt-2 text-sm text-accent-red">{error}</p>}

      {analysis && (
        <div className="glossy mt-3 rounded-lg border border-accent-gold/30 bg-surface p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-heading text-lg font-bold uppercase tracking-wide text-accent-gold">KAIROS Lineup Analysis</h3>
            <button type="button" onClick={() => setExpanded((v) => !v)} className="text-xs text-foreground/50 hover:text-white">
              {expanded ? "Collapse" : "Expand"}
            </button>
          </div>
          <p className="mt-1 text-sm font-semibold" style={{ color: "#F0C060" }}>
            📊 {analysis.reliabilityPct}% Reliable {reliabilityEmoji(analysis.reliabilityPct)}
          </p>

          {expanded && (
            <div className="mt-4 flex flex-col gap-5">
              <Section title="Overall Assessment">
                <p className="text-sm text-white">{analysis.overallAssessment}</p>
              </Section>

              <Section title="Slot by Slot Evaluation">
                <ul className="flex flex-col gap-1">
                  {analysis.slotEvaluations.map((s) => {
                    const style = SLOT_RATING_STYLE[s.rating] ?? SLOT_RATING_STYLE.suboptimal;
                    return (
                      <li key={s.slot} className="text-sm">
                        <span style={{ color: style.color }}>
                          {style.emoji} Slot {s.slot}
                        </span>{" "}
                        <span className="text-white/80">— {s.note}</span>
                      </li>
                    );
                  })}
                </ul>
              </Section>

              <Section title="Lineup Holes">
                <p className="text-sm text-white">{analysis.lineupHoles}</p>
              </Section>

              <Section title="Strengths to Protect">
                <p className="text-sm text-white">{analysis.strengthsToProtect}</p>
              </Section>

              <Section title="Optimal Lineup Suggestion">
                <ul className="flex flex-col gap-1">
                  {analysis.optimalLineup.map((s) => (
                    <li key={s.slot} className="text-sm text-white">
                      <span className="font-heading font-bold text-accent-gold">#{s.slot}</span> {s.playerName}
                      <span className="text-white/60"> — {s.reason}</span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => {
                    const resolved = analysis.optimalLineup.filter((s): s is typeof s & { playerId: string } => s.playerId !== null);
                    onApplyOptimalLineup(resolved.map((s) => ({ playerId: s.playerId, slot: s.slot })));
                  }}
                  className="mt-2 rounded-md bg-accent-green px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-green/90"
                >
                  Apply suggested lineup
                </button>
                {analysis.optimalLineup.some((s) => s.playerId === null) && (
                  <p className="mt-1 text-[11px] text-accent-amber">
                    One or more suggested names didn&apos;t match a roster player exactly -- those slots were left as-is.
                  </p>
                )}
              </Section>

              <Section title="3 Things to Watch">
                <ul className="list-disc pl-4 text-sm text-white">
                  {analysis.thingsToWatch.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </Section>

              <Section title="Reliability Statement">
                <p className="text-sm text-white/80">{analysis.reliabilityStatement}</p>
              </Section>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-foreground/50">{title}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}
