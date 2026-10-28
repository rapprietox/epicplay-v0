"use client";

import { useState } from "react";
import { requestPostGameAnalysis } from "./post-game-analysis-actions";

// Part 4: renders whatever's already stored (written automatically by
// endGame for a loss) or lets the coach request one manually (always
// available for a completed game that doesn't have one yet -- a win,
// or a loss where the automatic call failed and was swallowed).
export function GameAnalysisTab({
  gameId,
  initialContent,
  initialReliabilityPct,
  gameCompleted,
}: {
  gameId: string;
  initialContent: string | null;
  initialReliabilityPct: number;
  gameCompleted: boolean;
}) {
  const [content, setContent] = useState(initialContent);
  const [reliabilityPct, setReliabilityPct] = useState(initialReliabilityPct);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyze() {
    setLoading(true);
    setError(null);
    const result = await requestPostGameAnalysis(gameId);
    setLoading(false);
    if (result.ok) {
      setContent(result.content);
      setReliabilityPct(result.reliabilityPct);
    } else {
      setError(result.error);
    }
  }

  const reliabilityEmoji = (pct: number) => (pct < 30 ? "🔴" : pct < 60 ? "🟡" : pct < 86 ? "🟢" : "💎");

  return (
    <div className="glossy mx-auto w-full max-w-[1400px] rounded-lg border border-accent-gold/30 bg-surface p-6">
      <h2 className="font-heading text-2xl font-bold uppercase tracking-wide text-accent-gold">KAIROS Game Analysis</h2>

      {!content && gameCompleted && (
        <div className="mt-4">
          <button
            type="button"
            onClick={analyze}
            disabled={loading}
            className="rounded-md bg-accent-gold px-4 py-2 text-sm font-bold text-background transition hover:brightness-110 disabled:opacity-50"
          >
            {loading ? "Analyzing…" : "Analyze this game"}
          </button>
          {loading && <p className="mt-2 text-sm text-foreground/60">KAIROS is reviewing the game…</p>}
        </div>
      )}
      {!content && !gameCompleted && <p className="mt-3 text-sm text-foreground/50">Analysis is available once this game is completed.</p>}
      {error && <p className="mt-2 text-sm text-accent-red">{error}</p>}

      {content && (
        <>
          <p className="mt-3 text-sm font-semibold" style={{ color: "#F0C060" }}>
            📊 {reliabilityPct}% Reliable {reliabilityEmoji(reliabilityPct)}
          </p>
          <div className="mt-4 whitespace-pre-wrap rounded-md border border-border bg-background/40 p-4 text-sm leading-relaxed text-white">
            {content}
          </div>
          <div className="mt-4">
            <button
              type="button"
              onClick={analyze}
              disabled={loading}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground/60 hover:border-accent-primary hover:text-white disabled:opacity-50"
            >
              {loading ? "Re-analyzing…" : "Re-analyze"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
