"use client";

// Compact MLB-stadium-style scoreboard. Sits top-RIGHT of the right
// panel now, flush to the edge, side by side with the batter card on the
// left (three-fixes batch) -- width dropped from a standalone-centered
// 300px to a fixed 220px now that it shares the row, and centering
// (mx-auto) is gone since the parent flex row's own justify-between is
// what positions it. Team names / scores / colon all share one line;
// inning gets its own centered strip flanked by rule lines; B/S/O is
// three parallel dot-groups (balls get 4 dots, strikes/outs 3 -- see
// DotGroup's own comment). One of several "supporting info" sections on
// the right panel -- deliberately smaller/dimmer than the batter
// image+zone and the diamond, this screen's two protagonists.
// max defaults to 3 (strikes/outs -- a real at-bat/inning never reaches
// 3 of either, the 3rd always ends it) but balls needs 4 dots (a 4th
// ball is what makes it a walk), per Fix 2 (three-fixes batch) -- these
// are standard baseball rules, not stylistic choices.
function DotGroup({ label, count, color, max = 3 }: { label: string; count: number; color: string; max?: number }) {
  return (
    <span className="flex items-center gap-1">
      <span className="text-foreground/40">{label}</span>
      <span className="flex gap-0.5">
        {Array.from({ length: max }, (_, i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full border"
            style={{ borderColor: color, backgroundColor: i < count ? color : "transparent" }}
          />
        ))}
      </span>
    </span>
  );
}

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
  celebrateTier,
  opponentCelebrateKey,
  opponentCelebrateTier,
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
  // Which animation class this remount should use -- "hr" is the bigger
  // 1.8x scale (score-celebrate-hr), "normal" the plain 1.3x
  // (score-celebrate). Travels with celebrateKey rather than being
  // inferred, since by the time this renders the caller's own
  // "was it a home run" context is gone.
  celebrateTier: "normal" | "hr";
  // Pitching-mode reactions batch: same remount idiom as
  // celebrateKey/celebrateTier above, but for the *opponent's* score --
  // a red pulse for a run against, a shake for a home run against.
  // Independent state/key from our own score's celebration so the two
  // can never accidentally trigger each other.
  opponentCelebrateKey: number;
  opponentCelebrateTier: "run" | "hr";
}) {
  return (
    <div className="w-[220px] shrink-0 rounded-lg border border-accent-green/40 bg-[#080E08]" style={{ padding: "10px 14px" }}>
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate font-heading text-[13px] uppercase text-white">{teamName}</span>
        <div className="flex shrink-0 items-center gap-1.5">
          <span
            key={celebrateKey}
            className={`${celebrateKey > 0 ? (celebrateTier === "hr" ? "score-celebrate-hr" : "score-celebrate") : ""} font-heading text-[42px] font-bold leading-none text-accent-green`}
          >
            {ourScore}
          </span>
          <span className="text-[20px] text-foreground/40">:</span>
          <span
            key={opponentCelebrateKey}
            className={`${opponentCelebrateKey > 0 ? (opponentCelebrateTier === "hr" ? "opp-score-shake" : "opp-score-pulse") : ""} font-heading text-[42px] font-bold leading-none`}
            style={{ color: "rgba(255,255,255,0.9)" }}
          >
            {opponentScore}
          </span>
        </div>
        <span className="min-w-0 flex-1 truncate text-right font-heading text-[13px] uppercase text-white">{opponentName}</span>
      </div>

      <div className="mt-1 flex items-center gap-2">
        <span className="h-[2px] flex-1 bg-accent-green/30" />
        <span className="shrink-0 text-[14px] font-semibold text-accent-amber">
          {inningHalf === "top" ? "Top" : "Bot"} {inning}
        </span>
        <span className="h-[2px] flex-1 bg-accent-green/30" />
      </div>

      <div className="mt-1 flex items-center justify-between font-mono text-[11px]">
        <div className="flex items-center gap-2.5">
          <DotGroup label="B" count={balls} color="#2ECC71" max={4} />
          <DotGroup label="S" count={strikes} color="#E24B4A" />
          <DotGroup label="O" count={outs} color="#EF9F27" />
        </div>

        {isLive && (
          <div className="flex shrink-0 items-center gap-1">
            <span className="live-dot h-2 w-2 rounded-full bg-accent-red" />
            <span className="text-[10px] font-bold uppercase tracking-wide text-accent-red">Live</span>
          </div>
        )}
      </div>
    </div>
  );
}
