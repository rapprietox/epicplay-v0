"use client";

import { useMemo, useState } from "react";
import { PlayerSprayChart } from "./player-spray-chart";
import type { SprayDot } from "@/lib/heat-map";
import type { FieldCalibrationPoints, GameType } from "@/lib/supabase/types";
import { formatGameDate } from "@/lib/dates";

type Dot = SprayDot & { gameType: GameType; gameId: string };
type FilterMode = "all" | "one" | "multi" | "opponent";

interface GameOption {
  id: string;
  gameDate: string;
  opponentName: string;
}

// Free preview batch: PlayerSprayChart itself is reused unmodified in
// spirit -- this wrapper just trims `dots` down to the selected
// game(s)/opponent BEFORE handing them to PlayerSprayChart (allow3D=false
// so it never offers the 3D/heat-map toggle), rather than forking that
// component to add a second, differently-shaped filter bar inside it.
export function FreePreviewSprayChart({ dots, games, fieldCalibration }: { dots: Dot[]; games: GameOption[]; fieldCalibration: FieldCalibrationPoints | null }) {
  const [mode, setMode] = useState<FilterMode>("all");
  const [selectedGameId, setSelectedGameId] = useState<string>("");
  const [selectedGameIds, setSelectedGameIds] = useState<Set<string>>(new Set());
  const [selectedOpponent, setSelectedOpponent] = useState<string>("");

  const opponents = useMemo(() => Array.from(new Set(games.map((g) => g.opponentName))).sort(), [games]);

  const filtered = useMemo(() => {
    if (mode === "one") return selectedGameId ? dots.filter((d) => d.gameId === selectedGameId) : dots;
    if (mode === "multi") return selectedGameIds.size ? dots.filter((d) => selectedGameIds.has(d.gameId)) : dots;
    if (mode === "opponent") return selectedOpponent ? dots.filter((d) => d.opponentName === selectedOpponent) : dots;
    return dots;
  }, [dots, mode, selectedGameId, selectedGameIds, selectedOpponent]);

  function toggleGame(id: string) {
    setSelectedGameIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1 text-xs">
        {([
          { value: "all", label: "All games" },
          { value: "one", label: "Pick a game" },
          { value: "multi", label: "Pick several games" },
          { value: "opponent", label: "By opponent" },
        ] as { value: FilterMode; label: string }[]).map((f) => (
          <button
            key={f.value}
            onClick={() => setMode(f.value)}
            className={`rounded-full border px-3 py-1 transition ${
              mode === f.value ? "border-accent-primary bg-accent-primary/20 text-white" : "border-border text-foreground/50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {mode === "one" && (
        <select
          value={selectedGameId}
          onChange={(e) => setSelectedGameId(e.target.value)}
          className="w-full max-w-xs rounded-md border border-border bg-background px-2 py-1.5 text-xs text-white"
        >
          <option value="">Select a game…</option>
          {games.map((g) => (
            <option key={g.id} value={g.id}>
              {formatGameDate(g.gameDate)} vs {g.opponentName}
            </option>
          ))}
        </select>
      )}

      {mode === "multi" && (
        <div className="flex max-h-32 flex-col gap-1 overflow-y-auto rounded-md border border-border bg-background/40 p-2">
          {games.length === 0 && <p className="text-xs text-foreground/40">No games to choose from yet.</p>}
          {games.map((g) => (
            <label key={g.id} className="flex items-center gap-2 text-xs text-foreground/70">
              <input type="checkbox" checked={selectedGameIds.has(g.id)} onChange={() => toggleGame(g.id)} className="accent-accent-primary" />
              {formatGameDate(g.gameDate)} vs {g.opponentName}
            </label>
          ))}
        </div>
      )}

      {mode === "opponent" && (
        <select
          value={selectedOpponent}
          onChange={(e) => setSelectedOpponent(e.target.value)}
          className="w-full max-w-xs rounded-md border border-border bg-background px-2 py-1.5 text-xs text-white"
        >
          <option value="">Select an opponent…</option>
          {opponents.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      )}

      <PlayerSprayChart dots={filtered} fieldCalibration={fieldCalibration} allow3D={false} />
    </div>
  );
}
