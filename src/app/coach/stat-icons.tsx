// Team Leaders Board: placeholder inline SVG icons, one per stat category.
// Keyed by the stat's own label string -- the same string buildRows
// already produces in leaders-board.tsx, so no separate id needs to be
// threaded through anywhere. These are deliberately simple placeholder
// glyphs, not final art.
//
// Swap point for later: a coach-uploadable custom icon per stat would
// only ever need to change what StatIcon resolves to for a given label
// (e.g. check a per-team override map/URL first, fall back to
// STAT_ICONS below) -- callers only ever render <StatIcon label={...} />
// and never reach into STAT_ICONS directly, so that lookup is the one
// place a future upload feature has to touch.

function IconBase({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

// Batting Average -- a bat silhouette: handle-to-barrel diagonal with a
// rounded barrel cap.
function BatIcon() {
  return (
    <IconBase>
      <path d="M5 19L15 9" />
      <circle cx="17.5" cy="6.5" r="2.5" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

// Home Runs -- a ball flying, trailed by motion lines.
function HomeRunIcon() {
  return (
    <IconBase>
      <circle cx="7" cy="17" r="3" />
      <path d="M12 12l4-4M15 15l4-2M13 9l3-3" />
    </IconBase>
  );
}

// RBI -- a runner crossing home plate.
function RbiIcon() {
  return (
    <IconBase>
      <path d="M4 20h9l3-4-3-4H4z" />
      <circle cx="9" cy="6" r="2" />
      <path d="M9 8v5M9 10l-3 3M9 10l3 3" />
    </IconBase>
  );
}

// OPS -- a lightning bolt (power metric).
function LightningIcon() {
  return (
    <IconBase>
      <path d="M13 2L4 14h6l-1 8 9-12h-6z" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

// OBP -- a base, diamond-oriented.
function BaseIcon() {
  return (
    <IconBase>
      <rect x="7" y="7" width="10" height="10" rx="1.5" transform="rotate(45 12 12)" />
    </IconBase>
  );
}

// SLG -- bat making contact with the ball.
function ContactIcon() {
  return (
    <IconBase>
      <path d="M4 20L14 10" />
      <circle cx="16.5" cy="7.5" r="2.2" />
      <path d="M20 4l1.4-1.4M21 7.5h2M17.5 3l-.4-2" />
    </IconBase>
  );
}

// Hits -- a ball with speed lines behind it.
function HitIcon() {
  return (
    <IconBase>
      <circle cx="14" cy="12" r="4" />
      <path d="M2 8.5h5M2 12h4M2 15.5h5" />
    </IconBase>
  );
}

// Doubles -- two bases lit up.
function DoublesIcon() {
  return (
    <IconBase>
      <rect x="3.5" y="9" width="7" height="7" rx="1" transform="rotate(45 7 12.5)" fill="currentColor" stroke="none" />
      <rect x="13.5" y="9" width="7" height="7" rx="1" transform="rotate(45 17 12.5)" />
    </IconBase>
  );
}

// Triples -- three bases lit up.
function TriplesIcon() {
  return (
    <IconBase>
      <rect x="1.5" y="9" width="6" height="6" rx="1" transform="rotate(45 4.5 12)" fill="currentColor" stroke="none" />
      <rect x="9" y="9" width="6" height="6" rx="1" transform="rotate(45 12 12)" fill="currentColor" stroke="none" />
      <rect x="16.5" y="9" width="6" height="6" rx="1" transform="rotate(45 19.5 12)" />
    </IconBase>
  );
}

// Stolen Bases -- a running figure.
function RunningIcon() {
  return (
    <IconBase>
      <circle cx="13" cy="4.5" r="2" />
      <path d="M13 6.5v4.5M13 11l-5 3M13 9l5 1.5M13 11l2 7M8 21l2.5-4" />
    </IconBase>
  );
}

// ERA -- a flame (heat on the mound).
function FlameIcon() {
  return (
    <IconBase>
      <path
        d="M12 3c1 3-2 4-2 7a3 3 0 006 0c0-1-1-2-1-2 2 1 3 3 3 5a6 6 0 11-12 0c0-4 3-6 3-8 0-1 1-2 3-2z"
        fill="currentColor"
        stroke="none"
      />
    </IconBase>
  );
}

// WHIP -- a shield (protection).
function ShieldIcon() {
  return (
    <IconBase>
      <path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z" />
    </IconBase>
  );
}

// Wins -- a star.
function StarIcon() {
  return (
    <IconBase>
      <path
        d="M12 2.5l2.6 5.7 6.2.6-4.7 4.2 1.4 6.1L12 16l-5.5 3.1 1.4-6.1-4.7-4.2 6.2-.6z"
        fill="currentColor"
        stroke="none"
      />
    </IconBase>
  );
}

// Strikeouts -- a "K" with an angular, bolt-like kink in each stroke.
function StrikeoutIcon() {
  return (
    <IconBase>
      <path d="M6 4v16" />
      <path d="M6 12l3.5-3-1 1 5.5-6" />
      <path d="M6 12l3.5 3-1-1 5.5 6" />
    </IconBase>
  );
}

// Innings Pitched -- a clock.
function ClockIcon() {
  return (
    <IconBase>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v4.5l3 2" />
    </IconBase>
  );
}

// Fallback for any stat label without a mapped icon -- a plain diamond,
// consistent with the base-themed set above.
function DefaultIcon() {
  return (
    <IconBase>
      <rect x="7" y="7" width="10" height="10" rx="1.5" transform="rotate(45 12 12)" />
    </IconBase>
  );
}

const STAT_ICONS: Record<string, () => React.ReactElement> = {
  "Batting Average": BatIcon,
  "Home Runs": HomeRunIcon,
  RBI: RbiIcon,
  OPS: LightningIcon,
  OBP: BaseIcon,
  SLG: ContactIcon,
  Hits: HitIcon,
  Doubles: DoublesIcon,
  Triples: TriplesIcon,
  "Stolen Bases": RunningIcon,
  ERA: FlameIcon,
  WHIP: ShieldIcon,
  Wins: StarIcon,
  "Strikeouts (P)": StrikeoutIcon,
  "Innings Pitched": ClockIcon,
};

export function StatIcon({ label }: { label: string }) {
  const Cmp = STAT_ICONS[label] ?? DefaultIcon;
  return <Cmp />;
}
