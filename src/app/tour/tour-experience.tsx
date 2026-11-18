"use client";

import { useCallback, useEffect, useState } from "react";
import { TOUR_SECTIONS } from "./tour-sections";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function TourExperience() {
  const [presenting, setPresenting] = useState(false);
  const [index, setIndex] = useState(0);
  const [notesVisible, setNotesVisible] = useState(false);

  const enterPresenter = useCallback(() => {
    setPresenting(true);
    setNotesVisible(false);
  }, []);

  const exitPresenter = useCallback(() => {
    setPresenting(false);
    setNotesVisible(false);
  }, []);

  const goTo = useCallback((next: number) => {
    setIndex(Math.max(0, Math.min(TOUR_SECTIONS.length - 1, next)));
    setNotesVisible(false);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;

      if (!presenting) {
        if (e.key === "p" || e.key === "P") {
          e.preventDefault();
          enterPresenter();
        }
        return;
      }

      switch (e.key) {
        case "Escape":
          e.preventDefault();
          exitPresenter();
          break;
        case "p":
        case "P":
          e.preventDefault();
          exitPresenter();
          break;
        case "ArrowRight":
        case "ArrowDown":
          e.preventDefault();
          setIndex((i) => Math.min(TOUR_SECTIONS.length - 1, i + 1));
          setNotesVisible(false);
          break;
        case "ArrowLeft":
        case "ArrowUp":
          e.preventDefault();
          setIndex((i) => Math.max(0, i - 1));
          setNotesVisible(false);
          break;
        case "n":
        case "N":
          e.preventDefault();
          setNotesVisible((v) => !v);
          break;
        default:
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [presenting, enterPresenter, exitPresenter]);

  if (presenting) {
    const section = TOUR_SECTIONS[index];
    return (
      <div className="tour-root tour-present" role="region" aria-label="EpicPlay AI tour, presenter mode">
        <span className="tour-exit-hint">
          Esc to exit · <span className="tour-kbd">←</span>
          <span className="tour-kbd">→</span> navigate · <span className="tour-kbd">N</span> notes
        </span>
        <div className="tour-present-stage">
          <div className="tour-section-inner tour-present-slide" key={section.id}>
            <p className="tour-eyebrow">{section.eyebrow}</p>
            <h2 className="tour-h2">{section.title}</h2>
            {section.content}
          </div>
        </div>
        {notesVisible && (
          <div className="tour-notes" aria-label="Speaker notes">
            <h3>Speaker notes</h3>
            {section.notes}
          </div>
        )}
        <div className="tour-present-bar">
          <button type="button" className="tour-present-nav-btn" onClick={() => goTo(index - 1)} disabled={index === 0}>
            ← Prev
          </button>
          <span className="tour-progress">
            {index + 1} / {TOUR_SECTIONS.length}
          </span>
          <button type="button" className="tour-present-nav-btn" onClick={() => goTo(index + 1)} disabled={index === TOUR_SECTIONS.length - 1}>
            Next →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="tour-root">
      <div className="tour-topbar">
        <span className="tour-wordmark">EpicPlay AI — Tour</span>
        <button type="button" className="tour-present-btn" onClick={enterPresenter}>
          Presenter mode <span className="tour-kbd">P</span>
        </button>
      </div>
      <main className="tour-scroll">
        {TOUR_SECTIONS.map((section) => (
          <section key={section.id} className="tour-section" id={section.id}>
            <div className="tour-section-inner">
              <p className="tour-eyebrow">{section.eyebrow}</p>
              <h2 className="tour-h2">{section.title}</h2>
              {section.content}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
