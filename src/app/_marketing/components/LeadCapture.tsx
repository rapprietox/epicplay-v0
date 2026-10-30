"use client";

import { useRef, useState, useTransition } from "react";
import { submitLead } from "../actions";
import { WHATSAPP_URL } from "@/lib/legal";

const ROLE_OPTIONS = [
  { value: "coach", label: "Coach" },
  { value: "operator", label: "Operator" },
  { value: "player", label: "Player" },
  { value: "league_organizer", label: "League organizer" },
];

export function LeadCapture() {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await submitLead(formData);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setSuccess(true);
        formRef.current?.reset();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong -- please try again.");
      }
    });
  }

  return (
    <section className="lead-section section-full" id="lead-form">
      <div className="section lead-inner">
        <div className="lead-head">
          <h2 className="section-headline headline-white">Join the founding teams.</h2>
          <p className="lead-sub">Tell us about your team and we&apos;ll reach out.</p>
        </div>

        <div className="card lead-card cursor-glow">
          {success ? (
            <p className="lead-success">Thanks -- we&apos;ve got it. We&apos;ll be in touch soon.</p>
          ) : (
            <form ref={formRef} action={handleSubmit} className="lead-form">
              {/* Honeypot: real visitors never see this field; a naive bot
                  script filling every input will fill it, and submitLead()
                  silently no-ops on any non-empty value. */}
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                className="lead-honeypot"
              />

              <div className="lead-row">
                <label className="lead-field">
                  <span>Name</span>
                  <input type="text" name="name" required className="lead-input" />
                </label>
                <label className="lead-field">
                  <span>Email</span>
                  <input type="email" name="email" required className="lead-input" />
                </label>
              </div>

              <div className="lead-row">
                <label className="lead-field">
                  <span>Role</span>
                  <select name="role" required defaultValue="" className="lead-input">
                    <option value="" disabled>
                      Select one
                    </option>
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="lead-field">
                  <span>Team size (optional)</span>
                  <input type="number" name="teamSize" min={0} className="lead-input" />
                </label>
              </div>

              <label className="lead-field">
                <span>Message (optional)</span>
                <textarea name="message" rows={3} className="lead-input lead-textarea" />
              </label>

              {error && <p className="lead-error">{error}</p>}

              <button type="submit" disabled={isPending} className="btn-primary lead-submit">
                {isPending ? "Sending…" : "Join founding teams →"}
              </button>
            </form>
          )}

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
