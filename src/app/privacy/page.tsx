import type { Metadata } from "next";
import { LegalLayout, LegalSection } from "@/components/legal-layout";
import { CONTACT_EMAIL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy | EpicPlay AI",
  description: "How EpicPlay AI collects, uses, and protects your data.",
};

export default function PrivacyPolicyPage() {
  return (
    <LegalLayout title="Privacy Policy">
      <p>
        This Privacy Policy explains what information EpicPlay AI collects when coaches,
        operators, and players use the platform, how we use it, and the choices you have.
        If anything here is unclear, email us at{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent-gold hover:text-accent-green">
          {CONTACT_EMAIL}
        </a>
        .
      </p>

      <LegalSection heading="1. Information We Collect">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong className="text-accent-gold">Account information.</strong> When you sign in
            with Google, we receive your name, email address, and profile photo.
          </li>
          <li>
            <strong className="text-accent-gold">Team and roster data.</strong> Player names,
            jersey numbers, and positions entered by a coach or operator.
          </li>
          <li>
            <strong className="text-accent-gold">Game data.</strong> At-bats, pitches, results,
            stolen bases, lineups, and related play-by-play entered while logging games.
          </li>
          <li>
            <strong className="text-accent-gold">Derived statistics.</strong> Batting and pitching
            lines, heat maps, spray charts, and other stats we compute from the game data above.
          </li>
          <li>
            <strong className="text-accent-gold">Payment status.</strong> Whether a Clubhouse Pro
            unlock has been purchased. Payments are processed by Stripe — we never see or store
            card numbers.
          </li>
          <li>
            <strong className="text-accent-gold">Technical data.</strong> IP address, browser
            type, and similar information collected automatically when you use the site.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="2. How We Use Information">
        <p>We use the information above to:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Operate the platform — live game logging, rosters, schedules, and dashboards.</li>
          <li>Show statistics, heat maps, and spray charts to coaches and players.</li>
          <li>
            Generate AI-written analysis and coaching text (see Section 3 — this involves sending
            stats to our AI processor).
          </li>
          <li>Process Clubhouse Pro payments.</li>
          <li>Maintain security, prevent abuse, and provide customer support.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="3. Third-Party Processors">
        <p>
          We rely on the following service providers to run EpicPlay AI. Each only receives the
          data it needs to perform its function:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong className="text-accent-gold">Supabase</strong> — database hosting and
            authentication.
          </li>
          <li>
            <strong className="text-accent-gold">Google</strong> — sign-in (OAuth).
          </li>
          <li>
            <strong className="text-accent-gold">Vercel</strong> — application hosting.
          </li>
          <li>
            <strong className="text-accent-gold">Stripe</strong> — payment processing for
            Clubhouse Pro.
          </li>
          <li>
            <strong className="text-accent-gold">Anthropic</strong> — AI-generated analysis. Player
            and team statistics are sent to Anthropic to produce scouting notes, coaching
            insights, and similar generated text.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="4. Who Can See Your Data">
        <p>
          A coach can see all of their own team&apos;s data — roster, games, and stats for every
          player on the team. A player can see their own Clubhouse — their own stats and, if
          unlocked, their own Clubhouse Pro content. We do not sell personal data to anyone.
        </p>
      </LegalSection>

      <LegalSection heading="5. Children and Youth Players">
        <p>
          EpicPlay AI is used to track statistics for youth baseball teams. Accounts are created
          by coaches, or by players who are invited by their coach. Children under 13 must not
          create their own account — a parent or guardian must manage access on their behalf.
        </p>
        <p>
          Coaches are responsible for having the appropriate permission from a parent or guardian
          before entering a youth player&apos;s name or other information into the platform. A
          parent or guardian may request that we delete their child&apos;s data at any time by
          emailing{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent-gold hover:text-accent-green">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection heading="6. Data Retention and Deletion">
        <p>
          We keep team and player data for as long as the associated team account remains active.
          Any user — or a parent/guardian acting for a youth player — can request deletion of
          their data by emailing{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent-gold hover:text-accent-green">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection heading="7. Security">
        <p>
          We use reasonable technical and organizational measures — including the access controls
          and encryption provided by our infrastructure providers — to protect your information.
          No method of transmission or storage is completely secure, and we cannot guarantee
          absolute security.
        </p>
      </LegalSection>

      <LegalSection heading="8. International Data Transfers">
        <p>
          Our service providers may store or process data in countries other than the one you are
          located in. By using EpicPlay AI, you understand that your information may be
          transferred to and processed in such locations.
        </p>
      </LegalSection>

      <LegalSection heading="9. Changes to This Policy">
        <p>
          We may update this Privacy Policy from time to time. We will update the &ldquo;Last
          updated&rdquo; date at the top of this page when we do. Continued use of EpicPlay AI
          after a change means you accept the updated policy.
        </p>
      </LegalSection>

      <LegalSection heading="10. Contact Us">
        <p>
          Questions about this Privacy Policy or your data? Email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent-gold hover:text-accent-green">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
