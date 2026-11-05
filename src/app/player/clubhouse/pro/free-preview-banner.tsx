// Free preview batch: shown only while isFreePreviewActive() is true and
// the player is still locked (page.tsx decides that, not this component)
// -- after FREE_PREVIEW_ENDS this stops rendering automatically with no
// other behavior change, since the gate it reads is the same one that
// locks the spray chart/KAIROS back down.
export function FreePreviewBanner() {
  return (
    <section className="glossy rounded-lg border border-accent-gold/40 bg-surface px-4 py-3 text-sm text-foreground/80">
      Free preview: spray chart and KAIROS are open to everyone for the next 2 games (through Nov 14).{" "}
      <a href="#clubhouse-pro" className="font-semibold text-accent-gold hover:underline">
        Unlock Clubhouse Pro
      </a>{" "}
      to keep them.
    </section>
  );
}
