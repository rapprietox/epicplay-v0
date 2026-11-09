import { WHATSAPP_URL } from "@/lib/legal";
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

          {WHATSAPP_URL ? (
            <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="lead-whatsapp">
              Or message us on WhatsApp →
            </a>
          ) : (
            <p className="lead-whatsapp lead-whatsapp-disabled" aria-disabled="true">
              WhatsApp contact coming soon
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
