import Link from "next/link";
import type { Database } from "@/lib/supabase/types";
import { daysUntil, formatGameDate } from "@/lib/dates";
import { recordAgainstOpponent, formatRecord } from "@/lib/opponent-history";
import { computeBattingLines, formatAvg } from "@/lib/stats";
import { generateOpponentInsight, type OpponentInsightInput } from "@/lib/anthropic";
import { createClient } from "@/lib/supabase/server";
import { computePitchArsenal, computeBatterLinesVsPitcher, computeBatterLinesByPitchType, teamAvgAgainst } from "@/lib/opponent-scouting";
import type { PitchType } from "@/lib/supabase/types";

type Game = Database["public"]["Tables"]["games"]["Row"];
type AtBat = Database["public"]["Tables"]["at_bats"]["Row"];
type Player = Database["public"]["Tables"]["players"]["Row"];

export async function NextGamePanel({
  nextGame,
  activeGame,
  allGames,
  atBats,
  players,
}: {
  nextGame: Game | null;
  activeGame: Game | null;
  allGames: Game[];
  atBats: AtBat[];
  players: Player[];
}) {
  if (activeGame) {
    return (
      <section className="glossy rounded-lg border border-accent-green/50 bg-surface p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent-green">
              <span className="h-2 w-2 animate-pulse rounded-full bg-accent-green" /> Live
            </p>
            <h2 className="font-heading mt-1 text-3xl font-bold text-white">vs {activeGame.opponent_name}</h2>
            <p className="mt-1 text-sm text-foreground/60">
              {activeGame.our_score}&ndash;{activeGame.opponent_score}
            </p>
          </div>
          <Link
            href={`/operator?game=${activeGame.id}`}
            className="shrink-0 rounded-md bg-accent-green px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-green/90"
          >
            Continue Game
          </Link>
        </div>
      </section>
    );
  }

  if (!nextGame) {
    return (
      <section className="glossy rounded-lg border border-border bg-surface p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-amber">
          Next Game
        </p>
        <p className="mt-3 text-sm text-foreground/50">
          No upcoming games scheduled. Import or add a season to get started.
        </p>
      </section>
    );
  }

  const record = recordAgainstOpponent(allGames, nextGame);
  const days = daysUntil(nextGame.game_date);
  const daysLabel = days === 0 ? "Today" : days === 1 ? "Tomorrow" : days > 0 ? `${days} days away` : `${-days}d ago`;

  const pastGameIds = new Set(
    allGames
      .filter(
        (g) =>
          g.status === "completed" &&
          (g.opponent_id ? g.opponent_id === nextGame.opponent_id : g.opponent_name === nextGame.opponent_name)
      )
      .map((g) => g.id)
  );

  const { text: insight, pitcherReport } = await buildInsight(nextGame, allGames, atBats, players, pastGameIds);

  return (
    <section className="glossy rounded-lg border border-accent-amber/40 bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-amber">
            Next Game &middot; {daysLabel}
          </p>
          <h2 className="font-heading mt-1 text-3xl font-bold text-white">
            vs {nextGame.opponent_name}
          </h2>
          <p className="mt-1 text-sm text-foreground/60">
            {formatGameDate(nextGame.game_date)}
            {nextGame.game_time ? ` · ${nextGame.game_time}` : ""} ·{" "}
            <span className="capitalize">{nextGame.home_away}</span> ·{" "}
            <span className="capitalize">{nextGame.game_type}</span>
          </p>
          <p className="mt-1 text-xs text-foreground/40">
            All-time vs {nextGame.opponent_name}: {formatRecord(record)}
          </p>
        </div>
        <Link
          href={`/coach/games/${nextGame.id}/setup`}
          className="shrink-0 rounded-md bg-accent-amber px-5 py-2.5 text-sm font-semibold text-background transition hover:bg-accent-amber/90"
        >
          Set Up Game
        </Link>
      </div>

      {/* Opponent pitcher intelligence batch: "show their pitcher profile
          summary" -- a structured block of the underlying facts,
          separate from the AI-generated prose note below (which folds
          the same facts into 2-3 sentences of strategic advice). Only
          renders once a specific opposing pitcher has actually been
          identified against us (opponent_pitcher_id set on a real
          at-bat) -- a roster position guess alone isn't "known" here. */}
      {pitcherReport && (
        <div className="mt-5 rounded-md border border-accent-primary/30 bg-background/50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-accent-primary">
            Known Pitcher: #{pitcherReport.jerseyNumber ?? "—"} {pitcherReport.pitcherName}
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-foreground">
            Your team has hit {formatAvg(pitcherReport.teamAvgAgainst)} against him.
            {pitcherReport.topPitch && ` He leans on his ${pitcherReport.topPitch.pitchType} (${Math.round(pitcherReport.topPitch.pct)}% of pitches).`}
            {pitcherReport.toughestPitchType &&
              ` Your team's AVG against his ${pitcherReport.toughestPitchType.pitchType}: ${formatAvg(pitcherReport.toughestPitchType.avg)}.`}
          </p>
          {pitcherReport.bestBatter && (
            <p className="mt-1 text-xs text-accent-green">
              Best hitter vs him: {pitcherReport.bestBatter.name} — {formatAvg(pitcherReport.bestBatter.avg)}
            </p>
          )}
          {pitcherReport.worstBatter && (
            <p className="mt-0.5 text-xs text-accent-red">
              Toughest matchup: {pitcherReport.worstBatter.name} — {formatAvg(pitcherReport.worstBatter.avg)}
            </p>
          )}
        </div>
      )}

      <div className="mt-5 rounded-md border border-border bg-background/50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-foreground/40">
          Scouting Note
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-foreground">{insight}</p>
      </div>
    </section>
  );
}

async function buildInsight(
  nextGame: Game,
  allGames: Game[],
  atBats: AtBat[],
  players: Player[],
  pastGameIds: Set<string>
): Promise<{ text: string; pitcherReport: OpponentInsightInput["pitcherReport"] }> {
  if (pastGameIds.size === 0) {
    return { text: `No history against ${nextGame.opponent_name} yet — this will be our first matchup.`, pitcherReport: null };
  }

  const pastGames = allGames
    .filter((g) => pastGameIds.has(g.id))
    .map((g) => ({
      date: g.game_date,
      result: (g.our_score > g.opponent_score ? "W" : g.our_score < g.opponent_score ? "L" : "T") as
        | "W"
        | "L"
        | "T",
      ourScore: g.our_score,
      opponentScore: g.opponent_score,
    }));

  const relevantAtBats = atBats.filter((ab) => pastGameIds.has(ab.game_id));
  const battingLines = computeBattingLines(relevantAtBats, []);
  const playerPerformances = players
    .map((p) => battingLines.get(p.id))
    .filter((line): line is NonNullable<typeof line> => !!line && line.ab > 0)
    .map((line) => ({
      playerName: players.find((p) => p.id === line.playerId)?.name ?? "Unknown",
      ab: line.ab,
      h: line.h,
      avg: line.avg,
    }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 5);

  const pitcherReport = await buildPitcherReport(relevantAtBats, players);

  try {
    const text = await generateOpponentInsight({
      opponentName: nextGame.opponent_name,
      pastGames,
      playerPerformances,
      pitcherReport,
    });
    if (text) return { text, pitcherReport };
  } catch {
    // Fall through to the static summary below.
  }

  const pitcherSentence = pitcherReport
    ? ` Vs #${pitcherReport.jerseyNumber ?? "—"} ${pitcherReport.pitcherName}: our team has hit ${formatAvg(pitcherReport.teamAvgAgainst)}${
        pitcherReport.bestBatter ? `, best matchup is ${pitcherReport.bestBatter.name} (${formatAvg(pitcherReport.bestBatter.avg)})` : ""
      }.`
    : "";

  const text = `Record vs ${nextGame.opponent_name}: ${
    pastGames.filter((g) => g.result === "W").length
  }-${pastGames.filter((g) => g.result === "L").length}${
    playerPerformances[0] ? `. ${playerPerformances[0].playerName} has hit ${formatAvg(playerPerformances[0].avg)} against them.` : "."
  }${pitcherSentence}`;
  return { text, pitcherReport };
}

// Opponent pitcher intelligence batch: null whenever there's no known
// opposing pitcher yet (no at-bat in our history against this opponent
// has opponent_pitcher_id set -- see the operator screen's new "Who's
// pitching for them?" picker) -- a real, common state for a team we
// haven't scouted a specific pitcher against yet, not an error.
async function buildPitcherReport(relevantAtBats: AtBat[], players: Player[]): Promise<OpponentInsightInput["pitcherReport"]> {
  const withKnownPitcher = relevantAtBats.filter((ab) => ab.mode === "hitting" && ab.opponent_pitcher_id !== null);
  if (withKnownPitcher.length === 0) return null;

  const counts = new Map<string, number>();
  for (const ab of withKnownPitcher) {
    counts.set(ab.opponent_pitcher_id!, (counts.get(ab.opponent_pitcher_id!) ?? 0) + 1);
  }
  const pitcherId = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0][0];
  const theseAtBats = withKnownPitcher.filter((ab) => ab.opponent_pitcher_id === pitcherId);

  const supabase = createClient();
  const [{ data: pitcherInfo }, { data: pitches }] = await Promise.all([
    supabase.from("opponent_players").select("name, jersey_number").eq("id", pitcherId).maybeSingle(),
    supabase
      .from("pitches")
      .select("at_bat_id, pitch_number, pitch_type, zone_x, zone_y, outcome")
      .in(
        "at_bat_id",
        theseAtBats.map((ab) => ab.id)
      ),
  ]);
  if (!pitcherInfo) return null;

  const lastPitchTypeByAtBat = new Map<string, PitchType | null>();
  for (const ab of theseAtBats) {
    const forThisAtBat = (pitches ?? []).filter((p) => p.at_bat_id === ab.id);
    const last = forThisAtBat.sort((a, b) => b.pitch_number - a.pitch_number)[0];
    lastPitchTypeByAtBat.set(ab.id, last?.pitch_type ?? null);
  }

  const playerNameById = new Map(players.map((p) => [p.id, p.name]));
  const batterLines = computeBatterLinesVsPitcher(theseAtBats, playerNameById);
  const team = teamAvgAgainst(theseAtBats);
  const arsenal = computePitchArsenal(pitches ?? []);
  const pitchTypeLines = computeBatterLinesByPitchType(
    theseAtBats
      .filter((ab): ab is typeof ab & { result: NonNullable<typeof ab.result> } => ab.result !== null)
      .map((ab) => ({ result: ab.result, pitchType: lastPitchTypeByAtBat.get(ab.id) ?? null }))
  );

  return {
    pitcherName: pitcherInfo.name,
    jerseyNumber: pitcherInfo.jersey_number,
    teamAvgAgainst: team.avg,
    bestBatter: batterLines[0] ? { name: batterLines[0].playerName, avg: batterLines[0].avg } : null,
    worstBatter:
      batterLines.length > 1 ? { name: batterLines[batterLines.length - 1].playerName, avg: batterLines[batterLines.length - 1].avg } : null,
    toughestPitchType: pitchTypeLines[0] ? { pitchType: pitchTypeLines[0].pitchType, avg: pitchTypeLines[0].avg } : null,
    topPitch: arsenal[0] ? { pitchType: arsenal[0].pitchType, pct: arsenal[0].pct } : null,
  };
}
