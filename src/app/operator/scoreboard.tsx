"use client";

// Fix 5 (six-fixes batch): a persistent scoreboard sitting above the
// diamond in the right panel's middle section -- always visible
// regardless of rightPanelMode (a score/inning/count readout is useful
// whether the diamond, a runner picker, or a flow step happens to be
// showing), not conditionally tied to the diamond specifically. The
// diamond itself (h-[60%] of the middle section) is untouched by this --
// adding a sibling row above it just leaves it less leftover space, per
// spec ("keep the diamond exactly as is").
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
  // Fix 6: bumped by the caller every time a run scores in hitting mode --
  // remounts the score number's celebration animation (scale pulse + gold
  // glow), the same flashKey-remount idiom the rest of this app already
  // uses to restart a one-shot CSS animation reliably.
  celebrateKey: number;
}) {
  return (
    <div className="glossy w-full shrink-0 rounded-lg border border-border border-l-[3px] border-l-accent-green bg-[#0A1F0D] px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="font-heading truncate text-[22px] uppercase leading-tight text-white">{teamName}</p>
        <p className="font-heading truncate text-[22px] uppercase leading-tight text-white">{opponentName}</p>
      </div>

      <div className="flex items-center justify-center gap-3">
        <span key={celebrateKey} className="score-celebrate font-heading text-[56px] font-bold leading-none text-accent-green">
          {ourScore}
        </span>
        <span className="text-[14px] font-medium text-foreground/40">VS</span>
        <span className="font-heading text-[56px] font-bold leading-none text-white">{opponentScore}</span>
      </div>

      <p className="text-center font-mono text-[11px] text-foreground/50">
        B: {balls} S: {strikes}
      </p>

      <div className="mt-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Outs: filled amber for recorded outs, empty (outline only)
              for remaining -- Array index < outs means "already
              recorded," matching how the top bar's own outs count
              already reads (outs accumulate left-to-right as they
              happen), not the reversed empty-then-filled order the
              request's own "○●● = 2 outs" example showed. */}
          <div className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-2.5 w-2.5 rounded-full border border-accent-amber"
                style={{ backgroundColor: i < outs ? "#EF9F27" : "transparent" }}
              />
            ))}
          </div>
          <span className="font-heading text-[16px] font-semibold text-accent-amber">
            {inningHalf === "top" ? "Top" : "Bot"} {inning}
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
