import "server-only";
import type { createServiceRoleClient } from "@/lib/supabase/service-role";
import { FREE_PREVIEW_KAIROS_MESSAGES } from "@/lib/free-preview";

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

export interface FreePreviewCreditResult {
  allowed: boolean;
  remaining: number;
}

// Free preview batch: the same "service-role write, checked and consumed
// before the Anthropic call" shape as checkAndConsumeKairosCredit above,
// but against free_preview_kairos_used -- a flat, non-resetting lifetime
// cap (FREE_PREVIEW_KAIROS_MESSAGES) rather than a monthly budget. Only
// called for a locked player while isFreePreviewActive() is true (see
// askPlayerKairos in src/app/player/clubhouse/kairos-actions.ts); once
// the preview ends, this path stops being reachable regardless of how
// much of the 5 is left.
export async function checkAndConsumeFreePreviewKairosCredit(supabase: ServiceRoleClient, playerId: string): Promise<FreePreviewCreditResult> {
  const { data: player, error } = await supabase.from("players").select("free_preview_kairos_used").eq("id", playerId).single();
  if (error || !player) throw new Error("Player not found");

  const used = player.free_preview_kairos_used;
  if (used >= FREE_PREVIEW_KAIROS_MESSAGES) {
    return { allowed: false, remaining: 0 };
  }

  const nextUsed = used + 1;
  await supabase.from("players").update({ free_preview_kairos_used: nextUsed }).eq("id", playerId);
  return { allowed: true, remaining: FREE_PREVIEW_KAIROS_MESSAGES - nextUsed };
}
