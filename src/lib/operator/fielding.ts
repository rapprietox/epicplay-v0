import type { Database, FieldingPosition } from "@/lib/supabase/types";

type Lineup = Database["public"]["Tables"]["lineup"]["Row"];
type Player = Database["public"]["Tables"]["players"]["Row"];
type OpponentPlayer = Database["public"]["Tables"]["opponent_players"]["Row"];

export interface ResolvedFielder {
  position: FieldingPosition;
  playerId: string | null;
  opponentPlayerId: string | null;
  name: string;
}

// Resolves "who's playing position X right now" from the current lineup
// (ours, when we're fielding -- mode 'pitching') or the opponent roster
// (theirs, when we're fielding against them -- mode 'hitting'). Both are
// derived from the position assigned at pre-game setup / the roster photo
// import rather than tracked as separate live state -- a V0 simplification
// that assumes positions stay accurate through mid-game substitutions.
export function resolveFielder(
  position: FieldingPosition,
  mode: "hitting" | "pitching",
  lineup: Lineup[],
  players: Player[],
  opponentPlayers: OpponentPlayer[]
): ResolvedFielder {
  if (mode === "pitching") {
    const slot = lineup.find((l) => l.position === position);
    const player = slot ? players.find((p) => p.id === slot.player_id) : undefined;
    return {
      position,
      playerId: player?.id ?? null,
      opponentPlayerId: null,
      name: player ? `#${player.jersey_number ?? "—"} ${player.name}` : position,
    };
  }
  const opponent = opponentPlayers.find((p) => p.position === position);
  return {
    position,
    playerId: null,
    opponentPlayerId: opponent?.id ?? null,
    name: opponent ? `#${opponent.jersey_number} ${opponent.name}` : position,
  };
}
