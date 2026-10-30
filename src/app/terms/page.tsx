import type { Metadata } from "next";
import { LegalLayout, LegalSection } from "@/components/legal-layout";
import { CONTACT_EMAIL, GOVERNING_LAW } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service | EpicPlay AI",
  description: "The terms that govern use of the EpicPlay AI platform.",
};

export default function TermsOfServicePage() {
  return (
    <LegalLayout title="Terms of Service">
      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your use of EpicPlay AI. By creating
        an account or using the platform, you agree to these Terms.
      </p>

      <LegalSection heading="1. Who Can Use EpicPlay AI">
        <p>
          EpicPlay AI is intended for baseball coaches, team operators, and players on teams that
          use the platform. You are responsible for keeping your account credentials secure and
          for all activity under your account.
        </p>
        <p>
          Coaches are responsible for the accuracy of the roster data they enter and for lawfully
          adding players to their team — including obtaining any necessary permission from a
          parent or guardian before entering a youth player&apos;s information (see our{" "}
          <a href="/privacy" className="text-accent-gold hover:text-accent-green">
            Privacy Policy
          </a>
          ).
        </p>
      </LegalSection>

      <LegalSection heading="2. Acceptable Use">
        <p>You agree not to:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Use EpicPlay AI for any unlawful purpose or to upload unlawful content.</li>
          <li>Scrape, reverse engineer, or attempt to extract the platform&apos;s source code.</li>
          <li>Access, or attempt to access, another team&apos;s data without authorization.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="3. Your Content">
        <p>
          You own the roster, game, and stats data you enter into EpicPlay AI (&ldquo;User
          Content&rdquo;). By using the platform, you grant us a license to host, process, and
          display your User Content solely as needed to operate and improve the service —
          including sending relevant statistics to our AI processor to generate analysis (see our{" "}
          <a href="/privacy" className="text-accent-gold hover:text-accent-green">
            Privacy Policy
          </a>
          ).
        </p>
      </LegalSection>

      <LegalSection heading="4. AI-Generated Output">
        <p>
          EpicPlay AI uses AI to generate scouting notes, lineup suggestions, coaching
          observations, and similar text (&ldquo;AI Output&rdquo;). AI Output is informational
          only. It may be inaccurate, incomplete, or based on a small sample of data, and it does
          not constitute professional coaching, medical, or training advice.
        </p>
        <p>
          Do not rely on AI Output for decisions about a player&apos;s safety, health, or physical
          readiness to play. Always use your own judgment and consult a qualified professional
          where appropriate.
        </p>
      </LegalSection>

      <LegalSection heading="5. Payments">
        <p>
          Clubhouse Pro is offered as a one-time payment, processed securely by Stripe. We do not
          store your card details. Pricing for Clubhouse Pro and any future features or plans may
          change over time. Refunds are provided at our discretion, except where required by
          applicable law.
        </p>
      </LegalSection>

      <LegalSection heading="6. Service Provided &ldquo;As Is&rdquo;">
        <p>
          EpicPlay AI is provided &ldquo;as is&rdquo; and &ldquo;as available,&rdquo; without
          warranties of any kind. We do not guarantee that the service will be uninterrupted,
          error-free, or available at all times.
        </p>
      </LegalSection>

      <LegalSection heading="7. Limitation of Liability">
        <p>
          To the fullest extent permitted by law, EpicPlay AI and its operators are not liable for
          any indirect, incidental, or consequential damages arising from your use of the
          platform, including damages resulting from reliance on AI Output.
        </p>
      </LegalSection>

      <LegalSection heading="8. Termination and Suspension">
        <p>
          We may suspend or terminate access to EpicPlay AI, for any user or team, at any time —
          particularly for violation of these Terms or the Acceptable Use section above.
        </p>
      </LegalSection>

      <LegalSection heading="9. Changes to These Terms">
        <p>
          We may update these Terms from time to time. We will update the &ldquo;Last
          updated&rdquo; date at the top of this page when we do. Continued use of EpicPlay AI
          after a change means you accept the updated Terms.
        </p>
      </LegalSection>

      <LegalSection heading="10. Governing Law">
        <p>These Terms are governed by the laws of {GOVERNING_LAW}.</p>
      </LegalSection>

      <LegalSection heading="11. Contact Us">
        <p>
          Questions about these Terms? Email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent-gold hover:text-accent-green">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
