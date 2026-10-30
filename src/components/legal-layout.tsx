import Link from "next/link";
import type { ReactNode } from "react";
import { COMPANY_NAME, CONTACT_EMAIL, LAST_UPDATED } from "@/lib/legal";

// Shared shell for /privacy and /terms -- both are plain server
// components (no interactivity needed), styled to match the marketing
// site's dark theme rather than the app's own #C8F0D5 foreground token,
// per the brighter #EAF7EE text color specifically requested for these
// two pages.

interface LegalLayoutProps {
  title: string;
  children: ReactNode;
}

export function LegalLayout({ title, children }: LegalLayoutProps) {
  return (
    <div className="min-h-screen bg-background text-[#EAF7EE]">
      <div className="mx-auto max-w-[760px] px-6 py-16">
        <Link
          href="/"
          className="text-sm text-accent-gold transition hover:text-accent-green"
        >
          ← Back to EpicPlay AI
        </Link>

        <h1 className="mt-8 font-heading text-4xl font-black leading-tight text-accent-gold sm:text-5xl">
          {title}
        </h1>
        <p className="mt-2 text-sm text-[#EAF7EE]/60">Last updated: {LAST_UPDATED}</p>

        <div className="legal-prose mt-10 text-[1.0625rem] leading-[1.75]">{children}</div>
      </div>
      <LegalFooter />
    </div>
  );
}

export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-heading text-xl font-bold text-accent-gold">{heading}</h2>
      <div className="mt-3 space-y-3 text-[#EAF7EE]/90">{children}</div>
    </section>
  );
}

function LegalFooter() {
  return (
    <footer className="border-t border-border px-6 py-10 text-center text-sm text-[#EAF7EE]/50">
      <p>
        © 2026 {COMPANY_NAME}
      </p>
      <p className="mt-1">
        Questions?{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent-gold hover:text-accent-green">
          {CONTACT_EMAIL}
        </a>
      </p>
      <p className="mt-4">
        <Link href="/privacy" className="mr-4 text-[#EAF7EE]/70 hover:text-accent-gold">
          Privacy
        </Link>
        <Link href="/terms" className="text-[#EAF7EE]/70 hover:text-accent-gold">
          Terms
        </Link>
      </p>
    </footer>
  );
}
