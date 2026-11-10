"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { submitLead } from "../actions";
import { WHATSAPP_COMMUNITY_URL } from "@/lib/legal";

const ROLE_OPTIONS = [
  { value: "coach", label: "Coach" },
  { value: "parent", label: "Parent" },
  { value: "player", label: "Player" },
  { value: "league_organizer", label: "League organizer" },
];

const SPORT_OPTIONS = [
  { value: "baseball", label: "Baseball" },
  { value: "softball", label: "Softball" },
  { value: "both", label: "Both" },
];

// Written by the sticky mobile bar's own email field (see
// StickyMobileCta.tsx) so a visitor who types their email there and
// taps through to a real form doesn't have to retype it -- read once
// on mount, then cleared on a successful submit so it can't leak into
// a later, unrelated visit in the same tab.
const PREFILL_EMAIL_KEY = "epicplay_lead_email";

// One form, two places. Video-visibility fix: the hero's "compact"
// variant now asks for name and email ONLY -- phone/role/the WhatsApp
// checkbox moved to being exclusively the "Founding Access" section's
// job, per the request ("keep one form in the hero (name and email
// only, the rest in the 'Founding Access' section)"). The "section"
// variant is unchanged (every field). Both still submit through the
// same submitLead action; role is optional there (see actions.ts) so a
// name+email-only hero submission isn't rejected for a field it never
// asked for.
export function LaunchLeadForm({ variant, formId }: { variant: "compact" | "section"; formId?: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [prefillEmail, setPrefillEmail] = useState("");
  // Sport-choice batch: captured client-side from the submitted
  // FormData (not re-read from the server result) so the success
  // state knows whether to show the softball notice -- submitLead()
  // only ever returns {ok}/{error}, it doesn't echo back what was sent.
  const [submittedSport, setSubmittedSport] = useState<string | null>(null);

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
        setSubmittedSport(String(formData.get("sport") ?? ""));
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
      <div className={variant === "compact" ? "lead-success-block lead-success-block-compact" : "lead-success-block"}>
        <p className={variant === "compact" ? "lead-success lead-success-compact" : "lead-success"}>
          You&apos;re in. Free until Dec 31, 2026. Watch for our WhatsApp message.
        </p>
        {/* "If someone picks Softball, let them finish and show..." --
            scoped to exactly 'softball', not 'both': the request names
            that one value specifically, and "both" still gets full
            baseball support today, so it doesn't need the caveat. */}
        {submittedSport === "softball" && (
          <p className="lead-success-note">
            Softball support is coming soon. We&apos;ll let you know when it&apos;s ready. Until then, stats use baseball rules.
          </p>
        )}
        {/* WhatsApp-channel batch: shown after ANY successful submit,
            regardless of the "Send me updates" checkbox -- joining the
            public channel is a separate, opt-in-on-its-own action from
            asking EpicPlay to message them directly. Gated on the same
            truthiness check every other WHATSAPP_COMMUNITY_URL caller
            uses. */}
        {WHATSAPP_COMMUNITY_URL && (
          <a href={WHATSAPP_COMMUNITY_URL} target="_blank" rel="noopener noreferrer" className="btn-primary lead-whatsapp-channel-btn">
            Join our WhatsApp channel →
          </a>
        )}
      </div>
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

      {/* Sport-choice batch: required on both variants (unlike role,
          which stays "section"-only and optional -- see actions.ts).
          Softball isn't supported yet; picking it still lets the
          visitor finish, see the success-state's "coming soon" note
          above. */}
      <div className="lead-row">
        <label className="lead-field">
          <span>Sport</span>
          <select name="sport" required defaultValue="" className="lead-input">
            <option value="" disabled>
              Select one
            </option>
            {SPORT_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {variant === "section" && (
        <>
          <div className="lead-row">
            <label className="lead-field">
              <span>WhatsApp number (optional)</span>
              <input type="tel" name="phone" className="lead-input" placeholder="+1 555 123 4567" />
              <span className="lead-hint">Only used to message you about EpicPlay.</span>
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

          {/* id targeted by the banner-redesign batch's WhatsApp slot:
              when WHATSAPP_COMMUNITY_URL is empty, LaunchBanner scrolls
              straight to this checkbox instead of linking out. Wording
              updated for the WhatsApp-channel batch: the channel is
              broadcast-only and can't add people to it the way a group
              invite could, so this is now about opting in to EpicPlay
              messaging them, not "joining" anything via this checkbox. */}
          <label className="lead-checkbox" id="whatsapp-optin-field">
            <input type="checkbox" name="whatsappOptin" />
            <span>Send me updates on WhatsApp</span>
          </label>
        </>
      )}

      {error && <p className="lead-error">{error}</p>}

      <button type="submit" disabled={isPending} className="btn-primary lead-submit">
        {isPending ? "Joining…" : "Join the founding list →"}
      </button>
    </form>
  );
}
