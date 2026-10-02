"use client";

import { useEffect, useRef, useState } from "react";
import { askPlayerKairos, type KairosMessage } from "../kairos-actions";
import { useSpeechRecognition } from "@/lib/kairos/use-speech-recognition";

// Clubhouse Pro enhancement, Part 3: a trimmed copy of the coach's
// src/app/coach/kairos-chat.tsx -- same message-list rendering, scroll
// behavior, loading/error state, clear-history control, textarea +
// Enter-to-send, mic button (reusing useSpeechRecognition as-is, fully
// generic). Deliberately dropped: pendingRoster/pendingSchedule state
// and their confirm-import JSX -- the player assistant never proposes
// imports (see kairos-actions.ts's own "no tools" note). Added: a
// credit-counter line and a friendly "credits exhausted" state instead
// of the normal error path. localStorage key is player-scoped
// (kairos_history_player_{playerId}), a distinct namespace from the
// coach's kairos_history_{teamId} so the two never collide.
const storageKey = (playerId: string) => `kairos_history_player_${playerId}`;
const MAX_STORED_MESSAGES = 40;
const MAX_SHOWN_MESSAGES = 10;
const MONTHLY_LIMIT = 20;

function loadMessages(playerId: string): KairosMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(playerId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveMessages(playerId: string, messages: KairosMessage[]) {
  try {
    window.localStorage.setItem(storageKey(playerId), JSON.stringify(messages));
  } catch {
    // Private browsing / storage disabled -- conversation just won't
    // persist across a reload, not worth surfacing as an error.
  }
}

export function KairosChat({ playerId, variant = "dashboard" }: { playerId: string; variant?: "dashboard" | "modal" }) {
  const [messages, setMessages] = useState<KairosMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [exhaustedUntil, setExhaustedUntil] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages(loadMessages(playerId));
  }, [playerId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const { supported: voiceSupported, listening, start: startListening, stop: stopListening } = useSpeechRecognition((transcript) => {
    setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
  });

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading || exhaustedUntil) return;
    setInput("");
    setError(null);
    const historyForRequest = messages;
    const withUser = [...messages, { role: "user" as const, content: trimmed }];
    setMessages(withUser);
    setLoading(true);
    try {
      const res = await askPlayerKairos(historyForRequest, trimmed);
      if (!res.ok) {
        if (res.reason === "credits_exhausted") {
          setExhaustedUntil(res.resetDate);
          setMessages(messages);
        } else {
          setError(res.error);
          setMessages(messages);
        }
        return;
      }
      const updated = [...withUser, { role: "assistant" as const, content: res.text }].slice(-MAX_STORED_MESSAGES);
      setMessages(updated);
      saveMessages(playerId, updated);
      setRemaining(res.remaining);
    } catch (err) {
      setError(err instanceof Error ? err.message : "KAIROS couldn't respond -- check your connection and try again.");
      setMessages(messages);
    } finally {
      setLoading(false);
    }
  }

  function clearHistory() {
    setMessages([]);
    saveMessages(playerId, []);
  }

  const shown = messages.slice(-MAX_SHOWN_MESSAGES);
  const isDashboard = variant === "dashboard";

  // Five-fixes batch, Fix 3: the modal used to wrap this WHOLE component
  // (message list + input row) in one scrollable div in kairos-widget.tsx
  // -- if the message list grew tall, the entire chat scrolled together
  // and the input/send button could end up below the fold with no visual
  // cue to scroll for it. Fixed by giving this component its own bounded
  // layout (h-full flex-col) so ONLY the message list scrolls
  // (flex-1 min-h-0 overflow-y-auto for the modal variant, which now
  // sits inside a height-bounded parent -- see kairos-widget.tsx) while
  // the input row stays a normal, always-visible flex sibling below it.
  // sticky bottom-0 on the input row is belt-and-suspenders per spec, for
  // any future container that reintroduces an outer scroll.
  return (
    <div className={`flex flex-col ${isDashboard ? "" : "h-full"}`}>
      <div className="mb-0.5 flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-wide text-[#5A7A64]">
          {remaining !== null ? `${remaining} of ${MONTHLY_LIMIT} messages remaining this month` : `${MONTHLY_LIMIT} messages remaining this month`}
        </span>
        {messages.length > 0 && (
          <button type="button" onClick={clearHistory} className="text-[9px] uppercase tracking-wide text-[#5A7A64] hover:text-[#9FCBAC]">
            Clear history
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        className={`flex flex-col gap-1.5 overflow-y-auto ${isDashboard ? "max-h-[64px]" : "min-h-0 flex-1"}`}
      >
        {shown.length === 0 && !loading && (
          <p className="px-1 py-1 text-xs text-[#9FCBAC]">
            {isDashboard ? "Ask KAIROS about your game…" : "Ask about your stats, your drills, or how to improve."}
          </p>
        )}
        {shown.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] whitespace-pre-wrap rounded-lg text-sm ${isDashboard ? "px-2 py-1" : "px-3 py-2"} ${
                m.role === "user" ? "bg-[#0F2A17] text-[#C8F0D5]" : "border-l-2 border-l-accent-green bg-[#0D2412] text-[#DCF5E4]"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-lg border-l-2 border-l-accent-green bg-[#0D2412] px-3 py-2 text-sm text-[#9FCBAC]">KAIROS is thinking…</div>
          </div>
        )}
      </div>

      {exhaustedUntil && (
        <p className="mt-2 text-xs text-accent-amber">Credits reset on {exhaustedUntil}. Come back then for more coaching.</p>
      )}
      {error && <p className="mt-2 text-xs text-accent-red">{error}</p>}

      <div
        className={`sticky bottom-0 z-10 shrink-0 bg-[#0A1F0D] pb-1 pt-2 ${isDashboard ? "mt-1.5" : "mt-3"} flex flex-col gap-2 sm:flex-row`}
        style={{ borderTop: "1px solid #1A3D28" }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          placeholder="Ask KAIROS about your stats, drills, or technique..."
          rows={variant === "modal" ? 2 : 1}
          disabled={Boolean(exhaustedUntil)}
          className={`w-full resize-none rounded-md border border-[#1A3D28] bg-[#06150A] text-sm text-white outline-none placeholder:text-[#5A7A64] focus:border-accent-green disabled:opacity-50 ${
            isDashboard ? "px-2 py-1.5" : "px-3 py-2"
          }`}
        />
        <div className="flex gap-2">
          {voiceSupported && (
            <button
              type="button"
              onClick={() => (listening ? stopListening() : startListening())}
              title="Voice input"
              disabled={Boolean(exhaustedUntil)}
              className={`flex min-h-[40px] min-w-[40px] items-center justify-center rounded-full border text-lg transition disabled:opacity-50 ${
                listening ? "animate-pulse border-accent-red bg-accent-red/20 text-accent-red" : "border-accent-green/50 text-accent-green hover:bg-accent-green/10"
              }`}
            >
              🎤
            </button>
          )}
          <button
            type="button"
            onClick={() => void send(input)}
            disabled={loading || !input.trim() || Boolean(exhaustedUntil)}
            className="min-h-[40px] shrink-0 rounded-full bg-accent-green px-5 text-sm font-semibold text-background transition hover:bg-accent-green/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Ask Kairos →
          </button>
        </div>
      </div>
    </div>
  );
}
