"use client";

import { useEffect, useRef, useState } from "react";
import {
  askKairos,
  confirmKairosRosterImport,
  confirmKairosScheduleImport,
  type KairosMessage,
  type PendingRosterPlayer,
  type PendingScheduleGame,
} from "./kairos-actions";
import { useSpeechRecognition } from "@/lib/kairos/use-speech-recognition";

const STORAGE_KEY = "kairos-conversation";
// "Last 10 exchanges" (spec) = 20 messages (user+assistant pairs) kept
// for context/localStorage; the panel itself only ever *shows* the last
// 5 exchanges (10 messages) per the panel-design spec -- two different
// numbers for two different reasons, not a mismatch.
const MAX_STORED_MESSAGES = 20;
const MAX_SHOWN_MESSAGES = 10;

function loadMessages(): KairosMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveMessages(messages: KairosMessage[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch {
    // Private browsing / storage disabled -- conversation just won't
    // persist across a reload, not worth surfacing as an error.
  }
}

export function KairosChat({ compact = false }: { compact?: boolean }) {
  const [messages, setMessages] = useState<KairosMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingRoster, setPendingRoster] = useState<PendingRosterPlayer[] | null>(null);
  const [pendingSchedule, setPendingSchedule] = useState<{ seasonName: string; seasonYear: number; games: PendingScheduleGame[] } | null>(null);
  const [importDone, setImportDone] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages(loadMessages());
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pendingRoster, pendingSchedule]);

  const { supported: voiceSupported, listening, start: startListening, stop: stopListening } = useSpeechRecognition((transcript) => {
    setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
  });

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setInput("");
    setError(null);
    setPendingRoster(null);
    setPendingSchedule(null);
    setImportDone(null);
    const historyForRequest = messages;
    const withUser = [...messages, { role: "user" as const, content: trimmed }];
    setMessages(withUser);
    setLoading(true);
    try {
      const res = await askKairos(historyForRequest, trimmed);
      const updated = [...withUser, { role: "assistant" as const, content: res.text }].slice(-MAX_STORED_MESSAGES);
      setMessages(updated);
      saveMessages(updated);
      if (res.pendingRosterImport) setPendingRoster(res.pendingRosterImport);
      if (res.pendingScheduleImport) setPendingSchedule(res.pendingScheduleImport);
    } catch (err) {
      setError(err instanceof Error ? err.message : "KAIROS couldn't respond -- check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmRoster() {
    if (!pendingRoster) return;
    const toAdd = pendingRoster.filter((p) => !p.alreadyExists);
    setLoading(true);
    try {
      await confirmKairosRosterImport(toAdd);
      setImportDone(`Added ${toAdd.length} player${toAdd.length === 1 ? "" : "s"} to your roster.`);
      setPendingRoster(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add players -- try again?");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmSchedule() {
    if (!pendingSchedule) return;
    setLoading(true);
    try {
      await confirmKairosScheduleImport(pendingSchedule);
      setImportDone(`Added ${pendingSchedule.games.length} games to ${pendingSchedule.seasonName}.`);
      setPendingSchedule(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add the schedule -- try again?");
    } finally {
      setLoading(false);
    }
  }

  const shown = messages.slice(-MAX_SHOWN_MESSAGES);

  return (
    <div className="flex flex-col">
      <div
        ref={scrollRef}
        className={`flex flex-col gap-2 overflow-y-auto ${compact ? "max-h-[40vh]" : "max-h-[320px]"}`}
      >
        {shown.length === 0 && !loading && (
          <p className="px-1 py-2 text-xs text-[#9FCBAC]">
            Ask about your roster, paste a schedule to import, or say &ldquo;suggest tonight&apos;s lineup.&rdquo;
          </p>
        )}
        {shown.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
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

      {pendingRoster && (
        <div className="mt-3 rounded-md border border-accent-green/40 bg-[#0D2412] p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-accent-green">Import roster</p>
          <ul className="mt-2 flex flex-col gap-1 text-xs">
            {pendingRoster.map((p, i) => (
              <li key={i} className={`flex items-center justify-between rounded px-2 py-1 ${p.alreadyExists ? "bg-accent-amber/10" : "bg-black/20"}`}>
                <span className="text-white">
                  #{p.jersey_number ?? "—"} {p.name} {p.position ? `(${p.position})` : ""}
                </span>
                {p.alreadyExists && <span className="text-accent-amber">already in roster — skipping</span>}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={handleConfirmRoster}
              disabled={loading}
              className="rounded-full bg-accent-green px-4 py-1.5 text-xs font-semibold text-background disabled:opacity-50"
            >
              Add {pendingRoster.filter((p) => !p.alreadyExists).length} player{pendingRoster.filter((p) => !p.alreadyExists).length === 1 ? "" : "s"}
            </button>
            <button type="button" onClick={() => setPendingRoster(null)} className="text-xs text-[#9FCBAC] hover:text-white">
              Cancel
            </button>
          </div>
        </div>
      )}

      {pendingSchedule && (
        <div className="mt-3 rounded-md border border-accent-green/40 bg-[#0D2412] p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-accent-green">
            Import schedule — {pendingSchedule.seasonName}
          </p>
          <ul className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto text-xs">
            {pendingSchedule.games.map((g, i) => (
              <li key={i} className="flex items-center justify-between rounded bg-black/20 px-2 py-1 text-white">
                <span>
                  {g.date} {g.time !== "TBD" ? `· ${g.time}` : ""} vs {g.opponent_name}
                </span>
                <span className="capitalize text-[#9FCBAC]">{g.home_away}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={handleConfirmSchedule}
              disabled={loading}
              className="rounded-full bg-accent-green px-4 py-1.5 text-xs font-semibold text-background disabled:opacity-50"
            >
              Add {pendingSchedule.games.length} games
            </button>
            <button type="button" onClick={() => setPendingSchedule(null)} className="text-xs text-[#9FCBAC] hover:text-white">
              Cancel
            </button>
          </div>
        </div>
      )}

      {importDone && <p className="mt-2 text-xs text-accent-green">{importDone}</p>}
      {error && <p className="mt-2 text-xs text-accent-red">{error}</p>}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          placeholder="Ask Kairos anything about your team..."
          rows={compact ? 2 : 1}
          className="w-full resize-none rounded-md border border-[#1A3D28] bg-[#06150A] px-3 py-2 text-sm text-white outline-none placeholder:text-[#5A7A64] focus:border-accent-green"
        />
        <div className="flex gap-2">
          {voiceSupported && (
            <button
              type="button"
              onClick={() => (listening ? stopListening() : startListening())}
              title="Voice input"
              className={`flex min-h-[40px] min-w-[40px] items-center justify-center rounded-full border text-lg transition ${
                listening ? "animate-pulse border-accent-red bg-accent-red/20 text-accent-red" : "border-accent-green/50 text-accent-green hover:bg-accent-green/10"
              }`}
            >
              🎤
            </button>
          )}
          <button
            type="button"
            onClick={() => void send(input)}
            disabled={loading || !input.trim()}
            className="min-h-[40px] shrink-0 rounded-full bg-accent-green px-5 text-sm font-semibold text-background transition hover:bg-accent-green/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Ask Kairos →
          </button>
        </div>
      </div>
    </div>
  );
}
