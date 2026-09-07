import type { Database } from "@/lib/supabase/types";

type AtBat = Database["public"]["Tables"]["at_bats"]["Row"];
type StolenBase = Database["public"]["Tables"]["stolen_bases"]["Row"];
type Game = Database["public"]["Tables"]["games"]["Row"];

const HIT_RESULTS = new Set(["single", "double", "triple", "hr"]);

export interface BattingLine {
  playerId: string;
  ab: number;
  h: number;
  doubles: number;
  triples: number;
  hr: number;
  bb: number;
  hbp: number;
  rbi: number;
  runsScored: number;
  sb: number;
  avg: number;
  obp: number;
  slg: number;
  ops: number;
}

function emptyBattingLine(playerId: string): BattingLine {
  return {
    playerId,
    ab: 0,
    h: 0,
    doubles: 0,
    triples: 0,
    hr: 0,
    bb: 0,
    hbp: 0,
    rbi: 0,
    runsScored: 0,
    sb: 0,
    avg: 0,
    obp: 0,
    slg: 0,
    ops: 0,
  };
}

// OBP/SLG here don't distinguish sacrifice flies (not tracked in the
// schema) -- a documented V0 simplification, not an oversight.
export function computeBattingLines(
  atBats: Pick<AtBat, "player_id" | "result" | "rbi" | "runs_scored">[],
  stolenBases: Pick<StolenBase, "player_id">[]
): Map<string, BattingLine> {
  const lines = new Map<string, BattingLine>();

  const get = (playerId: string) => {
    let line = lines.get(playerId);
    if (!line) {
      line = emptyBattingLine(playerId);
      lines.set(playerId, line);
    }
    return line;
  };

  for (const ab of atBats) {
    const line = get(ab.player_id);
    line.rbi += ab.rbi;
    line.runsScored += ab.runs_scored;

    if (ab.result === "walk") {
      line.bb += 1;
      continue;
    }
    if (ab.result === "hbp") {
      line.hbp += 1;
      continue;
    }

    line.ab += 1;
    if (HIT_RESULTS.has(ab.result)) line.h += 1;
    if (ab.result === "double") line.doubles += 1;
    if (ab.result === "triple") line.triples += 1;
    if (ab.result === "hr") line.hr += 1;
  }

  for (const sb of stolenBases) {
    get(sb.player_id).sb += 1;
  }

  for (const line of Array.from(lines.values())) {
    const totalBases = line.h - line.doubles - line.triples - line.hr + line.doubles * 2 + line.triples * 3 + line.hr * 4;
    const obpDenominator = line.ab + line.bb + line.hbp;
    line.avg = line.ab > 0 ? line.h / line.ab : 0;
    line.obp = obpDenominator > 0 ? (line.h + line.bb + line.hbp) / obpDenominator : 0;
    line.slg = line.ab > 0 ? totalBases / line.ab : 0;
    line.ops = line.obp + line.slg;
  }

  return lines;
}

export interface PitchingLine {
  playerId: string;
  outs: number;
  ip: number;
  ipDisplay: string;
  k: number;
  bbAllowed: number;
  hAllowed: number;
  runsAllowed: number;
  wins: number;
  era: number | null;
  whip: number | null;
}

function emptyPitchingLine(playerId: string): PitchingLine {
  return {
    playerId,
    outs: 0,
    ip: 0,
    ipDisplay: "0.0",
    k: 0,
    bbAllowed: 0,
    hAllowed: 0,
    runsAllowed: 0,
    wins: 0,
    era: null,
    whip: null,
  };
}

// pitcher_id is unpopulated until the operator game-logging screen exists
// (future sprint), so this returns an empty map for now -- callers should
// render a blank/dash state for pitching stats rather than treat it as an
// error. ERA treats every run allowed as earned (no earned/unearned
// tracking) -- a documented V0 simplification.
export function computePitchingLines(
  atBats: Pick<AtBat, "pitcher_id" | "result" | "is_out" | "runs_scored">[],
  games: Pick<Game, "winning_pitcher_id">[]
): Map<string, PitchingLine> {
  const lines = new Map<string, PitchingLine>();

  const get = (playerId: string) => {
    let line = lines.get(playerId);
    if (!line) {
      line = emptyPitchingLine(playerId);
      lines.set(playerId, line);
    }
    return line;
  };

  for (const ab of atBats) {
    if (!ab.pitcher_id) continue;
    const line = get(ab.pitcher_id);
    if (ab.is_out) line.outs += 1;
    if (ab.result === "strikeout") line.k += 1;
    if (ab.result === "walk") line.bbAllowed += 1;
    if (HIT_RESULTS.has(ab.result)) line.hAllowed += 1;
    line.runsAllowed += ab.runs_scored;
  }

  for (const game of games) {
    if (game.winning_pitcher_id) {
      get(game.winning_pitcher_id).wins += 1;
    }
  }

  for (const line of Array.from(lines.values())) {
    line.ip = line.outs / 3;
    line.ipDisplay = `${Math.floor(line.outs / 3)}.${line.outs % 3}`;
    line.era = line.ip > 0 ? (line.runsAllowed / line.ip) * 9 : null;
    line.whip = line.ip > 0 ? (line.hAllowed + line.bbAllowed) / line.ip : null;
  }

  return lines;
}

export function formatAvg(value: number): string {
  return value.toFixed(3).replace(/^0\./, ".");
}
