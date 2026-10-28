// Marketing-homepage fix: temporary bridge page shown to anonymous
// visitors at "/" until the full marketing site (built as the
// "EpicPlay AI War Room" artifact) gets ported into this app for real.
// Deliberately minimal -- same wordmark/tagline/colors as the artifact,
// not a copy of its full section-by-section HTML.
export function MarketingPage() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-6 text-center">
      {/* Placeholder hero video -- /public/hero-video.mp4 doesn't exist yet;
          the <video> simply renders nothing until that file is dropped in. */}
      <video
        autoPlay
        muted
        loop
        playsInline
        src="/hero-video.mp4"
        className="absolute inset-0 h-full w-full object-cover opacity-60"
      />
      <div className="absolute inset-0 bg-[rgba(3,10,6,0.5)]" />

      <div className="relative z-10 flex flex-col items-center gap-6">
        <h1 className="flex items-baseline justify-center gap-2 font-heading text-5xl font-black leading-none sm:text-7xl">
          <span className="text-2xl text-accent-green sm:text-3xl">⚾</span>
          <span className="text-accent-gold [text-shadow:0_0_40px_rgba(240,192,96,0.45)]">
            EPICPLAY
          </span>
          <span className="text-accent-green [text-shadow:0_0_40px_rgba(46,204,113,0.45)]">
            AI
          </span>
        </h1>

        <p className="max-w-md text-lg text-white">
          The Intelligence Layer Amateur Baseball Has Been Missing.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-4">
          <a
            href="/login"
            className="rounded-full bg-accent-gold px-8 py-3 font-heading text-sm font-bold uppercase tracking-wide text-background transition hover:brightness-110"
          >
            Sign In →
          </a>
          <a
            href="https://claude.ai/artifact/7ViVE1VPDERU8QQHXY3Fhx"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-border px-8 py-3 font-heading text-sm font-bold uppercase tracking-wide text-foreground transition hover:border-accent-green hover:text-accent-green"
          >
            Learn More →
          </a>
        </div>
      </div>

      <p className="relative z-10 mt-14 text-xs text-foreground/30">
        This is a temporary bridge page — the full marketing site will replace it soon.
      </p>
    </main>
  );
}
