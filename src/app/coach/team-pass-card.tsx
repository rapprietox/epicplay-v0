import { createClient } from "@/lib/supabase/server";
import { getActiveTeamPass, getFoundingTeamPassSpotsRemaining } from "@/lib/team-pass-queries";
import { getTeamPassPriceDisplay } from "@/lib/clubhouse-price";
import { formatTimestampDate } from "@/lib/dates";
import { FOUNDING_TEAM_LIMIT, TEAM_PASS_WHATS_INCLUDED } from "@/lib/pricing";
import { TeamPassCheckoutButton } from "./team-pass-checkout-button";

// Team Pass batch: an async Server Component (same pattern as
// NextGamePanel) rather than a client component -- the founding-spots
// count needs the service role (team_passes' RLS only lets a team read
// its own rows, not a cross-team count), and the price display needs a
// Stripe call, neither of which belongs in client code.
export async function TeamPassCard({ teamId }: { teamId: string }) {
  const supabase = createClient();
  const [activePass, spotsRemaining, priceDisplay] = await Promise.all([
    getActiveTeamPass(supabase, teamId),
    getFoundingTeamPassSpotsRemaining(),
    getTeamPassPriceDisplay(),
  ]);

  return (
    <section className="glossy rounded-lg border border-accent-gold/30 bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-gold">Team Pass</p>
          <h2 className="font-heading mt-1 text-2xl font-bold text-white">
            {activePass ? `Active until ${formatTimestampDate(activePass.ends_at)}` : "Not active"}
          </h2>
          <p className="mt-1 text-sm text-foreground/60">
            {activePass
              ? "Every player on your roster has Clubhouse Pro while this is active."
              : "One purchase unlocks Clubhouse Pro for every player on your roster at once."}
          </p>
        </div>
        <TeamPassCheckoutButton priceDisplay={priceDisplay} />
      </div>

      {spotsRemaining > 0 ? (
        <p className="mt-3 text-xs font-semibold text-accent-gold">
          {spotsRemaining} of {FOUNDING_TEAM_LIMIT} founding spots left
        </p>
      ) : (
        <p className="mt-3 text-xs text-foreground/40">Founding pricing is no longer available -- {FOUNDING_TEAM_LIMIT} teams have claimed it.</p>
      )}

      <div className="mt-4 rounded-md border border-border bg-background/50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-foreground/40">What&apos;s included</p>
        <ul className="mt-2 flex flex-col gap-1.5 text-sm text-white/80">
          {TEAM_PASS_WHATS_INCLUDED.map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 text-accent-green">✓</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
