"use client";

import { useState } from "react";

// Clubhouse Pro batch: placeholder selector only, per confirmed scope --
// no audio upload/storage/playback this sprint. Selection is local UI
// state only and resets on reload; persisting it (a players.walkup_song
// column + a tiny server action) is a cheap follow-up if it's ever
// needed, not built speculatively here.
const PLACEHOLDER_SONGS = [
  "Enter Sandman — Metallica",
  "Thunderstruck — AC/DC",
  "Eye of the Tiger — Survivor",
  "Sandstorm — Darude",
  "Song 2 — Blur",
];

export function WalkupSongSelector() {
  const [song, setSong] = useState(PLACEHOLDER_SONGS[0]);

  return (
    <div className="glossy rounded-lg border border-border bg-surface p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-foreground/50">Walk-Up Song</p>
      <select
        value={song}
        onChange={(e) => setSong(e.target.value)}
        className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-white outline-none focus:border-accent-primary"
      >
        {PLACEHOLDER_SONGS.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <p className="mt-1 text-[10px] text-foreground/30">Coming soon: upload your own.</p>
    </div>
  );
}
