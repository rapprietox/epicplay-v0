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

// Launch-capture batch: a WhatsApp link (distinct from WHATSAPP_URL
// above, which is a direct 1:1 contact link). Sport-choice/WhatsApp-
// channel batch: this is a public WhatsApp *channel* (broadcast-only,
// can't add people to it the way a group invite link would) -- real
// as of that batch, not a TODO placeholder anymore. Every caller
// (LaunchBanner's WhatsApp slot, Footer, LaunchLeadForm's post-submit
// button) already gates on this constant's truthiness, so setting it
// here is what turns all three on at once, with no other code change
// needed for them. INSTAGRAM_URL stays an empty TODO -- no real
// profile link exists yet.
export const WHATSAPP_COMMUNITY_URL = "https://whatsapp.com/channel/0029Vb9TseuADTOHFcYEyX3S";
export const INSTAGRAM_URL = "";
