"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH", "EH"];

export interface PositionPickerAnchor {
  clientX: number;
  clientY: number;
  topHalf: boolean;
  leftHalf: boolean;
}

interface Placement {
  playerId: string;
  position: string;
}

// Tap-to-place, Feature A. Same portal technique as the operator
// screen's RunnerActionMenuPortal (src/app/operator/operator-console.tsx)
// and strike-zone-grid.tsx's PopupPortal: portaled straight to
// <body>, position: fixed in real viewport pixels anchored off the tap
// point, then a post-render getBoundingClientRect() check nudges it
// back on-screen -- a CSS-only quadrant guess can't know the menu's
// actual rendered size, only measuring it after paint can guarantee it
// never overflows the viewport, which matters most on a phone.
export function PositionPickerMenu({
  anchor,
  playerId,
  playerLabel,
  placements,
  playerName,
  onPick,
  onRemove,
  onClose,
}: {
  anchor: PositionPickerAnchor;
  playerId: string;
  playerLabel: string;
  placements: Placement[];
  playerName: (playerId: string) => string;
  onPick: (position: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  const [nudge, setNudge] = useState({ dx: 0, dy: 0 });
  const [pendingReplace, setPendingReplace] = useState<{ position: string; occupantName: string } | null>(null);

  useLayoutEffect(() => {
    setNudge({ dx: 0, dy: 0 });
    const el = popupRef.current;
    if (!el) return;
    const margin = 16;
    const rect = el.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    if (rect.left < margin) dx = margin - rect.left;
    else if (rect.right > window.innerWidth - margin) dx = window.innerWidth - margin - rect.right;
    if (rect.top < margin) dy = margin - rect.top;
    else if (rect.bottom > window.innerHeight - margin) dy = window.innerHeight - margin - rect.bottom;
    if (dx !== 0 || dy !== 0) setNudge({ dx, dy });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingReplace]);

  if (typeof document === "undefined") return null;

  const currentPosition = placements.find((p) => p.playerId === playerId)?.position ?? null;
  const gap = 8;
  const baseTransform = `translate(${anchor.leftHalf ? "0" : "-100%"}, ${anchor.topHalf ? `${gap}px` : `calc(-100% - ${gap}px)`})`;

  function handlePositionTap(position: string) {
    if (position === currentPosition) {
      onClose();
      return;
    }
    const occupant = placements.find((p) => p.position === position);
    if (occupant) {
      setPendingReplace({ position, occupantName: playerName(occupant.playerId) });
      return;
    }
    onPick(position);
  }

  return createPortal(
    <>
      {/* Transparent full-screen backdrop -- tapping anywhere outside
          the menu closes it, same as the runner menu's own pattern. */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        ref={popupRef}
        className="fixed z-50"
        style={{
          left: anchor.clientX,
          top: anchor.clientY,
          transform: `${baseTransform} translate(${nudge.dx}px, ${nudge.dy}px)`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="glossy w-[220px] rounded-lg border border-border bg-surface p-2 shadow-2xl">
          <p className="px-1 pb-1.5 text-xs font-semibold uppercase tracking-wide text-foreground/50">{playerLabel}</p>

          {pendingReplace ? (
            <div className="flex flex-col gap-2 p-1">
              <p className="text-sm text-white">
                Replace <span className="font-semibold">{pendingReplace.occupantName}</span> at {pendingReplace.position}?
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onPick(pendingReplace.position)}
                  className="min-h-[48px] flex-1 rounded-md bg-accent-green px-2 text-sm font-semibold text-white hover:bg-accent-green/90"
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={() => setPendingReplace(null)}
                  className="min-h-[48px] flex-1 rounded-md border border-border text-sm font-medium text-white hover:border-accent-primary"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {POSITIONS.map((position) => {
                const occupant = placements.find((p) => p.position === position);
                const isCurrent = position === currentPosition;
                return (
                  <button
                    key={position}
                    type="button"
                    onClick={() => handlePositionTap(position)}
                    className={`flex min-h-[48px] items-center justify-between rounded-md px-2 text-sm transition ${
                      isCurrent
                        ? "bg-accent-primary/20 text-white"
                        : occupant
                          ? "text-foreground/70 hover:bg-background/60"
                          : "text-white hover:bg-background/60"
                    }`}
                  >
                    <span className="font-semibold">{position}</span>
                    <span className="truncate text-xs text-foreground/50">
                      {isCurrent ? "current" : occupant ? playerName(occupant.playerId) : "Empty"}
                    </span>
                  </button>
                );
              })}

              {currentPosition && (
                <button
                  type="button"
                  onClick={onRemove}
                  className="mt-1 min-h-[48px] rounded-md border border-accent-red/40 px-2 text-sm font-medium text-accent-red hover:bg-accent-red/10"
                >
                  Remove from lineup
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}

export function anchorFromEvent(e: { clientX: number; clientY: number }): PositionPickerAnchor {
  return {
    clientX: e.clientX,
    clientY: e.clientY,
    topHalf: e.clientY < window.innerHeight / 2,
    leftHalf: e.clientX < window.innerWidth / 2,
  };
}
