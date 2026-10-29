"use client";

import { useEffect, useRef, useState } from "react";

interface Conversation {
  role: string;
  prompt: string;
  response: string;
}

// Ported verbatim from the prior artifact build's KAIROS terminal content.
const CONVERSATIONS: Conversation[] = [
  {
    role: "COACH",
    prompt: "Who bats leadoff tonight?",
    response:
      "Marcus Johnson. .500 OBP, Speed 4/5,\n3 stolen bases this season. He reaches base\nevery other at-bat and creates chaos on the\nbases for your power hitters.\n\nDiego Reyes has better AVG but Speed 1/5 —\nhis power belongs in slot 3 or 4.\n\n📊 31% reliable · 3 games · building...",
  },
  {
    role: "COACH",
    prompt: "We lost last night. What went wrong?",
    response:
      "Three things cost you the game.\n\n1. Ryan Williams (slot 8) struck out all\n   3 at-bats — predictable from his data.\n\n2. Your 5-6-7 slots: 0 RBI with 4 runners\n   in scoring position.\n\n3. Andrés Herrera's ERA vs lefties: 9.00.\n   They started 4 lefties against you.\n\nNext game: Move James Park to slot 6.",
  },
  {
    role: "PLAYER",
    prompt: "Why do I keep striking out?",
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
        <div className="kairos-orb" />
        <div className="kairos-name">KAIROS</div>
        <div className="kairos-subtitle">Greek · god of the perfect moment</div>
      </div>
      <div className="kairos-terminal" ref={terminalRef}>
        <div className="terminal-prompt">
          {promptText}
          <span className="terminal-cursor" />
        </div>
        <div className="terminal-kairos">{responseText}</div>
      </div>
    </section>
  );
}
