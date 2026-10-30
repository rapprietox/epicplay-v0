"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export type LeadResult = { ok: true } | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_ROLES = ["coach", "operator", "player", "league_organizer"] as const;

// Simple in-memory sliding-window rate limit, same spirit as this
// repo's existing in-memory offline retry queue
// (src/lib/operator/sync-queue.ts) -- module-scoped, not a new table.
// Resets on a cold start and doesn't share state across server
// instances, which is an accepted limitation for a "simple rate limit"
// on a lead form, not a security boundary.
const submissionsByIp = new Map<string, number[]>();
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const existing = (submissionsByIp.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (existing.length >= MAX_PER_WINDOW) {
    submissionsByIp.set(ip, existing);
    return true;
  }
  existing.push(now);
  submissionsByIp.set(ip, existing);
  return false;
}

function clientIp(): string {
  const h = headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return h.get("x-real-ip") ?? "unknown";
}

// Honeypot field name deliberately looks like a real field ("website")
// so a naive bot script fills it in -- a real visitor never sees it
// (see .lead-honeypot in marketing.css). Any non-empty value here
// returns a success-shaped result without ever touching the database,
// so the bot gets no signal that it was caught.
export async function submitLead(formData: FormData): Promise<LeadResult> {
  const honeypot = String(formData.get("website") ?? "").trim();
  if (honeypot) return { ok: true };

  const ip = clientIp();
  if (isRateLimited(ip)) {
    return { ok: false, error: "Too many submissions -- please try again in a bit." };
  }

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim();
  const teamSizeRaw = String(formData.get("teamSize") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();

  if (!name) return { ok: false, error: "Enter your name." };
  if (!email || !EMAIL_RE.test(email)) return { ok: false, error: "Enter a valid email." };
  if (!ALLOWED_ROLES.includes(role as (typeof ALLOWED_ROLES)[number])) {
    return { ok: false, error: "Select a role." };
  }

  let teamSize: number | null = null;
  if (teamSizeRaw) {
    const parsed = Number(teamSizeRaw);
    if (!Number.isFinite(parsed) || parsed < 0) return { ok: false, error: "Enter a valid team size." };
    teamSize = Math.round(parsed);
  }

  try {
    const supabase = createClient();
    const { error } = await supabase.from("leads").insert({
      name,
      email,
      role: role as (typeof ALLOWED_ROLES)[number],
      team_size: teamSize,
      message: message || null,
      source: "marketing_site",
    });
    if (error) {
      console.error("[submitLead] insert failed", error);
      return { ok: false, error: "Something went wrong -- please try again." };
    }
    return { ok: true };
  } catch (err) {
    console.error("[submitLead] unexpected error", err);
    return { ok: false, error: "Something went wrong -- please try again." };
  }
}
