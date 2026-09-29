import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type RedeemPromoCodeResult = { ok: true } | { ok: false; error: string };

// Service-role, same reasoning as claimInvite (src/lib/invites.ts): both
// promo_codes and players writes here are outside a plain player
// session's RLS scope (promo_codes write is coach/operator-only;
// players write is coach/operator-only).
export async function redeemPromoCodeServerSide({
  code,
  teamId,
  playerId,
}: {
  code: string;
  teamId: string;
  playerId: string;
}): Promise<RedeemPromoCodeResult> {
  const supabase = createServiceRoleClient();

  const { data: promo } = await supabase
    .from("promo_codes")
    .select("id")
    .eq("code", code)
    .eq("team_id", teamId)
    .is("redeemed_at", null)
    .maybeSingle();
  if (!promo) return { ok: false, error: "Invalid or already-used code" };

  // redeemed_at is null in the WHERE, not just the earlier select, so
  // this is atomically single-use even under a race (two players
  // entering the same code at once) -- the loser updates 0 rows.
  const { data: claimed } = await supabase
    .from("promo_codes")
    .update({ redeemed_by_player_id: playerId, redeemed_at: new Date().toISOString() })
    .eq("id", promo.id)
    .is("redeemed_at", null)
    .select("id")
    .maybeSingle();
  if (!claimed) return { ok: false, error: "Code was just used by someone else" };

  const { error } = await supabase.from("players").update({ clubhouse_unlocked: true }).eq("id", playerId).eq("team_id", teamId);
  if (error) return { ok: false, error: error.message };

  return { ok: true };
}
