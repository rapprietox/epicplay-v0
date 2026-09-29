"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { addPlayer, generateInviteLink } from "./actions";
import { POSITIONS } from "@/lib/baseball-positions";

interface Player {
  id: string;
  name: string;
  jersey_number: number | null;
  position: string | null;
  batting_hand?: string | null;
  throwing_hand?: string | null;
  // Clubhouse batch: set once the invite is claimed (see src/lib/invites.ts).
  user_id?: string | null;
}

export function RosterSection({ players }: { players: Player[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await addPlayer(formData);
        formRef.current?.reset();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add player");
      }
    });
  }

  return (
    <section className="glossy rounded-lg border border-border bg-surface p-5">
      <h2 className="font-heading text-xl font-semibold uppercase tracking-wide text-white">
        Roster
      </h2>
      <p className="mt-1 text-xs text-foreground/50">
        Add every player before building a lineup for a game.
      </p>

      <form ref={formRef} action={handleSubmit} className="mt-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-foreground/50" htmlFor="player-name">
            Name
          </label>
          <input
            id="player-name"
            name="name"
            required
            className="w-40 rounded-md border border-border bg-background px-3 py-2 text-sm text-white outline-none focus:border-accent-primary"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-foreground/50" htmlFor="player-jersey">
            #
          </label>
          <input
            id="player-jersey"
            name="jersey_number"
            type="number"
            className="w-16 rounded-md border border-border bg-background px-3 py-2 text-sm text-white outline-none focus:border-accent-primary"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-foreground/50" htmlFor="player-position">
            Position
          </label>
          <select
            id="player-position"
            name="position"
            defaultValue=""
            className="w-44 rounded-md border border-border bg-background px-3 py-2 text-sm text-white outline-none focus:border-accent-primary"
          >
            <option value="">—</option>
            {POSITIONS.map((pos) => (
              <option key={pos.value} value={pos.value}>
                {pos.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-foreground/50" htmlFor="player-batting-hand">
            Bats
          </label>
          <select
            id="player-batting-hand"
            name="batting_hand"
            defaultValue="R"
            className="w-20 rounded-md border border-border bg-background px-3 py-2 text-sm text-white outline-none focus:border-accent-primary"
          >
            <option value="R">R</option>
            <option value="L">L</option>
            <option value="S">S</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-foreground/50" htmlFor="player-throwing-hand">
            Throws
          </label>
          <select
            id="player-throwing-hand"
            name="throwing_hand"
            defaultValue="R"
            className="w-20 rounded-md border border-border bg-background px-3 py-2 text-sm text-white outline-none focus:border-accent-primary"
          >
            <option value="R">R</option>
            <option value="L">L</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-accent-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-primary/90 disabled:opacity-50"
        >
          {isPending ? "Adding…" : "Add player"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-accent-red">{error}</p>}

      <p className="mt-5 text-xs uppercase tracking-wide text-foreground/40">
        Tap a player for their full breakdown -- heat maps, spray chart, and splits
      </p>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {players.length === 0 && <p className="py-3 text-sm text-foreground/40">No players yet.</p>}
        {players.map((p) => (
          <div
            key={p.id}
            className="flex items-start justify-between gap-3 rounded-md border border-border bg-background/40 px-3 py-2 text-sm transition hover:border-accent-primary hover:bg-background/70"
          >
            {/* Player info -- left, full width, never overlapped. */}
            <Link href={`/coach/players/${p.id}`} className="flex min-w-0 flex-1 items-center gap-2 py-1">
              <span className="shrink-0 text-foreground/50">#{p.jersey_number ?? "—"}</span>
              <span className="min-w-0 truncate text-white">{p.name}</span>
              <span className="shrink-0 text-foreground/50">{p.position ?? ""}</span>
              <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-foreground/50">
                {p.batting_hand ?? "R"}/{p.throwing_hand ?? "R"}
              </span>
            </Link>

            {/* Link status -- right, badge on top, action below it. */}
            <LinkAccountBadge player={p} />
          </div>
        ))}
      </div>
    </section>
  );
}

// Clubhouse batch: kept out of the <Link> that wraps the rest of the
// card row (nesting a button inside an anchor is invalid HTML and
// clicking it would also trigger navigation) -- a sibling instead, same
// row, own click handling.
//
// Layout fix: badge and its action stack vertically (badge on top,
// button/copy-link below), right-aligned in their own shrink-0 column --
// this is what actually keeps them from overlapping the player-info
// column on the left, not just the outer card's own flex/justify-between
// (that alone doesn't stop a wide inline row of badge+input+buttons on
// the right from still colliding with a long player name on the left at
// the sm:grid-cols-2 breakpoint's narrower card width).
function LinkAccountBadge({ player }: { player: Player }) {
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (player.user_id) {
    return (
      <span className="shrink-0 whitespace-nowrap rounded-full border border-accent-green/50 bg-accent-green/10 px-2 py-1 text-[10px] font-semibold text-accent-green">
        ✅ Linked
      </span>
    );
  }

  if (inviteUrl) {
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(
      `Link your EpicPlay Clubhouse account, ${player.name}: ${inviteUrl}`
    )}`;
    return (
      <div className="flex w-32 shrink-0 flex-col items-end gap-1" onClick={(e) => e.stopPropagation()}>
        <input
          readOnly
          value={inviteUrl}
          onFocus={(e) => e.target.select()}
          className="w-full rounded border border-border bg-background px-1.5 py-1 text-[10px] text-foreground/70 outline-none"
        />
        <div className="flex w-full gap-1">
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(inviteUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="flex-1 rounded border border-border px-1.5 py-1 text-[10px] text-foreground/70 hover:border-accent-primary hover:text-white"
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 rounded border border-accent-green/50 px-1.5 py-1 text-center text-[10px] text-accent-green hover:bg-accent-green/10"
          >
            WhatsApp
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1" onClick={(e) => e.stopPropagation()}>
      <span className="flex items-center gap-1 whitespace-nowrap rounded-full border border-accent-red/50 bg-accent-red/10 px-2 py-1 text-[10px] font-semibold text-accent-red">
        {/* CSS-drawn dot, not the ⚪ emoji -- an emoji glyph renders in its
            own fixed color on most platforms and can't be recolored via
            `color`, which is exactly what "make the circle red too" needs. */}
        <span className="h-1.5 w-1.5 rounded-full bg-accent-red" />
        Not linked
      </span>
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            try {
              setInviteUrl(await generateInviteLink(player.id));
            } catch (err) {
              setError(err instanceof Error ? err.message : "Failed to generate link");
            }
          })
        }
        className="whitespace-nowrap rounded border border-accent-primary px-2 py-1 text-[10px] font-medium text-accent-primary transition hover:bg-accent-primary/10 disabled:opacity-50"
      >
        {isPending ? "…" : "Link Account"}
      </button>
      {error && <span className="text-right text-[10px] text-accent-red">{error}</span>}
    </div>
  );
}
