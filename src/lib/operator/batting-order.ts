// Shared by the reducer (advancing/reversing to the next/previous real
// batter) and the operator console (the on-deck panel + the Quick Mode
// lineup strip), so all three agree on what "next"/"previous" means
// once a lineup's batting_order values aren't a contiguous 1-9 run.
//
// Gaps are a real, intentional side effect of the lineup builder's
// "never renumber a vacated slot" design (see lineup-builder.tsx's
// placePlayer/removePlayer comments) -- a saved lineup can legitimately
// have slots like 1,3,4,5,7,8,9,10,12 if a player was placed and later
// removed during setup. The old `(position % 9) + 1` arithmetic assumed
// a dense 1-9 range; once it landed on a gap, battingOrderPosition held
// a value nobody actually occupies, which the current-batter lookup,
// the on-deck panel, and the lineup strip then each handled
// differently -- the root cause of a since-fixed bug where they
// disagreed about who was up and who was on deck.
//
// Both functions fall back to the first/last occupied slot if `current`
// itself isn't a real slot (shouldn't happen once callers only ever
// feed back a value these functions themselves produced, but a lineup
// can't be assumed non-empty at the very first at-bat of a game).
// `occupiedSlots ?? []` guards a localStorage snapshot saved before
// this field existed on OperatorState -- HYDRATE can load one of those
// verbatim (see operator-console.tsx's "if (local && local.dirty)"
// effect), which would otherwise crash here with `undefined` instead
// of a real array the very first time a stale snapshot from before
// this fix gets restored.
export function nextBattingOrderPosition(occupiedSlots: number[], current: number): number {
  const slots = occupiedSlots ?? [];
  if (slots.length === 0) return current;
  const sorted = [...slots].sort((a, b) => a - b);
  const idx = sorted.indexOf(current);
  if (idx === -1) return sorted[0];
  return sorted[(idx + 1) % sorted.length];
}

export function previousBattingOrderPosition(occupiedSlots: number[], current: number): number {
  const slots = occupiedSlots ?? [];
  if (slots.length === 0) return current;
  const sorted = [...slots].sort((a, b) => a - b);
  const idx = sorted.indexOf(current);
  if (idx === -1) return sorted[sorted.length - 1];
  return sorted[(idx - 1 + sorted.length) % sorted.length];
}
