import "server-only";
import type { createServiceRoleClient } from "@/lib/supabase/service-role";

type ServiceRoleClient = ReturnType<typeof createServiceRoleClient>;

const MONTHLY_LIMIT = 20;

// "YYYY-MM-01" -- compared as a plain string against the stored
// kairos_messages_reset_date, both ISO date strings, so string
// comparison is equivalent to date comparison here.
function currentMonthStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

export interface KairosCreditResult {
  allowed: boolean;
  remaining: number;
  resetDate: string;
}

// Clubhouse Pro enhancement, Part 3: monthly message budget. Must run
// against a service-role client -- players write is coach/operator-only
// under this app's RLS (CLAUDE.md), so a player's own session can't
// update their own kairos_messages_used row directly, same reasoning as
// claimInvite/redeemPromoCodeServerSide. Checked (and, if exhausted,
// short-circuited) BEFORE the Anthropic call in askPlayerKairos, so a
// used-up player never costs an API call -- "no error, just friendly
// notice" per the request.
export async function checkAndConsumeKairosCredit(supabase: ServiceRoleClient, playerId: string): Promise<KairosCreditResult> {
  const { data: player, error } = await supabase
    .from("players")
    .select("kairos_messages_used, kairos_messages_reset_date")
    .eq("id", playerId)
    .single();
  if (error || !player) throw new Error("Player not found");

  const monthStart = currentMonthStart();
  let used = player.kairos_messages_used;
  let resetDate = player.kairos_messages_reset_date;
  if (resetDate < monthStart) {
    used = 0;
    resetDate = monthStart;
  }

  if (used >= MONTHLY_LIMIT) {
    if (resetDate !== player.kairos_messages_reset_date) {
      await supabase.from("players").update({ kairos_messages_used: 0, kairos_messages_reset_date: resetDate }).eq("id", playerId);
    }
    return { allowed: false, remaining: 0, resetDate };
  }

  const nextUsed = used + 1;
  await supabase.from("players").update({ kairos_messages_used: nextUsed, kairos_messages_reset_date: resetDate }).eq("id", playerId);
  return { allowed: true, remaining: MONTHLY_LIMIT - nextUsed, resetDate };
}
