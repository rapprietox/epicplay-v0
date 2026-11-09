// Single source of truth for the facts referenced across /privacy and
// /terms (and anywhere else legal copy needs them) -- so updating a
// contact address, the "last updated" date, or the governing-law
// jurisdiction never means hunting through two long pages of prose.

export const COMPANY_NAME = "MRB (My Replay Builder), operating as EpicPlay AI";
export const CONTACT_EMAIL = "info@epicplayai.com";
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
export const LAST_UPDATED = "October 29, 2026";

// TODO: not yet determined -- fill in the actual governing-law
// jurisdiction (state/country) before this goes in front of real users
// and update LAST_UPDATED when it's set.
export const GOVERNING_LAW = "[TODO: governing law jurisdiction not yet determined]";

// TODO: no WhatsApp number/business link exists yet -- replace with the
// real wa.me/<number> or business WhatsApp link once one is set up. Left
// as an empty string (not a placeholder URL) so callers can check
// `WHATSAPP_URL` truthiness and hide the button entirely until it's real.
export const WHATSAPP_URL = "";

// Launch-capture batch: a WhatsApp *community* invite link (distinct
// from WHATSAPP_URL above, which is a direct 1:1 contact link) and an
// Instagram profile link -- both TODO, both empty strings for the same
// reason as WHATSAPP_URL above, so callers can check truthiness and
// hide the button entirely until a real URL is set.
export const WHATSAPP_COMMUNITY_URL = "";
export const INSTAGRAM_URL = "";
