"use client";

import { useState, useTransition } from "react";
import type { LineupDraftSlot } from "@/lib/supabase/types";
import type { LineupDraft } from "./draft-actions";
import { createDraft, renameDraft, deleteDraft } from "./draft-actions";

// Feature B: draft switcher -- duplicate/rename/delete/switch. Editing
// itself (placing/removing players) happens entirely in lineup-builder.tsx;
// this component only manages the *list* of drafts and which one is active.
export function DraftManager({
  gameId,
  drafts,
  activeDraftId,
  currentSlots,
  currentAnalysis,
  currentReliability,
  onSwitch,
  onDraftsChange,
}: {
  gameId: string;
  drafts: LineupDraft[];
  activeDraftId: string;
  currentSlots: LineupDraftSlot[];
  currentAnalysis: Record<string, unknown> | null;
  currentReliability: number | null;
  onSwitch: (draftId: string) => void;
  onDraftsChange: (drafts: LineupDraft[]) => void;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const activeDraft = drafts.find((d) => d.id === activeDraftId);

  function duplicateActive() {
    if (!activeDraft) return;
    setError(null);
    startTransition(async () => {
      try {
        const newDraft = await createDraft(gameId, `${activeDraft.name} copy`, currentSlots, {
          analysis: currentAnalysis,
          reliability: currentReliability,
        });
        onDraftsChange([...drafts, newDraft]);
        onSwitch(newDraft.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to duplicate draft");
      }
    });
  }

  function commitRename(draftId: string) {
    const name = renameValue.trim();
    setRenamingId(null);
    if (!name) return;
    startTransition(async () => {
      try {
        await renameDraft(gameId, draftId, name);
        onDraftsChange(drafts.map((d) => (d.id === draftId ? { ...d, name } : d)));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to rename draft");
      }
    });
  }

  function confirmDelete(draftId: string) {
    setConfirmDeleteId(null);
    setError(null);
    startTransition(async () => {
      const result = await deleteDraft(gameId, draftId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const remaining = drafts.filter((d) => d.id !== draftId);
      onDraftsChange(remaining);
      if (activeDraftId === draftId && remaining[0]) onSwitch(remaining[0].id);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {drafts.map((draft) => (
          <div
            key={draft.id}
            className={`flex items-center gap-1 rounded-md border px-2 py-1 text-sm ${
              draft.id === activeDraftId ? "border-accent-primary bg-accent-primary/15 text-white" : "border-border text-foreground/60"
            }`}
          >
            {renamingId === draft.id ? (
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => commitRename(draft.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename(draft.id);
                  if (e.key === "Escape") setRenamingId(null);
                }}
                className="w-24 rounded border border-accent-primary bg-background px-1 text-sm text-white outline-none"
              />
            ) : (
              <button type="button" onClick={() => onSwitch(draft.id)} className="min-h-[32px]">
                {draft.name}
              </button>
            )}
            <button
              type="button"
              title="Rename"
              onClick={() => {
                setRenamingId(draft.id);
                setRenameValue(draft.name);
              }}
              className="px-1 text-xs text-foreground/40 hover:text-white"
            >
              ✎
            </button>
            {confirmDeleteId === draft.id ? (
              <span className="flex items-center gap-1">
                <button type="button" onClick={() => confirmDelete(draft.id)} className="px-1 text-xs font-semibold text-accent-red">
                  Delete?
                </button>
                <button type="button" onClick={() => setConfirmDeleteId(null)} className="px-1 text-xs text-foreground/40">
                  ✕
                </button>
              </span>
            ) : (
              drafts.length > 1 && (
                <button
                  type="button"
                  title="Delete draft"
                  onClick={() => setConfirmDeleteId(draft.id)}
                  className="px-1 text-xs text-foreground/40 hover:text-accent-red"
                >
                  🗑
                </button>
              )
            )}
          </div>
        ))}

        <button
          type="button"
          onClick={duplicateActive}
          disabled={isPending}
          className="min-h-[32px] rounded-md border border-border px-2 text-xs font-medium text-foreground/70 hover:border-accent-primary disabled:opacity-50"
        >
          + Duplicate
        </button>
      </div>
      {error && <p className="text-xs text-accent-red">{error}</p>}
    </div>
  );
}
