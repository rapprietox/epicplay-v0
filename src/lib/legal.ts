// Single source of truth for the facts referenced across /privacy and
// /terms (and anywhere else legal copy needs them) -- so updating a
// contact address, the "last updated" date, or the governing-law
// jurisdiction never means hunting through two long pages of prose.

export const COMPANY_NAME = "MRB (My Replay Builder), operating as EpicPlay AI";
export const CONTACT_EMAIL = "rapprietox@gmail.com";
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
export const LAST_UPDATED = "October 29, 2026";

// TODO: not yet determined -- fill in the actual governing-law
// jurisdiction (state/country) before this goes in front of real users
// and update LAST_UPDATED when it's set.
export const GOVERNING_LAW = "[TODO: governing law jurisdiction not yet determined]";
