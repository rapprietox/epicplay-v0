"use client";

import { useEffect, useRef, useState } from "react";
import { KairosChat } from "./kairos-chat";

// Clubhouse Pro enhancement, Part 3: a straight copy of the coach's
// src/app/coach/kairos-widget.tsx IntersectionObserver + floating-
// baseball + slide-up-modal mechanism (fully generic, no team/coach
// coupling in the original), swapping teamId for playerId and rendering
// the player-scoped KairosChat above. Satisfies "floating baseball also
// appears on player Clubhouse when scrolled."
export function KairosWidget({ playerId }: { playerId: string }) {
  const [minimized, setMinimized] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [panelVisible, setPanelVisible] = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = panelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setPanelVisible(entry.isIntersecting), { threshold: 0 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <section ref={panelRef} className="glossy rounded-lg border-l-4 p-3" style={{ background: "#0A1F0D", borderLeft: "4px solid #2ECC71" }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base" style={{ filter: "drop-shadow(0 0 6px #2ECC71) drop-shadow(0 0 3px #2ECC71)" }}>
              ⚾
            </span>
            <h2 className="font-heading text-base font-bold" style={{ color: "#F0C060" }}>
              KAIROS
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setMinimized((m) => !m)}
            title={minimized ? "Expand" : "Minimize"}
            className="rounded-full border border-[#1A3D28] px-2 py-0.5 text-xs text-[#9FCBAC] hover:border-accent-green hover:text-white"
          >
            {minimized ? "▾" : "▴"}
          </button>
        </div>

        {!minimized && (
          <div className="mt-1.5">
            <KairosChat playerId={playerId} variant="dashboard" />
          </div>
        )}
      </section>

      {!panelVisible && !modalOpen && (
        <button type="button" onClick={() => setModalOpen(true)} className="fixed bottom-6 right-6 z-40 flex flex-col items-center gap-1">
          <span className="kairos-float-pulse flex h-14 w-14 items-center justify-center rounded-full bg-[#0A1F0D] text-3xl" style={{ border: "2px solid #2ECC71" }}>
            ⚾
          </span>
          <span className="text-[11px] text-[#9FCBAC]">Ask Kairos</span>
        </button>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-end sm:justify-end sm:p-6">
          <div
            className="kairos-modal-slide-up glossy flex w-full max-h-[60vh] flex-col rounded-t-lg border-l-4 p-5 sm:max-w-md sm:rounded-lg"
            style={{ background: "#0A1F0D", borderLeft: "4px solid #2ECC71" }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="text-xl" style={{ filter: "drop-shadow(0 0 6px #2ECC71) drop-shadow(0 0 3px #2ECC71)" }}>
                  ⚾
                </span>
                <h2 className="font-heading text-xl font-bold" style={{ color: "#F0C060" }}>
                  KAIROS
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                title="Close"
                className="rounded-full border border-[#1A3D28] px-2.5 py-1 text-xs text-[#9FCBAC] hover:border-accent-red hover:text-accent-red"
              >
                ✕
              </button>
            </div>
            {/* Five-fixes batch, Fix 3: this used to be the scrollable
                container (overflow-y-auto) around the WHOLE chat,
                including the input row -- if the message list grew, the
                input/send button could scroll out of frame with no
                visible cue. KairosChat now owns its own internal layout
                (only its message list scrolls, the input row stays
                pinned below it) -- this wrapper just needs to give it a
                bounded height to lay out against (min-h-0 is what lets
                a flex child shrink below its content size instead of
                forcing the modal itself to grow past max-h-[60vh]). */}
            <div className="mt-3 min-h-0 flex-1">
              <KairosChat playerId={playerId} variant="modal" />
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes kairos-pulse {
          0%, 100% { box-shadow: 0 0 12px #2ECC71, 0 0 24px #2ECC71; }
          50% { box-shadow: 0 0 6px #2ECC71, 0 0 14px #2ECC71; }
        }
        .kairos-float-pulse {
          animation: kairos-pulse 2s ease-in-out infinite;
        }
        @keyframes kairos-slide-up {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        .kairos-modal-slide-up {
          animation: kairos-slide-up 0.25s ease-out;
        }
      `}</style>
    </>
  );
}
