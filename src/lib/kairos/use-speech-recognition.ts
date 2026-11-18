"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// KAIROS batch: Web Speech API, per spec ("for now -- Deepgram later").
// There's no standard TypeScript lib type for SpeechRecognition (it's
// still non-standardized/vendor-prefixed across browsers), so this
// reaches into `window` via a narrow local interface instead of `any`
// everywhere -- keeps the rest of the file honestly typed while still
// being tolerant of the API's real shape. Unsupported browsers (Firefox,
// most non-Chromium mobile browsers) get `supported: false`; callers
// hide the mic button entirely in that case rather than showing a
// button that silently does nothing.
interface MinimalSpeechRecognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

function getSpeechRecognitionCtor(): (new () => MinimalSpeechRecognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => MinimalSpeechRecognition; webkitSpeechRecognition?: new () => MinimalSpeechRecognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useSpeechRecognition(onResult: (transcript: string) => void) {
  const [listening, setListening] = useState(false);
  // AI-coach modal fix (root cause): this used to read window.SpeechRecognition
  // during render via a lazy ref -- `typeof window === "undefined"` is true
  // on the server (supported=false) but false on the very first CLIENT
  // render too (Next hydrates with window already defined), so a
  // Chromium-based browser flipped straight to supported=true on hydration
  // itself, mismatching the server-rendered false. React's recovery from a
  // hydration mismatch is to discard the server-rendered DOM for that
  // subtree and replace it with a fresh client render -- which is what was
  // actually corrupting the KAIROS modal's horizontal scroll position (see
  // kairos-chat.tsx's own comment), not the modal's CSS by itself. The fix
  // is the standard SSR-safe pattern: start both renders at the same
  // value (false) and only read the real capability in an effect, which
  // never runs during SSR or the hydration pass.
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    setSupported(getSpeechRecognitionCtor() !== null);
  }, []);
  const recognitionRef = useRef<MinimalSpeechRecognition | null>(null);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      if (transcript) onResult(transcript);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, [onResult]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  return { supported, listening, start, stop };
}
