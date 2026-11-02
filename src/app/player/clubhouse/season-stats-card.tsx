import { formatAvg, type BattingLine, type PitchingLine } from "@/lib/stats";

// Player team-view batch: the header snapshot (AVG/HR/RBI/OPS, + EPS
// once unlocked) only ever showed four numbers -- this is the fuller
// season line the profile-check asked for (AVG, OBP, SLG, OPS, HR,
// RBI, SB, R), plus a pitching line when the player has actually
// pitched (ip > 0; a player who's never pitched gets no empty "0.0 IP"
// block at all, same "only show it if it's real" treatment the coach
// dashboard's own pitching tables already use). Free-tier, not gated
// behind clubhouse_unlocked -- this is the player's own basic stat
// line, same tier as the header above it.
export function SeasonStatsCard({ battingLine, pitchingLine }: { battingLine: BattingLine | undefined; pitchingLine: PitchingLine | undefined }) {
  const hasBatting = !!battingLine && (battingLine.ab > 0 || battingLine.sb > 0 || battingLine.bb > 0 || battingLine.hbp > 0);
  const hasPitching = !!pitchingLine && pitchingLine.ip > 0;

  if (!hasBatting && !hasPitching) {
    return (
      <section className="glossy rounded-lg border border-border bg-surface p-5 text-center">
        <p className="text-sm text-foreground/50">No stats logged yet — check back after your first game.</p>
      </section>
    );
  }

  return (
    <section className="glossy rounded-lg border border-border bg-surface p-5">
      {hasBatting && battingLine && (
        <>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-primary">Season — Batting</p>
          <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-5">
            <Stat label="AVG" value={formatAvg(battingLine.avg)} />
            <Stat label="OBP" value={formatAvg(battingLine.obp)} />
            <Stat label="SLG" value={formatAvg(battingLine.slg)} />
            <Stat label="OPS" value={battingLine.ops.toFixed(3)} />
            <Stat label="HR" value={String(battingLine.hr)} />
            <Stat label="RBI" value={String(battingLine.rbi)} />
            <Stat label="SB" value={String(battingLine.sb)} />
            <Stat label="R" value={String(battingLine.runsScored)} />
            <Stat label="AB" value={String(battingLine.ab)} />
          </div>
        </>
      )}
      {hasPitching && pitchingLine && (
        <>
          <p className={`text-xs font-semibold uppercase tracking-[0.2em] text-accent-primary ${hasBatting ? "mt-5" : ""}`}>Season — Pitching</p>
          <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-5">
            <Stat label="IP" value={pitchingLine.ipDisplay} />
            <Stat label="ERA" value={pitchingLine.era?.toFixed(2) ?? "—"} />
            <Stat label="WHIP" value={pitchingLine.whip?.toFixed(2) ?? "—"} />
            <Stat label="K" value={String(pitchingLine.k)} />
            <Stat label="W" value={String(pitchingLine.wins)} />
          </div>
        </>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="font-heading text-lg font-bold text-accent-gold">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-foreground/40">{label}</p>
    </div>
  );
}
