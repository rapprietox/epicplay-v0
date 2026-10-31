"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { LineupDraftSlot } from "@/lib/supabase/types";
import { saveLineupAndUmpire, type LineupSlot } from "./actions";

// Same inline guard as actions.ts/live-feedback-actions.ts/
// full-lineup-analysis-actions.ts in this directory -- duplicated on
// purpose, matching this directory's own existing convention, rather
// than introduced as a new shared import.
async function requireCoachGame(gameId: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { data: profile } = await supabase.from("profiles").select("role, team_id").eq("id", user.id).single();
  if (!profile || profile.role !== "coach" || !profile.team_id) {
    throw new Error("Not authorized");
  }

  const { data: game } = await supabase.from("games").select("*").eq("id", gameId).eq("team_id", profile.team_id).single();
  if (!game) throw new Error("Game not found");

  return { supabase, teamId: profile.team_id, game };
}

export interface LineupDraft {
  id: string;
  name: string;
  slots: LineupDraftSlot[];
  analysis: Record<string, unknown> | null;
  reliability: number | null;
  updatedAt: string;
}

function toDraft(row: {
  id: string;
  name: string;
  slots: LineupDraftSlot[];
  analysis: Record<string, unknown> | null;
  reliability: number | null;
  updated_at: string;
}): LineupDraft {
  return { id: row.id, name: row.name, slots: row.slots, analysis: row.analysis, reliability: row.reliability, updatedAt: row.updated_at };
}

// Called once from page.tsx (a Server Component) on every load -- same
// "ensure/create on first read" shape as getOrCreateInitialAssessment
// (src/app/player/clubhouse/kairos-actions.ts) already uses in this
// codebase, not a new pattern. Two things happen here, both one-time:
//
// 1. If this game has no drafts yet, create one ("Plan A") seeded from
//    whatever's currently in the official `lineup` table (empty if
//    nothing's been saved yet) -- so a game already mid-setup under the
//    old flow doesn't lose that work.
// 2. If this game already has official status='starting' lineup rows
//    but lineup_confirmed_at is still null (set up before this feature
//    existed), backfill lineup_confirmed_at to now() -- a one-time
//    migration stamp, not a live "is it locked" check recomputed on
//    every render. That's deliberate: deriving "locked" from "does
//    `lineup` currently have rows" on every load would make Unlock
//    impossible to make stick for one of these older games (the old
//    rows are still sitting there even after Unlock, since Unlock only
//    clears the timestamp, not the table) -- stamping it once up front
//    means lineup_confirmed_at is the ONE source of truth for "locked"
//    from this point on, for every game, old or new.
export async function ensureDraftsAndLock(gameId: string): Promise<{ drafts: LineupDraft[]; lineupConfirmedAt: string | null }> {
  const { supabase, game } = await requireCoachGame(gameId);

  const { data: draftRows } = await supabase
    .from("lineup_drafts")
    .select("*")
    .eq("game_id", gameId)
    .order("created_at", { ascending: true });

  let drafts = (draftRows ?? []).map(toDraft);

  const { data: lineupRows } = await supabase.from("lineup").select("*").eq("game_id", gameId);
  const hasStartingRows = (lineupRows ?? []).some((l) => l.status === "starting");

  if (drafts.length === 0) {
    const slots: LineupDraftSlot[] = (lineupRows ?? []).map((l) => ({
      batting_order: l.batting_order,
      player_id: l.player_id,
      position: l.position,
      status: (l.status ?? "reserve") as LineupDraftSlot["status"],
    }));
    const { data: created, error } = await supabase
      .from("lineup_drafts")
      .insert({ game_id: gameId, team_id: game.team_id, name: "Plan A", slots })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    drafts = [toDraft(created)];
  }

  let lineupConfirmedAt = game.lineup_confirmed_at;
  if (lineupConfirmedAt === null && hasStartingRows) {
    const { data: updated, error } = await supabase
      .from("games")
      .update({ lineup_confirmed_at: new Date().toISOString() })
      .eq("id", gameId)
      .select("lineup_confirmed_at")
      .single();
    if (error) throw new Error(error.message);
    lineupConfirmedAt = updated.lineup_confirmed_at;
  }

  return { drafts, lineupConfirmedAt };
}

export async function createDraft(
  gameId: string,
  name: string,
  slots: LineupDraftSlot[],
  copyFrom?: { analysis: Record<string, unknown> | null; reliability: number | null }
): Promise<LineupDraft> {
  const { supabase, game } = await requireCoachGame(gameId);
  const { data, error } = await supabase
    .from("lineup_drafts")
    .insert({
      game_id: gameId,
      team_id: game.team_id,
      name,
      slots,
      analysis: copyFrom?.analysis ?? null,
      reliability: copyFrom?.reliability ?? null,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return toDraft(data);
}

export async function renameDraft(gameId: string, draftId: string, name: string): Promise<void> {
  const { supabase } = await requireCoachGame(gameId);
  const { error } = await supabase.from("lineup_drafts").update({ name }).eq("id", draftId).eq("game_id", gameId);
  if (error) throw new Error(error.message);
}

export type DeleteDraftResult = { ok: true } | { ok: false; error: string };

export async function deleteDraft(gameId: string, draftId: string): Promise<DeleteDraftResult> {
  const { supabase } = await requireCoachGame(gameId);
  const { count } = await supabase.from("lineup_drafts").select("id", { count: "exact", head: true }).eq("game_id", gameId);
  if ((count ?? 0) <= 1) return { ok: false, error: "Can't delete the only draft -- create another one first." };
  const { error } = await supabase.from("lineup_drafts").delete().eq("id", draftId).eq("game_id", gameId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Autosave target -- debounced on the client (lineup-builder.tsx), plus
// called immediately by the explicit "Save Draft" button.
export async function saveDraftSlots(gameId: string, draftId: string, slots: LineupDraftSlot[]): Promise<void> {
  const { supabase } = await requireCoachGame(gameId);
  const { error } = await supabase
    .from("lineup_drafts")
    .update({ slots, updated_at: new Date().toISOString() })
    .eq("id", draftId)
    .eq("game_id", gameId);
  if (error) throw new Error(error.message);
}

// Called after every successful getFullLineupAnalysis() call (manual
// button or the panel's own debounced auto-run) so reopening this draft
// later shows the cached result instead of re-calling the AI.
export async function saveDraftAnalysis(
  gameId: string,
  draftId: string,
  analysis: Record<string, unknown>,
  reliability: number
): Promise<void> {
  const { supabase } = await requireCoachGame(gameId);
  const { error } = await supabase
    .from("lineup_drafts")
    .update({ analysis, reliability, updated_at: new Date().toISOString() })
    .eq("id", draftId)
    .eq("game_id", gameId);
  if (error) throw new Error(error.message);
}

// Umpire name lives on `games` directly (not per-draft -- the umpire
// doesn't change between lineup plans), saved independently of any
// draft/lock action so it autosaves on its own.
export async function saveUmpireName(gameId: string, umpireName: string): Promise<void> {
  const { supabase } = await requireCoachGame(gameId);
  const { error } = await supabase.from("games").update({ umpire_name: umpireName || null }).eq("id", gameId);
  if (error) throw new Error(error.message);
}

export type LockResult = { ok: true; lockedAt: string } | { ok: false; error: string };

// Copies the chosen draft's slots into the official `lineup` table and
// stamps the time. Reuses saveLineupAndUmpire (actions.ts) completely
// unmodified for the actual write -- locking a draft is exactly the
// same delete+insert that function already did on every old "Save
// Lineup"/"Start Game" click, just now triggered only here instead of
// on every edit.
export async function lockLineup(gameId: string, slots: LineupSlot[], umpireName: string): Promise<LockResult> {
  const { supabase } = await requireCoachGame(gameId);
  const startingCount = slots.filter((s) => s.status === "starting").length;
  if (startingCount < 9) return { ok: false, error: "Lineup needs at least 9 players before it can be locked" };

  await saveLineupAndUmpire(gameId, { lineup: slots, umpireName });

  const lockedAt = new Date().toISOString();
  const { error } = await supabase.from("games").update({ lineup_confirmed_at: lockedAt }).eq("id", gameId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/coach/games/${gameId}/setup`);
  return { ok: true, lockedAt };
}

// Clears the lock -- the official `lineup` rows from the last lock stay
// exactly as they are (Unlock never deletes them) until the coach locks
// again, which overwrites them with whichever draft is active at that
// point.
export async function unlockLineup(gameId: string): Promise<void> {
  const { supabase } = await requireCoachGame(gameId);
  const { error } = await supabase.from("games").update({ lineup_confirmed_at: null }).eq("id", gameId);
  if (error) throw new Error(error.message);
  revalidatePath(`/coach/games/${gameId}/setup`);
}
