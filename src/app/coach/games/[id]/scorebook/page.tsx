import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatGameDate } from "@/lib/dates";
import { computeBattingLines, computePitchingLines } from "@/lib/stats";
import { FIELDING_POSITION_TO_NUMBER } from "@/lib/field-zones";
import type { Database, FieldingPosition } from "@/lib/supabase/types";
import { PrintButton } from "../lineup-print/print-button";
import { DiamondCell } from "./diamond-cell";

type AtBat = Database["public"]["Tables"]["at_bats"]["Row"];

// Official scorebook PDF export batch. This is OUR team's own batting
// scorebook (one row per our own batter, one column per inning we hit
// in) plus a pitching line for our own pitchers -- same "our team's own
// line, not a two-team line score" framing the live H/R/E/K dashboard
// already established (see CLAUDE.md's mini box-score note). It reads
// entirely from at_bats/pitches/game_events/stolen_bases -- no new
// tables, matching the request -- but several notation/diamond details
// need honest, documented approximations; see the callouts below and
// the page's own caption.
export default async function ScorebookPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role, team_id").eq("id", user.id).single();
  if (!profile?.team_id || profile.role !== "coach") redirect("/pending");

  const { data: game } = await supabase.from("games").select("*").eq("id", params.id).eq("team_id", profile.team_id).single();
  if (!game) notFound();

  const [{ data: team }, { data: lineup }, { data: players }, { data: hittingAtBats }, { data: pitchingAtBats }, { data: substitutions }] = await Promise.all([
    supabase.from("teams").select("name").eq("id", profile.team_id).single(),
    supabase.from("lineup").select("*").eq("game_id", game.id).eq("status", "starting").order("batting_order"),
    supabase.from("players").select("id, name, jersey_number").eq("team_id", profile.team_id),
    supabase.from("at_bats").select("*").eq("game_id", game.id).eq("mode", "hitting").not("confirmed_at", "is", null),
    supabase.from("at_bats").select("*").eq("game_id", game.id).eq("mode", "pitching").not("confirmed_at", "is", null),
    supabase.from("substitutions").select("player_out_id, player_in_id").eq("game_id", game.id),
  ]);

  // Bug fix: a substituted-in player keeps batting in the SAME lineup
  // slot as whoever they replaced, but `lineup` only ever has one row
  // per slot (the starter -- substitutions are their own table, not a
  // second lineup row). Every cell below used to be looked up by
  // slot.player_id alone, so a sub's at-bats (and steals) -- same
  // batting_order_position, different player_id -- never matched
  // anything and silently never rendered. Walking the substitution chain
  // from each starter gives every player_id that ever occupied this
  // slot, so their at-bats/steals/strikeouts can all be folded into the
  // one row a paper scorebook would actually use for that batting spot.
  const subInByOutId = new Map((substitutions ?? []).map((s) => [s.player_out_id, s.player_in_id]));
  function playerIdChainFor(startingPlayerId: string): string[] {
    const chain: string[] = [];
    const seen = new Set<string>();
    let current: string | null = startingPlayerId;
    while (current && !seen.has(current)) {
      seen.add(current);
      chain.push(current);
      current = subInByOutId.get(current) ?? null;
    }
    return chain;
  }

  const allAtBatIds = [...(hittingAtBats ?? []), ...(pitchingAtBats ?? [])].map((ab) => ab.id);
  const [{ data: pitches }, { data: stolenBases }, { data: gameEvents }] = await Promise.all([
    allAtBatIds.length
      ? supabase.from("pitches").select("at_bat_id, pitch_number, swing").in("at_bat_id", allAtBatIds)
      : Promise.resolve({ data: [] }),
    supabase.from("stolen_bases").select("player_id, inning").eq("game_id", game.id),
    supabase
      .from("game_events")
      .select("event_type, inning, player_id")
      .eq("game_id", game.id)
      .in("event_type", ["caught_stealing", "pickoff_out", "rundown_out", "out_at_next_base", "tag_up_violation"]),
  ]);

  const playerById = new Map((players ?? []).map((p) => [p.id, p]));
  const lastPitchSwingByAtBat = new Map<string, boolean | null>();
  for (const ab of hittingAtBats ?? []) {
    const forThisAtBat = (pitches ?? []).filter((p) => p.at_bat_id === ab.id);
    const last = forThisAtBat.sort((a, b) => b.pitch_number - a.pitch_number)[0];
    lastPitchSwingByAtBat.set(ab.id, last?.swing ?? null);
  }

  const maxInning = Math.max(1, ...(hittingAtBats ?? []).map((ab) => ab.inning));
  const innings = Array.from({ length: maxInning }, (_, i) => i + 1);

  // One cell per (batter, inning) -- a batter rarely bats twice in the
  // same numbered inning, but a big inning can do it; joined with " / "
  // rather than picked/overwritten so nothing silently disappears. Keyed
  // by player_id (unchanged) -- the render side now also checks every
  // id in the slot's substitution chain, not just the starter's.
  const cellsByPlayerInning = new Map<string, AtBat[]>();
  for (const ab of hittingAtBats ?? []) {
    if (!ab.player_id) continue;
    const key = `${ab.player_id}-${ab.inning}`;
    const existing = cellsByPlayerInning.get(key) ?? [];
    existing.push(ab);
    cellsByPlayerInning.set(key, existing);
  }

  const sbByPlayerInning = new Map<string, number>();
  for (const sb of stolenBases ?? []) {
    const key = `${sb.player_id}-${sb.inning}`;
    sbByPlayerInning.set(key, (sbByPlayerInning.get(key) ?? 0) + 1);
  }
  const csByPlayerInning = new Map<string, number>();
  for (const ev of gameEvents ?? []) {
    if (ev.event_type !== "caught_stealing" || !ev.player_id) continue;
    const key = `${ev.player_id}-${ev.inning}`;
    csByPlayerInning.set(key, (csByPlayerInning.get(key) ?? 0) + 1);
  }
  const runnerOutsByInning = new Map<number, number>();
  for (const ev of gameEvents ?? []) {
    if (ev.event_type === "caught_stealing") continue; // a caught-stealing runner was never "left on" -- they're out, shown in their own cell, not double-subtracted from LOB
    runnerOutsByInning.set(ev.inning, (runnerOutsByInning.get(ev.inning) ?? 0) + 1);
  }

  const battingLines = computeBattingLines(hittingAtBats ?? [], stolenBases ?? []);
  const pitchingLines = computePitchingLines(pitchingAtBats ?? [], [game]);

  // Bottom totals row (R/H/E/LOB) per inning -- R and H come straight
  // from the at-bats logged that inning; E is errors WE committed while
  // pitching that inning (fielding mistakes on defense), matching how
  // the live in-game box score already framed E (see CLAUDE.md). LOB is
  // a best-effort approximation, not an authoritative count: this schema
  // never stores "how many runners were on base when the 3rd out was
  // recorded" directly (game_state.runners is overwritten continuously,
  // not historized per inning) -- see the page's own caption below.
  const inningTotals = innings.map((inning) => {
    const hitting = (hittingAtBats ?? []).filter((ab) => ab.inning === inning);
    const pitching = (pitchingAtBats ?? []).filter((ab) => ab.inning === inning);
    const r = hitting.reduce((sum, ab) => sum + ab.runs_scored, 0);
    const h = hitting.filter((ab) => ab.result && ["single", "double", "triple", "hr", "ground_rule_double"].includes(ab.result)).length;
    const e = pitching.filter((ab) => ab.result === "error").length;
    const baserunnersCreated = hitting.filter(
      (ab) => !ab.is_out && ab.result && !["hr"].includes(ab.result)
    ).length;
    const lob = Math.max(0, Math.min(3, baserunnersCreated - r - (runnerOutsByInning.get(inning) ?? 0)));
    return { inning, r, h, e, lob };
  });

  function notationFor(ab: AtBat): string {
    if (ab.scorebook_notation) return ab.scorebook_notation;
    const fielderNum = ab.fielded_by_position ? FIELDING_POSITION_TO_NUMBER[ab.fielded_by_position as FieldingPosition] : null;
    switch (ab.result) {
      case "single":
        return "1B";
      case "double":
        return "2B";
      case "ground_rule_double":
        return "2B*";
      case "triple":
        return "3B";
      case "hr":
        return "HR";
      case "walk":
        return "BB";
      case "intentional_walk":
        return "IBB";
      case "hbp":
        return "HBP";
      case "fc":
        return "FC";
      case "strikeout":
        return lastPitchSwingByAtBat.get(ab.id) === false ? "Kl" : "K";
      case "dropped_third_strike_safe":
        return lastPitchSwingByAtBat.get(ab.id) === false ? "Kl-WP" : "K-WP";
      case "error":
        return fielderNum ? `E${fielderNum}` : "E";
      case "groundout":
        return fielderNum ? `G${fielderNum}` : "GO";
      case "flyout":
        // SF isn't its own AtBatResult -- a sac fly is stored as a plain
        // flyout with an RBI (see CLAUDE.md's Fix 4 note on why "Sacrifice
        // Fly" was never built as a separate result button); an RBI-
        // crediting flyout is the closest honest signal available for it.
        return (fielderNum ? `F${fielderNum}` : "FO") + (ab.rbi > 0 ? " SF" : "");
      case "lineout":
        return fielderNum ? `L${fielderNum}` : "LO";
      case "double_play":
        return "DP";
      default:
        return ab.result ?? "";
    }
  }

  return (
    <main className="min-h-screen bg-background px-6 py-8 print:bg-white print:px-0 print:py-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/coach" className="text-sm text-accent-primary hover:underline">
          &larr; Back to dashboard
        </Link>
        <PrintButton />
      </div>

      <div className="scorebook-page mx-auto w-full max-w-[1400px] rounded-lg border border-border bg-white p-6 text-black shadow-xl print:m-0 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <header className="flex items-start justify-between border-b-4 border-black pb-2">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-black text-xl font-bold">
            {(team?.name ?? "?").slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1 px-3">
            <h1 className="text-2xl font-bold">{team?.name ?? "Our Team"}</h1>
            <p className="text-sm">vs {game.opponent_name}</p>
          </div>
          <div className="text-right text-xs">
            <p>{formatGameDate(game.game_date)}{game.game_time ? ` · ${game.game_time}` : ""}</p>
            <p className="capitalize">{game.home_away}</p>
            <p>Umpire: {game.umpire_name ?? "—"}</p>
            <p>
              Final: {game.our_score}–{game.opponent_score}
            </p>
          </div>
        </header>

        {/* Quick Mode batch cross-reference: a quick-mode game never
            captured fielder attribution, hit type, or pitch detail, so
            every cell here falls back to notationFor's generic
            GO/FO/LO/E (no fielder number) instead of the real G3/F7/E5
            a fully-logged game gets -- flagged here rather than left to
            look like a logging mistake. */}
        {game.logging_mode === "quick" && (
          <p className="mt-2 rounded border border-black/20 bg-black/5 px-2 py-1 text-[10px] italic">
            This game was logged in Quick Mode -- notation below is result-only (no fielder numbers, no pitch detail).
          </p>
        )}

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-[11px]">
            <thead>
              <tr className="border-b-2 border-black">
                <th className="w-6 border-r border-black py-1 text-left">#</th>
                <th className="min-w-[120px] border-r border-black py-1 text-left">PLAYER</th>
                <th className="w-8 border-r border-black py-1 text-left">POS</th>
                {innings.map((i) => (
                  <th key={i} className="w-14 border-r border-black py-1 text-center">
                    {i}
                  </th>
                ))}
                <th className="w-7 border-r border-black py-1 text-center">AB</th>
                <th className="w-7 border-r border-black py-1 text-center">R</th>
                <th className="w-7 border-r border-black py-1 text-center">H</th>
                <th className="w-7 border-r border-black py-1 text-center">RBI</th>
                <th className="w-7 border-r border-black py-1 text-center">BB</th>
                <th className="w-7 py-1 text-center">K</th>
              </tr>
            </thead>
            <tbody>
              {(lineup ?? []).map((slot, i) => {
                const chain = playerIdChainFor(slot.player_id);
                const displayName = chain
                  .map((pid) => {
                    const p = playerById.get(pid);
                    return p ? `#${p.jersey_number ?? "—"} ${p.name}` : "Player";
                  })
                  .join(" → ");
                const line = chain.reduce(
                  (acc, pid) => {
                    const l = battingLines.get(pid);
                    if (!l) return acc;
                    return { ab: acc.ab + l.ab, runsScored: acc.runsScored + l.runsScored, h: acc.h + l.h, rbi: acc.rbi + l.rbi, bb: acc.bb + l.bb };
                  },
                  { ab: 0, runsScored: 0, h: 0, rbi: 0, bb: 0 }
                );
                const k = (hittingAtBats ?? []).filter((ab) => chain.includes(ab.player_id ?? "") && ab.result === "strikeout").length;
                return (
                  <tr key={slot.id} className={`border-b border-black/30 ${i % 2 === 1 ? "bg-black/5" : ""}`}>
                    <td className="border-r border-black/30 py-1 text-center">{slot.batting_order}</td>
                    <td className="border-r border-black/30 py-1 pl-1">{displayName}</td>
                    <td className="border-r border-black/30 py-1 text-center">{slot.position}</td>
                    {innings.map((inning) => {
                      const cellAtBats = chain.flatMap((pid) => cellsByPlayerInning.get(`${pid}-${inning}`) ?? []);
                      const sb = chain.reduce((sum, pid) => sum + (sbByPlayerInning.get(`${pid}-${inning}`) ?? 0), 0);
                      const cs = chain.reduce((sum, pid) => sum + (csByPlayerInning.get(`${pid}-${inning}`) ?? 0), 0);
                      return (
                        <td key={inning} className="border-r border-black/30 p-0.5 align-top">
                          <div className="flex flex-col items-center gap-0.5">
                            {cellAtBats.map((ab) => (
                              <DiamondCell key={ab.id} atBat={ab} notation={notationFor(ab)} />
                            ))}
                            {sb > 0 && <span className="font-mono text-[9px]">SB{sb > 1 ? `x${sb}` : ""}</span>}
                            {cs > 0 && <span className="font-mono text-[9px]">CS{cs > 1 ? `x${cs}` : ""}</span>}
                          </div>
                        </td>
                      );
                    })}
                    <td className="border-r border-black/30 py-1 text-center font-mono">{line.ab}</td>
                    <td className="border-r border-black/30 py-1 text-center font-mono">{line.runsScored}</td>
                    <td className="border-r border-black/30 py-1 text-center font-mono">{line.h}</td>
                    <td className="border-r border-black/30 py-1 text-center font-mono">{line.rbi}</td>
                    <td className="border-r border-black/30 py-1 text-center font-mono">{line.bb}</td>
                    <td className="py-1 text-center font-mono">{k}</td>
                  </tr>
                );
              })}
              {(lineup ?? []).length === 0 && (
                <tr>
                  <td colSpan={9 + innings.length} className="py-4 text-center text-black/40">
                    No starting lineup on record for this game.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-black font-semibold">
                <td colSpan={3} className="border-r border-black py-1 pl-1">
                  TOTALS
                </td>
                {inningTotals.map((t) => (
                  <td key={t.inning} className="border-r border-black py-1 text-center font-mono text-[9px] leading-tight">
                    R{t.r} H{t.h}
                    <br />
                    E{t.e} LOB{t.lob}
                  </td>
                ))}
                <td colSpan={6} />
              </tr>
            </tfoot>
          </table>
        </div>

        <p className="mt-2 text-[9px] italic text-black/50">
          LOB is a best-effort approximation (runners on base created minus runs scored minus recorded runner outs this inning) -- this
          schema does not store an authoritative per-inning left-on-base count. Diamond marks show each batter&apos;s own plate-appearance
          outcome; a runner&apos;s eventual run on a later teammate&apos;s at-bat is not linked back to the original cell. A row shows every
          player who batted in that lineup spot (e.g. &quot;#2 Christian Cris &rarr; #43 Ruben Prieto&quot;) -- substitutions share the
          starter&apos;s row rather than getting a row of their own, matching how a paper scorebook tracks a batting slot.
        </p>

        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-wide">Pitching</p>
          <table className="mt-1 w-full max-w-[600px] border-collapse text-[11px]">
            <thead>
              <tr className="border-b-2 border-black">
                <th className="border-r border-black py-1 text-left">PITCHER</th>
                <th className="border-r border-black py-1 text-center">IP</th>
                <th className="border-r border-black py-1 text-center">H</th>
                <th className="border-r border-black py-1 text-center">R</th>
                <th className="border-r border-black py-1 text-center">ER</th>
                <th className="border-r border-black py-1 text-center">BB</th>
                <th className="py-1 text-center">K</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(pitchingLines.values()).map((line) => {
                const p = playerById.get(line.playerId);
                return (
                  <tr key={line.playerId} className="border-b border-black/30">
                    <td className="border-r border-black/30 py-1 pl-1">
                      #{p?.jersey_number ?? "—"} {p?.name ?? "Pitcher"}
                    </td>
                    <td className="border-r border-black/30 py-1 text-center font-mono">{line.ipDisplay}</td>
                    <td className="border-r border-black/30 py-1 text-center font-mono">{line.hAllowed}</td>
                    <td className="border-r border-black/30 py-1 text-center font-mono">{line.runsAllowed}</td>
                    {/* No earned/unearned distinction is tracked (every run allowed counts as earned) -- same documented simplification computePitchingLines/ERA already uses. */}
                    <td className="border-r border-black/30 py-1 text-center font-mono">{line.runsAllowed}</td>
                    <td className="border-r border-black/30 py-1 text-center font-mono">{line.bbAllowed}</td>
                    <td className="py-1 text-center font-mono">{line.k}</td>
                  </tr>
                );
              })}
              {pitchingLines.size === 0 && (
                <tr>
                  <td colSpan={7} className="py-3 text-center text-black/40">
                    No pitching-mode at-bats logged.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-6 text-right text-xs text-black/50">Generated by EpicPlay AI &middot; epicplayai.com</p>
      </div>

      <style>{`
        @page {
          size: A4 landscape;
          margin: 12mm;
        }
        @media print {
          .scorebook-page {
            page-break-inside: avoid;
          }
        }
      `}</style>
    </main>
  );
}
