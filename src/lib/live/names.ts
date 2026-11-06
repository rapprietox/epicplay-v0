// Single shared name formatter for the public live view
// (src/app/live/[token]/live-view.tsx and the /api/live/[token] route
// that feeds it) -- per the request's "in one constant" requirement,
// every Lions (our own roster) name shown on that page goes through
// this one function, never a one-off slice/split at the call site.

// "Mike Castillo" -> "Mike C." -- first name plus last-initial, the
// level of identification a public broadcast viewer needs without
// publishing a full roster name. A single-word name (no last name on
// file) has no initial to add, so it's shown as-is rather than
// fabricating one.
export function lionsDisplayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? fullName;
  const first = parts[0];
  const lastInitial = parts[parts.length - 1][0]?.toUpperCase() ?? "";
  return lastInitial ? `${first} ${lastInitial}.` : first;
}

// Opponent identity: a real name only when this game's opponent has an
// imported roster (an opponent_players row exists for this opponent at
// all) -- otherwise a jersey-number-only "Opp #N", and a bare
// "Opponent" when not even a number is known. `hasRoster` is a
// per-game fact (does this game's opponent have ANY opponent_players
// rows), not per-player -- a free-text name typed into a field like
// game_state.opponent_batter_name without a real roster import still
// renders as "Opp #N" or "Opponent", matching the request's literal
// "opponent lineup exists for that game... otherwise" framing.
export function opponentDisplayName(hasRoster: boolean, name: string | null, jerseyNumber: string | null): string {
  if (hasRoster && name) return name;
  if (jerseyNumber && jerseyNumber !== "—") return `Opp #${jerseyNumber}`;
  return "Opponent";
}
