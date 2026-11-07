"use client";

import { useState, useTransition } from "react";
import { createShareLink, disableShareLink } from "./actions";

export function ShareLinkPanel({
  gameId,
  initialShareToken,
  siteUrl,
}: {
  gameId: string;
  initialShareToken: string | null;
  siteUrl: string;
}) {
  const [token, setToken] = useState(initialShareToken);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const shareUrl = token ? `${siteUrl}/live/${token}` : null;

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      try {
        const newToken = await createShareLink(gameId);
        setToken(newToken);
        setCopied(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not create the link");
      }
    });
  }

  // Share button batch: createShareLink already overwrites share_token
  // with a fresh crypto.randomUUID() -- "creating a new one invalidates
  // the old one" (see its own comment) -- so regenerating while a token
  // already exists is the exact same call, just exposed as its own
  // button instead of only being reachable by first turning the link off.
  function handleRegenerate() {
    setError(null);
    startTransition(async () => {
      try {
        const newToken = await createShareLink(gameId);
        setToken(newToken);
        setCopied(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not regenerate the link");
      }
    });
  }

  function handleDisable() {
    setError(null);
    startTransition(async () => {
      try {
        await disableShareLink(gameId);
        setToken(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not turn off the link");
      }
    });
  }

  async function handleCopy() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission can fail in some browsers -- the URL is
      // already shown as selectable text, so this is a convenience, not
      // the only way to get it.
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {!shareUrl ? (
        <button
          onClick={handleCreate}
          disabled={pending}
          className="rounded-md border border-accent-gold px-3 py-1.5 text-xs font-semibold text-accent-gold transition hover:bg-accent-gold hover:text-background disabled:opacity-50"
        >
          {pending ? "Creating…" : "Share live link"}
        </button>
      ) : (
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-2">
            <span className="max-w-[220px] truncate rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground/80">
              {shareUrl}
            </span>
            <button
              onClick={handleCopy}
              className="rounded-md border border-border px-2 py-1 text-xs text-foreground/70 hover:border-accent-primary hover:text-white"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleRegenerate}
              disabled={pending}
              className="text-[11px] text-foreground/60 hover:underline disabled:opacity-50"
            >
              {pending ? "Regenerating…" : "Regenerate link"}
            </button>
            <button
              onClick={handleDisable}
              disabled={pending}
              className="text-[11px] text-accent-red hover:underline disabled:opacity-50"
            >
              {pending ? "Turning off…" : "Turn off live link"}
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-[11px] text-accent-red">{error}</p>}
    </div>
  );
}
