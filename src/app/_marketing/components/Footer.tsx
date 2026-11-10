import { CONTACT_EMAIL, WHATSAPP_COMMUNITY_URL, INSTAGRAM_URL } from "@/lib/legal";
import { Wordmark } from "./Wordmark";

export function Footer() {
  return (
    <footer className="marketing-footer">
      <div className="footer-col">
        <div className="footer-brand">
          <Wordmark size={18} />
        </div>
        <p className="footer-tagline">Baseball intelligence for every team, not just the pros.</p>
      </div>

      <div className="footer-col">
        <p className="footer-col-title">Product</p>
        <div className="footer-links">
          <a href="#problem">The Problem</a>
          <a href="#how-it-works">How It Works</a>
          <a href="#demo">Try It</a>
          <a href="#kairos">KAIROS</a>
          {/* TEMP: "Pricing" removed while the Pricing section is
              hidden (see MarketingPage.tsx) -- restore
              <a href="#pricing">Pricing</a> here when it comes back. */}
          <a href="#faq">FAQ</a>
        </div>
      </div>

      <div className="footer-col">
        <p className="footer-col-title">Legal</p>
        <div className="footer-links">
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </div>
      </div>

      <div className="footer-col">
        <p className="footer-col-title">Contact</p>
        <div className="footer-links">
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          {/* Launch-capture batch: both links are TODO/empty in
              src/lib/legal.ts until a real URL exists for each -- shown
              only once they're set, per the request. */}
          {WHATSAPP_COMMUNITY_URL && (
            <a href={WHATSAPP_COMMUNITY_URL} target="_blank" rel="noopener noreferrer">
              WhatsApp community
            </a>
          )}
          {INSTAGRAM_URL && (
            <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer">
              Instagram
            </a>
          )}
        </div>
      </div>

      <p className="footer-copy">© 2026 EpicPlay AI · A MRB Company</p>
    </footer>
  );
}
