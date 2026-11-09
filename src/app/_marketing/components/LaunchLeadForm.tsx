"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { submitLead } from "../actions";

const ROLE_OPTIONS = [
  { value: "coach", label: "Coach" },
  { value: "parent", label: "Parent" },
  { value: "player", label: "Player" },
  { value: "league_organizer", label: "League organizer" },
];

// Written by the sticky mobile bar's own email field (see
// StickyMobileCta.tsx) so a visitor who types their email there and
// taps through to a real form doesn't have to retype it -- read once
// on mount, then cleared on a successful submit so it can't leak into
// a later, unrelated visit in the same tab.
const PREFILL_EMAIL_KEY = "epicplay_lead_email";

// One form, two places (the hero, compact, and the "Founding Access"
// section lower on the page, full-size) -- same fields, same action,
// same validation, so the two can never drift into asking for
// different things. `variant` only changes layout/copy, never behavior.
export function LaunchLeadForm({ variant, formId }: { variant: "compact" | "section"; formId?: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [prefillEmail, setPrefillEmail] = useState("");

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(PREFILL_EMAIL_KEY);
      if (stored) setPrefillEmail(stored);
    } catch {
      // Private window / blocked storage -- no prefill, not fatal.
    }
  }, []);

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
        try {
          sessionStorage.removeItem(PREFILL_EMAIL_KEY);
        } catch {
          // Nothing to clean up if storage was never readable.
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong -- please try again.");
      }
    });
  }

  if (success) {
    return (
      <p className={variant === "compact" ? "lead-success lead-success-compact" : "lead-success"}>
        You&apos;re in. Free until Dec 31, 2026. Watch for our WhatsApp message.
      </p>
    );
  }

  return (
    <form
      ref={formRef}
      id={formId}
      action={handleSubmit}
      className={variant === "compact" ? "lead-form lead-form-compact" : "lead-form"}
    >
      {/* Honeypot: real visitors never see this field; a naive bot
          script filling every input will fill it, and submitLead()
          silently no-ops on any non-empty value. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="lead-honeypot" />

      <div className="lead-row">
        <label className="lead-field">
          <span>Name</span>
          <input type="text" name="name" required className="lead-input" />
        </label>
        <label className="lead-field">
          <span>Email</span>
          <input type="email" name="email" required defaultValue={prefillEmail} className="lead-input" />
        </label>
      </div>

      <div className="lead-row">
        <label className="lead-field">
          <span>WhatsApp number (optional)</span>
          <input type="tel" name="phone" className="lead-input" placeholder="+1 555 123 4567" />
        </label>
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
      </div>

      <label className="lead-checkbox">
        <input type="checkbox" name="whatsappOptin" />
        <span>Add me to the EpicPlay WhatsApp community.</span>
      </label>

      {error && <p className="lead-error">{error}</p>}

      <button type="submit" disabled={isPending} className="btn-primary lead-submit">
        {isPending ? "Joining…" : "Join the founding list →"}
      </button>
    </form>
  );
}
