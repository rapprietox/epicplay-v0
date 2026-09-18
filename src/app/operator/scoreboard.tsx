"use client";

// Right-panel redesign: an MLB-stadium-style scoreboard sitting above the
// diamond, always visible regardless of rightPanelMode. Rewritten from an
// earlier, boxier version -- darker background, bigger score numbers, a
// centered inning readout flanked by rule lines instead of sharing a row
// with the outs, and B/S/O folded into one monospace line (the floating
// 0 · 0 · 0 that used to live in the top bar is gone; this is now the
// only place ball/strike/out counts are shown). One of five "supporting
// info" sections on the right panel -- deliberately smaller/dimmer than
// the batter image+zone and the diamond, the panel's two protagonists.
export function Scoreboard({
  teamName,
  opponentName,
  ourScore,
  opponentScore,
  inning,
  inningHalf,
  outs,
  balls,
  strikes,
  isLive,
  celebrateKey,
}: {
  teamName: string;
  opponentName: string;
  ourScore: number;
  opponentScore: number;
  inning: number;
  inningHalf: "top" | "bottom";
  outs: number;
  balls: number;
  strikes: number;
  isLive: boolean;
  // Bumped by the caller every time a run scores in hitting mode --
  // remounts the score number's celebration animation (scale pulse + gold
  // glow), the same flashKey-remount idiom the rest of this app already
  // uses to restart a one-shot CSS animation reliably.
  celebrateKey: number;
}) {
  return (
    <div className="flex h-[140px] w-full shrink-0 flex-col justify-between rounded-lg border border-border bg-[#080E08] px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="font-heading truncate text-[18px] uppercase leading-tight text-white">{teamName}</p>
        <p className="font-heading truncate text-[18px] uppercase leading-tight text-white">{opponentName}</p>
      </div>

      <div className="flex items-center justify-center gap-3">
        <span key={celebrateKey} className="score-celebrate font-heading text-[64px] font-bold leading-none text-accent-green">
          {ourScore}
        </span>
        <span className="text-[11px] font-medium text-foreground/40">VS</span>
        <span className="font-heading text-[64px] font-bold leading-none" style={{ color: "rgba(255,255,255,0.9)" }}>
          {opponentScore}
        </span>
      </div>

      {/* Inning, centered between two rule lines -- the "════ Bot 3
          ════" mockup line, done as two flex-1 borders flanking the
          text rather than literal box-drawing characters. */}
      <div className="flex items-center gap-2">
        <span className="h-px flex-1 bg-border" />
        <span className="shrink-0 text-[14px] font-semibold text-accent-amber">
          {inningHalf === "top" ? "Top" : "Bot"} {inning}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="flex items-center justify-between font-mono text-[12px]">
        <div className="flex items-center gap-2.5">
          <span>
            <span className="text-foreground/40">B:</span> <span className="text-accent-green">{balls}</span>
          </span>
          <span>
            <span className="text-foreground/40">S:</span> <span className="text-accent-red">{strikes}</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="text-foreground/40">O:</span>
            {/* Filled amber for recorded outs, empty (outline only) for
                remaining -- index < outs means "already recorded,"
                matching how outs accumulate left-to-right everywhere
                else in this app, not the reversed empty-then-filled
                order an earlier request's own "○●● = 2 outs" example
                showed. */}
            <span className="flex gap-0.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-2 w-2 rounded-full border border-accent-amber"
                  style={{ backgroundColor: i < outs ? "#EF9F27" : "transparent" }}
                />
              ))}
            </span>
          </span>
        </div>

        {isLive && (
          <div className="flex items-center gap-1.5">
            <span className="live-dot h-2 w-2 rounded-full bg-accent-red" />
            <span className="text-[11px] font-bold uppercase tracking-wide text-accent-red">Live</span>
          </div>
        )}
      </div>
    </div>
  );
}
