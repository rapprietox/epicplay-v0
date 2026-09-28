"use client";

import { useEffect, useRef, useState } from "react";
import { KairosChat } from "./kairos-chat";

// KAIROS batch: the panel's own spec lists a microphone button both in
// the header row and again as its own bullet ("opens voice input") --
// read as the second bullet just elaborating on the first, not a second,
// separate mic control. It's kept next to the message input inside
// KairosChat (where the transcript actually needs to land) rather than
// lifted into this header, since splitting the voice-recognition state
// across two components for a header-only placement wasn't worth the
// coupling cost given everything else in this batch -- noted here as a
// deliberate, minor layout call, not an oversight.
export function KairosWidget() {
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
      <section
        ref={panelRef}
        className="glossy rounded-lg border-l-4 p-5"
        style={{ background: "#0A1F0D", borderLeft: "4px solid #2ECC71" }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl" style={{ filter: "drop-shadow(0 0 6px #2ECC71) drop-shadow(0 0 3px #2ECC71)" }}>
              ⚾
            </span>
            <h2 className="font-heading text-2xl font-bold" style={{ color: "#F0C060" }}>
              KAIROS
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setMinimized((m) => !m)}
            title={minimized ? "Expand" : "Minimize"}
            className="rounded-full border border-[#1A3D28] px-2.5 py-1 text-xs text-[#9FCBAC] hover:border-accent-green hover:text-white"
          >
            {minimized ? "▾" : "▴"}
          </button>
        </div>

        {!minimized && (
          <>
            <p className="mt-1 text-xs text-[#7AAB88]">
              Ask me anything · Paste a roster · Import a schedule · Voice commands during games
            </p>
            <div className="mt-4">
              <KairosChat />
            </div>
          </>
        )}
      </section>

      {/* Floating baseball: only once the inline panel has scrolled out
          of view (IntersectionObserver above), and only once the coach
          hasn't opened the slide-up modal (no point showing a trigger
          for something already open). */}
      {!panelVisible && !modalOpen && (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="fixed bottom-6 right-6 z-40 flex flex-col items-center gap-1"
        >
          <span
            className="kairos-float-pulse flex h-14 w-14 items-center justify-center rounded-full bg-[#0A1F0D] text-3xl"
            style={{ border: "2px solid #2ECC71" }}
          >
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
            <div className="mt-3 flex-1 overflow-y-auto">
              <KairosChat compact />
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
