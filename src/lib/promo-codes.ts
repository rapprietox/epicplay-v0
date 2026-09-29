import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type RedeemPromoCodeResult = { ok: true } | { ok: false; error: string };

// Bug fix: a promo code entry was crashing to an opaque "Server
// Components render error" in production (Next.js redacts the real
// error message on any uncaught throw from a Server Action). The most
// likely causes: createServiceRoleClient() throws synchronously if
// SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_URL) is missing in
// this deploy's env vars (same class of issue as the earlier
// NEXT_PUBLIC_SITE_URL bug), or a Postgres error if the promo_codes
// table/migration was never actually applied to the production database
// (this repo's migrations are hand-applied via the Supabase SQL Editor,
// not auto-run on deploy -- see supabase/README.md). Either way, the fix
// is the same: never let an exception escape this function uncaught.
// console.error logs the real cause to Vercel's Logs tab; the caller
// always gets back a plain, user-friendly result instead.
const GENERIC_ERROR = "Invalid code or already used — try again";

// Service-role, same reasoning as claimInvite (src/lib/invites.ts): both
// promo_codes and players writes here are outside a plain player
// session's RLS scope (promo_codes write is coach/operator-only;
// players write is coach/operator-only -- see
// 20260929110001_clubhouse_invites_and_promo_codes.sql's "promo_codes:
// team members select" / "promo_codes: coach/operator write" policies).
// Reads promo_codes filtered by BOTH code and team_id -- a code only
// ever redeems for a player on the same team it was generated for.
export async function redeemPromoCodeServerSide({
  code,
  teamId,
  playerId,
}: {
  code: string;
  teamId: string;
  playerId: string;
}): Promise<RedeemPromoCodeResult> {
  try {
    const supabase = createServiceRoleClient();

    const { data: promo, error: selectError } = await supabase
      .from("promo_codes")
      .select("id")
      .eq("code", code)
      .eq("team_id", teamId)
      .is("redeemed_at", null)
      .maybeSingle();
    if (selectError) {
      console.error("[redeemPromoCodeServerSide] select failed", { code, teamId, error: selectError });
      return { ok: false, error: GENERIC_ERROR };
    }
    if (!promo) return { ok: false, error: GENERIC_ERROR };

    // redeemed_at is null in the WHERE, not just the earlier select, so
    // this is atomically single-use even under a race (two players
    // entering the same code at once) -- the loser updates 0 rows.
    const { data: claimed, error: updateError } = await supabase
      .from("promo_codes")
      .update({ redeemed_by_player_id: playerId, redeemed_at: new Date().toISOString() })
      .eq("id", promo.id)
      .is("redeemed_at", null)
      .select("id")
      .maybeSingle();
    if (updateError) {
      console.error("[redeemPromoCodeServerSide] promo_codes update failed", { promoId: promo.id, playerId, error: updateError });
      return { ok: false, error: GENERIC_ERROR };
    }
    if (!claimed) return { ok: false, error: GENERIC_ERROR };

    const { error: unlockError } = await supabase.from("players").update({ clubhouse_unlocked: true }).eq("id", playerId).eq("team_id", teamId);
    if (unlockError) {
      console.error("[redeemPromoCodeServerSide] players.clubhouse_unlocked update failed", { playerId, teamId, error: unlockError });
      return { ok: false, error: GENERIC_ERROR };
    }

    return { ok: true };
  } catch (err) {
    // Catches anything the checks above can't -- e.g.
    // createServiceRoleClient() throwing synchronously on a missing env
    // var, or a thrown (not returned-as-error) Postgres/network failure.
    console.error("[redeemPromoCodeServerSide] unexpected error", { code, teamId, playerId, error: err });
    return { ok: false, error: GENERIC_ERROR };
  }
}
