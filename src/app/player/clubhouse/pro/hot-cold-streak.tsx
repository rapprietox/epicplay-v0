import { formatAvg } from "@/lib/stats";
import type { StreakStatus } from "@/lib/streaks";

const STATUS_DISPLAY: Record<StreakStatus, { emoji: string; label: string; color: string }> = {
  hot: { emoji: "🔥", label: "HOT", color: "#F0C060" },
  steady: { emoji: "➡️", label: "STEADY", color: "#2ECC71" },
  cold: { emoji: "❄️", label: "COLD", color: "#5A9AD4" },
};

// Clubhouse Pro enhancement, Part 4. Thresholds exactly per spec: HOT
// last-5 AVG > .350, STEADY .200-.350, COLD < .200.
export function HotColdStreak({
  status,
  last5,
  last10,
  currentStreak,
}: {
  status: StreakStatus;
  last5: { avg: number; h: number; ab: number } | null;
  last10: { avg: number } | null;
  currentStreak: number;
}) {
  const display = STATUS_DISPLAY[status];
  return (
    <section className="glossy rounded-lg border border-border bg-surface p-5">
      <h2 className="font-heading text-lg font-semibold uppercase tracking-wide text-white">Hot / Cold Streak</h2>
      <div className="mt-3 flex items-center gap-2">
        <span className="text-2xl">{display.emoji}</span>
        <span className="font-heading text-xl font-bold" style={{ color: display.color }}>
          {display.label}
        </span>
      </div>
      <p className="mt-2 text-sm text-foreground/80">
        Last 5 games: {formatAvg(last5?.avg ?? 0)} ({last5?.h ?? 0}-{last5?.ab ?? 0})
        {last10 && <> · Last 10 games: {formatAvg(last10.avg)}</>}
        {" · "}Current streak: {currentStreak} game{currentStreak === 1 ? "" : "s"}
      </p>
    </section>
  );
}
