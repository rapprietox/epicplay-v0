// Manually grants (or extends) a team's Team Pass outside Stripe --
// covers a sale negotiated directly with a coach/league (cash, invoice,
// a deal that never goes through Checkout). Same "if a pass is already
// active, the new term starts when the current one ends" rule the
// webhook/checkout path uses (src/lib/team-pass.ts's computeTeamPassTerm)
// -- reimplemented inline below rather than imported, since this is a
// plain .mjs script run directly with `node`, not through the Next.js/
// TypeScript build, and src/lib/team-pass.ts can't be imported as-is
// from here. Keep the two in sync if that logic ever changes.
//
// Defaults to a DRY RUN: prints exactly what it would insert and exits
// without writing anything. Pass --apply to actually write the row.
// Refuses to run against a team id that doesn't exist in `teams`.
//
// No secrets in this file: it reads NEXT_PUBLIC_SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY from the environment it's run in (e.g. via
// `node --env-file=.env.local` on Node 20.6+, or any other way you
// already load .env.local into the shell) and never hardcodes either.
//
// Usage:
//   node --env-file=.env.local supabase/data-ops/grant-team-pass.mjs <teamId> <days>            (dry run -- prints what it would write)
//   node --env-file=.env.local supabase/data-ops/grant-team-pass.mjs <teamId> <days> --apply     (actually writes it)

import { createClient } from "@supabase/supabase-js";

const teamId = process.argv[2];
const daysArg = process.argv[3];
const apply = process.argv.includes("--apply");

if (!teamId || !daysArg) {
  console.error("Usage: node --env-file=.env.local supabase/data-ops/grant-team-pass.mjs <teamId> <days> [--apply]");
  process.exit(1);
}

const days = Number(daysArg);
if (!Number.isFinite(days) || days <= 0) {
  console.error(`Invalid day count "${daysArg}" -- must be a positive number.`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in the environment. " +
      "Load .env.local first (e.g. `node --env-file=.env.local supabase/data-ops/grant-team-pass.mjs`) -- " +
      "this script never reads or hardcodes either value itself."
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const { data: team, error: teamError } = await supabase.from("teams").select("id, name").eq("id", teamId).maybeSingle();
if (teamError) {
  console.error(teamError.message);
  process.exit(1);
}
if (!team) {
  console.error(`No team found with id ${teamId}. Nothing was written.`);
  process.exit(1);
}

const now = new Date();
const { data: currentActivePass, error: activeError } = await supabase
  .from("team_passes")
  .select("ends_at")
  .eq("team_id", teamId)
  .eq("status", "active")
  .lte("starts_at", now.toISOString())
  .gte("ends_at", now.toISOString())
  .limit(1)
  .maybeSingle();
if (activeError) {
  console.error(activeError.message);
  process.exit(1);
}

// Mirrors src/lib/team-pass.ts's computeTeamPassTerm exactly: extend
// from the current pass's own end date if one is active, otherwise
// start from now.
const startMs = currentActivePass ? new Date(currentActivePass.ends_at).getTime() : now.getTime();
const startsAt = new Date(startMs).toISOString();
const endsAt = new Date(startMs + days * 24 * 60 * 60 * 1000).toISOString();

const row = {
  team_id: teamId,
  starts_at: startsAt,
  ends_at: endsAt,
  purchased_by: null,
  stripe_checkout_session_id: null,
  amount_cents: null,
  status: "active",
};

console.log(`Team: ${team.name} (${team.id})`);
if (currentActivePass) {
  console.log(`Currently has an active pass until ${currentActivePass.ends_at} -- this grant will EXTEND from that date.`);
} else {
  console.log("No currently active pass -- this grant will start from now.");
}
console.log(`Would insert: starts_at=${row.starts_at}, ends_at=${row.ends_at} (${days} day${days === 1 ? "" : "s"}), status=active`);

if (!apply) {
  console.log("\nDry run only -- nothing was written. Re-run with --apply to actually grant this pass.");
  process.exit(0);
}

const { error: insertError } = await supabase.from("team_passes").insert(row);
if (insertError) {
  console.error(`Failed to write the team_passes row: ${insertError.message}`);
  process.exit(1);
}

console.log("\nDone -- team pass granted.");
