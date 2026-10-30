"use client";

import { useEffect, useRef, useState } from "react";
import { KAIROS_IMAGE_SRC } from "../constants";

interface Conversation {
  role: string;
  chip: string;
  prompt: string;
  response: string;
}

// Sample data -- illustrative only. See the chip row's own "Sample
// data" label below. Clicking a chip jumps straight to its
// conversation; the three also auto-cycle once the section scrolls
// into view, matching the original ambient-terminal feel.
const CONVERSATIONS: Conversation[] = [
  {
    role: "COACH",
    chip: "Who should bat leadoff?",
    prompt: "Who bats leadoff tonight?",
    response:
      "Marcus Johnson. .500 OBP, Speed 4/5,\n3 stolen bases this season. He reaches base\nevery other at-bat and creates chaos on the\nbases for your power hitters.\n\nDiego Reyes has better AVG but Speed 1/5 —\nhis power belongs in slot 3 or 4.\n\n📊 31% reliable · 3 games · building...",
  },
  {
    role: "COACH",
    chip: "Why did we lose?",
    prompt: "We lost last night. What went wrong?",
    response:
      "Three things cost you the game.\n\n1. Tyler Chen (slot 8) struck out all\n   3 at-bats — predictable from his data.\n\n2. Your 5-6-7 slots: 0 RBI with 4 runners\n   in scoring position.\n\n3. Kenji Tanaka's ERA vs lefties: 9.00.\n   They started 4 lefties against you.\n\nNext game: Move Miguel Santos to slot 6.",
  },
  {
    role: "PLAYER",
    chip: "What should I practice?",
    prompt: "What should I practice this week?",
    response:
      "Carlos, pitchers have found your\nweakness. 41% of all pitches go low-outside.\nYour whiff rate there: 67%.\n\nThat's not bad luck. That's a pattern.\n\nWeek 1: Stand in. Don't swing low-outside.\nTrack how many you correctly identify.\nTarget: 70% recognition rate by Friday.",
  },
];

export function Kairos() {
  const terminalRef = useRef<HTMLDivElement>(null);
  const [convoIndex, setConvoIndex] = useState(0);
  const [promptText, setPromptText] = useState("");
  const [responseText, setResponseText] = useState("");
  const startedRef = useRef(false);
  // Falls back to the orb if /kairos.png doesn't exist (it doesn't
  // yet) -- onError fires on the 404 and this just never renders the
  // <img> again, so nothing breaks.
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    const el = terminalRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !startedRef.current) {
            startedRef.current = true;
            setConvoIndex(0);
          }
        });
      },
      { threshold: 0.3 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!startedRef.current) return;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const convo = CONVERSATIONS[convoIndex % CONVERSATIONS.length];
    const fullPrompt = `> ${convo.role}: ${convo.prompt}`;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    setResponseText("");

    if (reduced) {
      setPromptText(fullPrompt);
      setResponseText(convo.response);
      timers.push(setTimeout(() => !cancelled && setConvoIndex((i) => i + 1), 4000));
      return () => {
        cancelled = true;
        timers.forEach(clearTimeout);
      };
    }

    let i = 0;
    function typePrompt() {
      setPromptText(fullPrompt.slice(0, i));
      i++;
      if (i <= fullPrompt.length) {
        timers.push(setTimeout(typePrompt, 30));
      } else {
        typeResponse();
      }
    }

    let j = 0;
    function typeResponse() {
      setResponseText(convo.response.slice(0, j));
      j++;
      if (j <= convo.response.length) {
        timers.push(setTimeout(typeResponse, 30));
      } else {
        timers.push(setTimeout(() => !cancelled && setConvoIndex((idx) => idx + 1), 3200));
      }
    }

    typePrompt();

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convoIndex]);

  return (
    <section className="kairos-section" id="kairos">
      <div className="kairos-visual">
        <div className="kairos-visual-content">
          {imageFailed ? (
            <div className="kairos-orb" />
          ) : (
            // A plain <img> so onError's fallback-to-orb is trivial;
            // this isn't a Core Web Vitals-critical image.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={KAIROS_IMAGE_SRC}
              alt="KAIROS"
              className="kairos-image"
              onError={() => setImageFailed(true)}
            />
          )}
          <div className="kairos-name">KAIROS</div>
          <p className="kairos-description">
            KAIROS is your team&apos;s AI baseball analyst. It reads your real logged games and answers in plain
            language: lineups, weak spots, practice plans.
          </p>
        </div>
      </div>
      <div className="kairos-terminal" ref={terminalRef}>
        <p className="kairos-real-data-line">KAIROS answers from your team&apos;s real logged data.</p>
        <div className="kairos-chip-row">
          {CONVERSATIONS.map((convo, i) => (
            <button
              key={convo.chip}
              type="button"
              className="kairos-chip"
              onClick={() => {
                startedRef.current = true;
                setConvoIndex(i);
              }}
            >
              {convo.chip}
            </button>
          ))}
        </div>
        <p className="kairos-sample-label">Sample data</p>
        <div className="terminal-prompt">
          {promptText}
          <span className="terminal-cursor" />
        </div>
        <div className="terminal-kairos">{responseText}</div>
      </div>
    </section>
  );
}
