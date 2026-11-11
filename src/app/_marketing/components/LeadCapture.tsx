import { WHATSAPP_COMMUNITY_URL } from "@/lib/legal";
import { LaunchLeadForm } from "./LaunchLeadForm";

// Launch-capture batch: this is the "Founding Access" section lower on
// the page -- same LaunchLeadForm (full "section" variant) the hero
// uses in compact form, so both touchpoints ask for exactly the same
// fields and submit through exactly the same validated action. The
// old team-size/message/"operator" role fields this section used to
// have are retired in favor of the new spec everywhere on this page,
// not kept as a second, divergent form shape.
export function LeadCapture() {
  return (
    <section className="lead-section section-full" id="lead-form">
      <div className="section lead-inner">
        <div className="lead-head">
          <h2 className="section-headline headline-white">Founding Access</h2>
          <p className="lead-sub">Free until Dec 31, 2026. Tell us about your team and we&apos;ll reach out.</p>
        </div>

        <div className="card lead-card cursor-glow">
          <LaunchLeadForm variant="section" formId="lead-form-section" />

          {/* Launch-copy batch: was a WHATSAPP_URL (1:1 contact link)
              fallback that showed "WhatsApp contact coming soon" since
              that constant has never been set -- replaced with the
              real, already-live WHATSAPP_COMMUNITY_URL channel link,
              matching every other WhatsApp-channel touchpoint on this
              page (banner, footer, post-submit button). */}
          {WHATSAPP_COMMUNITY_URL && (
            <a href={WHATSAPP_COMMUNITY_URL} target="_blank" rel="noopener noreferrer" className="lead-whatsapp">
              Join our WhatsApp channel →
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
