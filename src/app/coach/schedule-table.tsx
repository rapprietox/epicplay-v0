"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { Database } from "@/lib/supabase/types";
import type { GameType } from "@/lib/supabase/types";
import { daysUntil, formatGameDate } from "@/lib/dates";
import { recordAgainstOpponent, resultLetter, formatRecord } from "@/lib/opponent-history";
import { addManualGame, cancelGame, editGame } from "./actions";
import { TIME_OPTIONS } from "@/lib/time-options";

type Game = Database["public"]["Tables"]["games"]["Row"];

const GAME_TYPES: GameType[] = [
  "friendly",
  "preseason",
  "season",
  "playoff",
  "tournament",
  "championship",
];

export function ScheduleTable({ games, opponentNames }: { games: Game[]; opponentNames: string[] }) {
  const [pastOpen, setPastOpen] = useState(false);
  const [remainingOpen, setRemainingOpen] = useState(false);

  const sorted = [...games].sort((a, b) => a.game_date.localeCompare(b.game_date));
  const today = new Date().toISOString().slice(0, 10);
  const past = sorted.filter((g) => g.game_date < today);
  const upcoming = sorted.filter((g) => g.game_date >= today);
  const nextThree = upcoming.slice(0, 3);
  const remaining = upcoming.slice(3);

  const pastRecord = past.reduce(
    (acc, g) => {
      const r = resultLetter(g);
      if (r === "W") acc.w += 1;
      else if (r === "L") acc.l += 1;
      else if (r === "T") acc.t += 1;
      return acc;
    },
    { w: 0, l: 0, t: 0 }
  );
  const pastRecordLabel = `${pastRecord.w}-${pastRecord.l}${pastRecord.t ? `-${pastRecord.t}` : ""}`;

  return (
    <section className="glossy rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-xl font-semibold uppercase tracking-wide text-white">
          Season Schedule
        </h2>
      </div>

      <div className="mt-4">
        {games.length === 0 ? (
          <p className="py-4 text-sm text-foreground/40">No games scheduled yet.</p>
        ) : nextThree.length > 0 ? (
          <GameTable games={nextThree} allGames={games} highlightFirstId={nextThree[0].id} />
        ) : (
          <p className="py-4 text-sm text-foreground/40">No upcoming games scheduled.</p>
        )}
      </div>

      {past.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <AccordionHeader
            open={pastOpen}
            onClick={() => setPastOpen((o) => !o)}
            label={`Past Games (${past.length})`}
            summary={pastRecordLabel}
          />
          <Collapsible open={pastOpen}>
            <div className="pt-3">
              <GameTable games={[...past].reverse()} allGames={games} />
            </div>
          </Collapsible>
        </div>
      )}

      {remaining.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <AccordionHeader
            open={remainingOpen}
            onClick={() => setRemainingOpen((o) => !o)}
            label={`Remaining Schedule (${remaining.length})`}
            summary={`${remaining.length} game${remaining.length === 1 ? "" : "s"}`}
          />
          <Collapsible open={remainingOpen}>
            <div className="pt-3">
              <GameTable games={remaining} allGames={games} />
            </div>
          </Collapsible>
        </div>
      )}

      <AddGameForm opponentNames={opponentNames} />
    </section>
  );
}

function AccordionHeader({
  open,
  onClick,
  label,
  summary,
}: {
  open: boolean;
  onClick: () => void;
  label: string;
  summary: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-md px-1 py-1.5 text-left transition hover:bg-background/40"
    >
      <span className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground/70">
        <span className={`inline-block transition-transform duration-200 ${open ? "rotate-90" : ""}`}>
          &#9656;
        </span>
        {label}
      </span>
      <span className="text-xs text-foreground/50">{summary}</span>
    </button>
  );
}

function Collapsible({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div
      className="grid transition-[grid-template-rows] duration-300 ease-in-out"
      style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}

function GameTable({
  games,
  allGames,
  highlightFirstId,
}: {
  games: Game[];
  allGames: Game[];
  highlightFirstId?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-foreground/40">
            <th className="pb-2 pr-3">Date</th>
            <th className="pb-2 pr-3">Time</th>
            <th className="pb-2 pr-3">Opponent</th>
            <th className="pb-2 pr-3">Home/Away</th>
            <th className="pb-2 pr-3">Type</th>
            <th className="pb-2 pr-3">Result</th>
            <th className="pb-2 pr-3">Record vs Opp.</th>
            <th className="pb-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {games.map((game) => (
            <GameRow key={game.id} game={game} allGames={allGames} prominent={game.id === highlightFirstId} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GameRow({ game, allGames, prominent }: { game: Game; allGames: Game[]; prominent?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const cancelled = game.status === "cancelled";
  const result = resultLetter(game);
  const record = recordAgainstOpponent(allGames, game);

  function doCancel() {
    if (!confirm(`Cancel the game vs ${game.opponent_name} on ${game.game_date}?`)) return;
    startTransition(async () => {
      try {
        await cancelGame(game.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to cancel");
      }
    });
  }

  function saveEdit(formData: FormData) {
    startTransition(async () => {
      try {
        await editGame(game.id, {
          game_date: String(formData.get("game_date")),
          game_time: String(formData.get("game_time") || "") || "TBD",
          home_away: formData.get("home_away") as "home" | "away",
          game_type: formData.get("game_type") as GameType,
        });
        setEditing(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save");
      }
    });
  }

  if (editing) {
    return (
      <tr className="bg-background/40">
        <td colSpan={8} className="py-2">
          <form action={saveEdit} className="flex flex-wrap items-end gap-2 px-1">
            <input
              type="date"
              name="game_date"
              defaultValue={game.game_date}
              className="rounded border border-border bg-background px-2 py-1 text-sm text-white"
            />
            <select
              name="game_time"
              defaultValue={game.game_time ?? "TBD"}
              className="rounded border border-border bg-background px-2 py-1 text-sm text-white"
            >
              <option value="TBD">TBD</option>
              {TIME_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              name="home_away"
              defaultValue={game.home_away}
              className="rounded border border-border bg-background px-2 py-1 text-sm text-white"
            >
              <option value="home">Home</option>
              <option value="away">Away</option>
            </select>
            <select
              name="game_type"
              defaultValue={game.game_type}
              className="rounded border border-border bg-background px-2 py-1 text-sm text-white"
            >
              {GAME_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={isPending}
              className="rounded bg-accent-primary px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded border border-border px-3 py-1 text-sm text-foreground/70"
            >
              Cancel
            </button>
          </form>
          {error && <p className="mt-1 px-1 text-xs text-accent-red">{error}</p>}
        </td>
      </tr>
    );
  }

  const rowContent = (
    <>
      <td className={`py-2 pr-3 ${cancelled ? "text-foreground/30 line-through" : ""}`}>
        {prominent && (
          <span className="mr-2 rounded-full bg-accent-primary/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent-primary">
            Next
          </span>
        )}
        {formatGameDate(game.game_date)}
      </td>
      <td className={`py-2 pr-3 ${cancelled ? "text-foreground/30 line-through" : ""}`}>
        {game.game_time ?? "—"}
      </td>
      <td className={`py-2 pr-3 ${cancelled ? "text-foreground/30 line-through" : "text-white"}`}>
        {game.opponent_name}
      </td>
      <td className={`py-2 pr-3 capitalize ${cancelled ? "text-foreground/30 line-through" : ""}`}>
        {game.home_away}
      </td>
      <td className={`py-2 pr-3 capitalize ${cancelled ? "text-foreground/30 line-through" : ""}`}>
        {game.game_type}
      </td>
      <td className="py-2 pr-3">
        {cancelled ? (
          <span className="rounded bg-accent-red/10 px-2 py-0.5 text-xs font-medium text-accent-red">
            Cancelled
          </span>
        ) : game.status === "active" ? (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-accent-green">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-green" />
            Live {game.our_score}-{game.opponent_score}
          </span>
        ) : result ? (
          <span
            className={`font-heading font-semibold ${
              result === "W"
                ? "text-accent-green"
                : result === "L"
                  ? "text-accent-red"
                  : "text-foreground/60"
            }`}
          >
            {result} {game.our_score}-{game.opponent_score}
          </span>
        ) : (
          <span className="text-foreground/50">{daysUntil(game.game_date)}d away</span>
        )}
      </td>
      <td className="py-2 pr-3 text-foreground/50">{formatRecord(record)}</td>
      <td className="py-2">
        {!cancelled && game.status === "setup" && (
          <div className="flex gap-2 whitespace-nowrap">
            <Link href={`/coach/games/${game.id}/setup`} className="text-xs text-accent-primary hover:underline">
              Set up
            </Link>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs text-foreground/40 hover:text-white"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={doCancel}
              disabled={isPending}
              className="text-xs text-foreground/40 hover:text-accent-red"
            >
              Cancel
            </button>
          </div>
        )}
        {game.status === "active" && (
          <Link href={`/operator?game=${game.id}`} className="text-xs text-accent-green hover:underline">
            Continue
          </Link>
        )}
      </td>
    </>
  );

  return <tr className={prominent ? "bg-accent-primary/5" : undefined}>{rowContent}</tr>;
}

function AddGameForm({ opponentNames }: { opponentNames: string[] }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await addManualGame(formData);
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add game");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 text-sm text-accent-primary hover:underline"
      >
        + Add game manually
      </button>
    );
  }

  return (
    <form action={handleSubmit} className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-4">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-foreground/50" htmlFor="manual-opponent">
          Opponent
        </label>
        <input
          id="manual-opponent"
          name="opponent_name"
          list="known-opponents"
          required
          className="w-40 rounded-md border border-border bg-background px-3 py-2 text-sm text-white outline-none focus:border-accent-primary"
        />
        <datalist id="known-opponents">
          {opponentNames.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-foreground/50" htmlFor="manual-date">
          Date
        </label>
        <input
          id="manual-date"
          type="date"
          name="game_date"
          required
          className="rounded-md border border-border bg-background px-3 py-2 text-sm text-white outline-none focus:border-accent-primary"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-foreground/50" htmlFor="manual-time">
          Time
        </label>
        <select
          id="manual-time"
          name="game_time"
          defaultValue="TBD"
          className="rounded-md border border-border bg-background px-3 py-2 text-sm text-white outline-none focus:border-accent-primary"
        >
          <option value="TBD">TBD</option>
          {TIME_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-foreground/50" htmlFor="manual-home-away">
          Home/Away
        </label>
        <select
          id="manual-home-away"
          name="home_away"
          className="rounded-md border border-border bg-background px-3 py-2 text-sm text-white outline-none focus:border-accent-primary"
        >
          <option value="home">Home</option>
          <option value="away">Away</option>
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-foreground/50" htmlFor="manual-type">
          Type
        </label>
        <select
          id="manual-type"
          name="game_type"
          defaultValue="friendly"
          className="rounded-md border border-border bg-background px-3 py-2 text-sm text-white outline-none focus:border-accent-primary"
        >
          {GAME_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-accent-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {isPending ? "Adding…" : "Add"}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground/70"
      >
        Cancel
      </button>
      {error && <p className="w-full text-sm text-accent-red">{error}</p>}
    </form>
  );
}
