// Shared by the reducer (advancing to the next real batter) and the
// operator console (the on-deck panel + the Quick Mode lineup strip), so
// all three agree on what "next" means once a lineup's batting_order
// values aren't a contiguous 1-9 run.
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
// Falls back to the first occupied slot if `current` itself isn't a
// real slot (shouldn't happen once callers only ever feed back a value
// this function itself produced, but a lineup can't be assumed
// non-empty at the very first at-bat of a game). `occupiedSlots ?? []`
// guards a localStorage snapshot saved before this field existed on
// OperatorState -- HYDRATE can load one of those verbatim (see
// operator-console.tsx's "if (local && local.dirty)" effect), which
// would otherwise crash here with `undefined` instead of a real array
// the very first time a stale snapshot from before this fix gets
// restored.
export function nextBattingOrderPosition(occupiedSlots: number[], current: number): number {
  const slots = occupiedSlots ?? [];
  if (slots.length === 0) return current;
  const sorted = [...slots].sort((a, b) => a - b);
  const idx = sorted.indexOf(current);
  if (idx === -1) return sorted[0];
  return sorted[(idx + 1) % sorted.length];
}

// Batting-order Undo fix: previousBattingOrderPosition (the inverse of
// the function above, "go back one slot from wherever we currently
// are") used to back Undo -- removed, not kept unused, once Undo
// started restoring an explicit snapshot (OperatorState.lastConfirmed.
// battingOrderPosition) instead. The arithmetic itself was the bug:
// "one slot back from whatever battingOrderPosition currently is" gives
// the wrong answer the moment anything else has touched that value
// since the play it's meant to undo advanced it -- a race between two
// overlapping requests, a retried write, anything -- since arithmetic
// has no way to tell "untouched since this play" apart from "touched by
// something else." Restoring a value captured once, before the play
// ever changed anything, can't have that problem.

// Lineup-builder batch: placePlayer/removePlayer now keep every NEW
// draft's batting order dense (1..N, renumbered on every change that
// actually frees a slot -- see lineup-builder.tsx), so a lineup locked
// from here on should never have a gap in the first place. This exists
// purely as a read-time safety net for a game whose official `lineup`
// rows were already saved with gaps under the old behavior (like the
// dummy test game, saved before this batch) -- called wherever the
// operator screen loads a game's lineup, so it never has to reason
// about gaps at all, regardless of how the data got that way. Pure and
// read-only: never writes the renumbered values back to the database.
export function normalizeLineupBattingOrder<T extends { batting_order: number | null }>(rows: T[]): T[] {
  const withOrder = rows
    .filter((r): r is T & { batting_order: number } => r.batting_order !== null)
    .sort((a, b) => a.batting_order - b.batting_order);
  const withoutOrder = rows.filter((r) => r.batting_order === null);
  const renumbered = withOrder.map((r, i) => ({ ...r, batting_order: i + 1 }));
  return [...renumbered, ...withoutOrder];
}
