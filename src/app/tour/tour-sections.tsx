import type { ReactNode } from "react";
import { LaunchLeadForm } from "@/app/_marketing/components/LaunchLeadForm";

export type TourSection = {
  id: string;
  eyebrow: string;
  title: string;
  content: ReactNode;
  // Speaker notes: rendered only when the presenter explicitly presses
  // N while in presenter mode (see tour-experience.tsx) -- never shown
  // to a visitor by default, and never part of the normal scroll-mode
  // page at all.
  notes: ReactNode;
};

function Shot({
  src,
  alt,
  caption,
}: {
  src: string;
  alt: string;
  caption: string;
}) {
  return (
    <figure className="tour-shot">
      <img src={src} alt={alt} loading="lazy" width={1600} height={1000} />
      <figcaption>
        <span>{caption}</span>
        <span className="tour-chip tour-chip-sample">Sample data</span>
      </figcaption>
    </figure>
  );
}

export const TOUR_SECTIONS: TourSection[] = [
  {
    id: "who",
    eyebrow: "01 — Who I Am",
    title: "Who I Am",
    content: (
      <div className="tour-who-grid">
        <div className="tour-video-frame">
          <iframe
            src="https://www.youtube-nocookie.com/embed/k_8Bmc7ZJyg"
            title="Introducing EpicPlay AI"
            loading="lazy"
            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
        <div className="tour-who-text tour-body">
          <p>
            I&apos;m Ruben — I built EpicPlay AI by myself, nights and weekends, after one too many
            &ldquo;what was the score again?&rdquo; conversations at the field.
          </p>
          <p>
            Everything you&apos;ll see in this tour is running on real (sample) data, logged exactly the
            way a parent, coach, or operator would log it live.
          </p>
        </div>
      </div>
    ),
    notes: <p>Let the video play ~15s before talking over it. If it won&apos;t load, skip straight to slide 2 — nothing downstream depends on it.</p>,
  },
  {
    id: "goal",
    eyebrow: "02 — The Goal",
    title: "Facts, Not Feel",
    content: (
      <div className="tour-body">
        <p className="tour-lede">
          Teams, parents, and players all argue about the same thing after every game: how someone
          actually played. EpicPlay AI&apos;s whole goal is to replace that argument with a number.
        </p>
        <p>
          Every stat on this tour — averages, pitch locations, stolen bases — comes from a play someone
          logged during a real game, not an estimate, not a gut feeling.
        </p>
      </div>
    ),
    notes: <p>If this is their first time seeing a stats app, pause here — this one line is the entire pitch. Don&apos;t rush past it.</p>,
  },
  {
    id: "built",
    eyebrow: "03 — What's Built Today",
    title: "What's Built Today",
    content: (
      <>
        <p className="tour-lede">Everything below is live and running today — none of it is a mockup.</p>
        <ul className="tour-list">
          <li>
            Quick &amp; Full tracking
            <small>Log a game as fast or as detailed as you want.</small>
          </li>
          <li>
            Scorebook
            <small>Every game, laid out at-bat by at-bat.</small>
          </li>
          <li>
            Leaderboards
            <small>AVG, HR, RBI, stolen bases — ranked automatically.</small>
          </li>
          <li>
            Spray charts
            <small>Where every ball in play actually went.</small>
          </li>
          <li>
            Heat maps
            <small>Pitch location vs. outcome — for pitch-by-pitch (Full Mode) games only.</small>
          </li>
          <li>
            Lineup analysis
            <small>Who&apos;s producing, with a reliability score on the data behind it.</small>
          </li>
          <li>
            Performance Score
            <small>One number per player (EPS), with a tier label from Beginner up through Elite and Legendary.</small>
          </li>
          <li>
            Opponent scouting
            <small>Matchup history and the next opponent&apos;s roster.</small>
          </li>
          <li>
            The AI coach
            <small>Ask it anything about your own team&apos;s data.</small>
          </li>
          <li>
            The player page
            <small>Every player sees their own stats, heat maps, and spray chart.</small>
          </li>
        </ul>
        <div className="tour-shots-grid">
          <Shot src="/tour/team-leaders.webp" alt="Team Leaders board showing top hitters" caption="Team Leaders — coach dashboard" />
          <Shot src="/tour/clubhouse.webp" alt="A player's own Clubhouse stats page" caption="A player's own Clubhouse" />
        </div>
      </>
    ),
    notes: (
      <p>
        If they ask &ldquo;does it do scheduling / video / softball?&rdquo; — not yet, that&apos;s slide 8 (&ldquo;What&apos;s Coming&rdquo;). Don&apos;t
        improvise a yes.
      </p>
    ),
  },
  {
    id: "modes",
    eyebrow: "04 — Quick Mode vs. Full Mode",
    title: "Quick Mode vs. Full Mode",
    content: (
      <>
        <div className="tour-body">
          <p>
            <strong style={{ color: "#2ecc71" }}>Quick Mode</strong> — one tap per at-bat (result only: single,
            strikeout, walk...). Fast enough to run solo from the dugout. Feeds every leaderboard, the
            scorebook, and the box score.
          </p>
          <p>
            <strong style={{ color: "#f0c060" }}>Full Mode</strong> — every pitch, logged with its type,
            location, and outcome. Slower, but it&apos;s the only mode that unlocks heat maps, pitch-type
            splits, and swing-and-miss analysis — because those need pitch-by-pitch data to exist at all.
          </p>
          <p>You can mix both across a season. Nothing is lost either way — Full Mode just adds detail on top.</p>
        </div>
        <div className="tour-shots-grid">
          <Shot src="/tour/scorebook.webp" alt="A completed game's scorebook view" caption="The scorebook — either mode logs into this" />
        </div>
      </>
    ),
    notes: (
      <p>
        This is the #1 question coaches ask: &ldquo;do I have to log every pitch?&rdquo; Answer: no — Quick
        Mode is one tap per at-bat, and it&apos;s what most of this demo season actually used.
      </p>
    ),
  },
  {
    id: "demo",
    eyebrow: "05 — The Demo",
    title: "Live Demo With Your Team",
    content: (
      <div className="tour-body">
        <p className="tour-lede">Live demo with your team.</p>
        <p>Ask me to run two real innings, live, right now, on this same team.</p>
      </div>
    ),
    notes: (
      <>
        <h3>Click path — run two innings live</h3>
        <ol style={{ margin: "6px 0 0 16px", padding: 0 }}>
          <li>Sign in at /login/operator as demo@epicplayai.com (coach).</li>
          <li>From the coach dashboard, open the Summit Stingers game (Jul 25) — lineup &amp; umpire are already locked.</li>
          <li>Click &ldquo;Start Game,&rdquo; pick Quick or Full Mode on the spot.</li>
          <li>Log two innings live — in Full Mode, tap a few pitches and point at the heat map filling in real time.</li>
        </ol>
        <h3 style={{ marginTop: 12 }}>Questions to ask the AI coach</h3>
        <ul>
          <li>Who&apos;s hot and who&apos;s cold on this roster right now?</li>
          <li>Where should Derek Foster expect to see pitches he struggles with?</li>
          <li>Who leads the team in stolen bases, and how efficient are they?</li>
          <li>Which hitters pull the ball, and which go the other way?</li>
          <li>What does the lineup analysis say about batting order 1 through 10 for the next game?</li>
        </ul>
      </>
    ),
  },
  {
    id: "after",
    eyebrow: "06 — After the Game",
    title: "After the Game",
    content: (
      <>
        <p className="tour-lede">The moment the last pitch is logged, every page below updates — no export, no spreadsheet.</p>
        <div className="tour-shots-grid tour-shots-grid-3">
          <Shot src="/tour/team-hitting.webp" alt="Team hitting table with every player's season line" caption="Team Hitting" />
          <Shot src="/tour/spray-chart.webp" alt="Spray chart showing a hitter's pull tendency" caption="Spray chart" />
          <Shot src="/tour/heat-map.webp" alt="Strike zone heat map showing a weak zone" caption="Heat map (Full Mode games only)" />
        </div>
      </>
    ),
    notes: <p>These are real screenshots from the demo team&apos;s own season — not mockups. Say that out loud.</p>,
  },
  {
    id: "decisions",
    eyebrow: "07 — Decisions",
    title: "Decisions, Not Guesses",
    content: (
      <>
        <p className="tour-lede">
          This is where it stops being &ldquo;neat stats&rdquo; and starts being something you&apos;d actually change your
          lineup or your scouting report over.
        </p>
        <div className="tour-shots-grid">
          <Shot src="/tour/lineup-analysis.webp" alt="Lineup analysis grid with a reliability badge" caption="Lineup analysis + reliability score" />
          <Shot src="/tour/heat-map.webp" alt="Derek Foster's heat map showing one weak zone" caption="Derek Foster — .105 AVG in one zone, 19 AB" />
        </div>
        <div className="tour-quote">
          <p className="tour-quote-q">Asked the AI coach, live: &ldquo;Where should Derek Foster expect to see pitches he struggles with?&rdquo;</p>
          <p className="tour-quote-a">
            The screenshot below is the real, unedited answer — including the AI flagging its own secondary reads as
            lower-confidence (small sample size) instead of stating everything with the same certainty.
          </p>
        </div>
        <div className="tour-shots-grid" style={{ marginTop: 14 }}>
          <Shot src="/tour/ai-coach.webp" alt="AI coach answering a question about a player's weak zone, honestly noting the limits of its data" caption="The AI coach, asked live" />
        </div>
      </>
    ),
    notes: (
      <p>
        Point at the dimmest cell on the heat map (.105 AVG, 19 AB — the &ldquo;Middle-Outside&rdquo; zone) and say: &ldquo;this
        came from the data, not a guess.&rdquo; If the AI answer looks cautious, that&apos;s the point — it only reasons from
        what&apos;s actually logged, it doesn&apos;t invent a hot/cold zone. The reliability score is high here because this
        team has a full season logged — a new team starts lower and climbs as they log more games.
      </p>
    ),
  },
  {
    id: "coming",
    eyebrow: "08 — What's Coming",
    title: "What's Coming",
    content: (
      <>
        <p className="tour-lede">None of this is built yet. It&apos;s on the roadmap, not on this tour.</p>
        <ul className="tour-list">
          <li>
            <span className="tour-chip tour-chip-dev">In development</span>&nbsp; Training plans
          </li>
          <li>
            <span className="tour-chip tour-chip-dev">In development</span>&nbsp; Season awards
          </li>
          <li>
            <span className="tour-chip tour-chip-dev">In development</span>&nbsp; Live stadium view
          </li>
          <li>
            <span className="tour-chip tour-chip-dev">In development</span>&nbsp; Softball support
          </li>
        </ul>
      </>
    ),
    notes: <p>Be explicit none of this is built. If asked for a date, say &ldquo;no date yet&rdquo; — don&apos;t improvise one.</p>,
  },
  {
    id: "founding",
    eyebrow: "09 — Founding Access",
    title: "Founding Access",
    content: (
      <div className="tour-founding">
        <div className="tour-body">
          <p className="tour-lede">Try it on your own team: your first 2 games are on us.</p>
          <p>Then lock in the founding price: $199 for a full 180-day season pass, for your whole roster. Limited to the first 20 teams. After that it&apos;s $249.</p>
          <p>No card needed to start. Just a name and an email.</p>
        </div>
        <div className="tour-price-card">
          <div className="tour-price">Founding price: $199</div>
          <div style={{ marginTop: 16 }}>
            <LaunchLeadForm
              variant="section"
              formId="tour-lead-form"
              source="tour"
              submitLabel="Reserve my founding spot →"
              pendingLabel="Reserving…"
              successMessage="You're in. Watch for our WhatsApp message about your first 2 games and locking in the $199 founding price."
            />
          </div>
        </div>
      </div>
    ),
    notes: <p>Ask for the sign-up right here, on this screen, before they leave the tab. Don&apos;t wait for a follow-up email.</p>,
  },
];
