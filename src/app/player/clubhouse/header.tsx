import { formatAvg, type BattingLine } from "@/lib/stats";
import { epsTier, EPS_TIER_LABEL } from "@/lib/eps";
import type { Database } from "@/lib/supabase/types";

type Player = Database["public"]["Tables"]["players"]["Row"];

// Clubhouse batch: jersey-number gold circle is a deliberate placeholder
// -- "later replaced with photo" per spec, no upload flow this sprint.
export function ClubhouseHeader({
  player,
  teamName,
  line,
  eps,
}: {
  player: Player;
  teamName: string;
  line: BattingLine | undefined;
  // Feature 3 (EPS): Clubhouse Pro only -- null here means either not
  // unlocked or under the 5-PA minimum, both rendered as "--".
  eps: number | null;
}) {
  return (
    <header className="glossy flex flex-col items-center gap-4 rounded-lg border border-border bg-surface p-6 text-center sm:flex-row sm:text-left">
      <div
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-accent-gold bg-background font-heading text-2xl font-bold text-accent-gold"
        style={{ width: 56, height: 56 }}
      >
        {player.jersey_number ?? "—"}
      </div>
      <div className="min-w-0 flex-1">
        <h1 className="font-heading truncate text-[32px] font-bold leading-tight text-white">{player.name}</h1>
        <p className="text-sm text-foreground/50">
          #{player.jersey_number ?? "—"} · {player.position ?? "—"} · {teamName}
        </p>
      </div>
      <div className={`grid shrink-0 gap-4 sm:gap-6 ${player.clubhouse_unlocked ? "grid-cols-5" : "grid-cols-4"}`}>
        <SnapshotStat label="AVG" value={line ? formatAvg(line.avg) : "—"} />
        <SnapshotStat label="HR" value={line ? String(line.hr) : "—"} />
        <SnapshotStat label="RBI" value={line ? String(line.rbi) : "—"} />
        <SnapshotStat label="OPS" value={line ? line.ops.toFixed(3) : "—"} />
        {player.clubhouse_unlocked && (
          <SnapshotStat label="EPS" value={eps !== null ? eps.toFixed(1) : "—"} badge={eps !== null ? EPS_TIER_LABEL[epsTier(eps)] : undefined} />
        )}
      </div>
    </header>
  );
}

function SnapshotStat({ label, value, badge }: { label: string; value: string; badge?: string }) {
  return (
    <div className="text-center">
      <p className="font-heading text-xl font-bold text-accent-gold">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-foreground/40">{label}</p>
      {badge && <p className="mt-0.5 whitespace-nowrap text-[10px] text-accent-gold/80">{badge}</p>}
    </div>
  );
}
