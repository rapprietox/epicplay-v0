"use client";

import { useCallback, useRef, useState } from "react";

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
  const supportedRef = useRef<boolean | null>(null);
  if (supportedRef.current === null) supportedRef.current = getSpeechRecognitionCtor() !== null;
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

  return { supported: supportedRef.current, listening, start, stop };
}
