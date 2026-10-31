"use client";

import { useState } from "react";

// Every answer here was checked against the actual codebase before
// being written -- see the session notes for exactly what was verified
// (operator offline behavior, invite flow, Quick/Full Mode, no
// softball support, no bulk historical-game import, no self-serve data
// export). Nothing here is aspirational copy.
const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "Do I need special hardware or sensors?",
    a: "No. EpicPlay AI runs entirely from a phone or tablet's web browser -- no sensors, no extra equipment, nothing to buy beyond the device you already have.",
  },
  {
    q: "Does it work on a phone? Do I need a tablet?",
    a: "It works on a phone. The operator screen is built tablet-first because a bigger screen is easier to tap fast during a live game, but a tablet isn't required.",
  },
  {
    q: "Can I just log results without every pitch?",
    a: "Yes -- Quick Mode logs an at-bat result in one tap. Full Mode captures every pitch (type, location, outcome) if you want the detail behind the heat maps. You can pick per game.",
  },
  {
    q: "What happens if my connection drops at the field?",
    a: "The operator screen keeps working locally and snapshots your progress every few seconds, then retries any failed writes automatically once you're back online. That's best-effort, not guaranteed -- if the tab is closed mid-outage, anything that never made it to the server needs to be re-entered.",
  },
  {
    q: "Who can see my team's data? Can other teams see it?",
    a: "A coach or operator sees everything on their own team. A player sees only their own stats. Every query is scoped to your team -- another team has no access to your data, and you have no access to theirs.",
  },
  {
    q: "Is it safe for youth players? How is player data handled?",
    a: (
      <>
        Accounts are created by coaches, or by players invited by their coach -- players under 13 shouldn&apos;t create
        their own account, and a parent or guardian should manage access for them. Full details are in our{" "}
        <a href="/privacy">Privacy Policy</a>.
      </>
    ),
  },
  {
    q: "Do players need accounts? How do they get access?",
    a: "A player signs in with Google using an invite link their coach sends them -- there's no public sign-up. The invite links their account to the right team and roster spot automatically.",
  },
  {
    q: "Can I bring in a game I already scored on paper?",
    a: "There's no bulk import for a game you already scored by hand yet. You'd log it through the same operator screen, entering the at-bats as if it were live. A dedicated backfill tool is on our radar, not built today.",
  },
  {
    q: "Is the AI advice reliable?",
    a: (
      <>
        Every KAIROS recommendation comes with a reliability score based on how much real data backs it -- see{" "}
        <a href="#reliability">how the score works</a>. Early in a season, treat suggestions as a starting point;
        the more games logged, the more the score climbs.
      </>
    ),
  },
  {
    q: "Does it work for softball?",
    a: "Not yet. EpicPlay AI is built for baseball today -- softball isn't supported.",
  },
  {
    q: "What does it cost, and what's free?",
    a: (
      <>
        We&apos;re finalizing pricing for teams, individual players and leagues. Core coach and operator features
        are free during our founding period. <a href="#lead-form">Join the founding list</a> and we&apos;ll tell
        you first.
      </>
    ),
  },
  {
    q: "Can I export or delete my data?",
    a: (
      <>
        You can request deletion of your data (or a child&apos;s data, if you&apos;re a parent or guardian) by
        emailing us -- see our <a href="/privacy">Privacy Policy</a>. There&apos;s no self-serve export button yet;
        email us and we&apos;ll help you get a copy.
      </>
    ),
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section className="faq-section section-full" id="faq">
      <div className="section">
        <div className="faq-head">
          <h2 className="section-headline headline-white">Questions, answered honestly.</h2>
        </div>
        <div className="faq-list">
          {FAQ.map((item, i) => {
            const isOpen = open === i;
            return (
              <div className="faq-item" key={item.q}>
                <button
                  type="button"
                  className="faq-question"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : i)}
                >
                  <span>{item.q}</span>
                  <span className={`faq-chevron ${isOpen ? "open" : ""}`} aria-hidden="true">
                    ▾
                  </span>
                </button>
                <div className="faq-answer-wrap" style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}>
                  <div className="faq-answer-inner">
                    <p className="faq-answer">{item.a}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
