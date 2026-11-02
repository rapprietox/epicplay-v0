"use server";

import { createClient } from "@/lib/supabase/server";

// Team activity batch: a thin wrapper around the security-definer
// touch_last_seen() function (20261102130001_team_presence.sql) -- run
// under the caller's own session (not service-role; the function itself
// is what grants the narrow "update just my own last_seen_at" ability,
// so a plain authenticated client is all this needs). Called from
// presence-tracker.tsx at most once every 5 minutes.
export async function touchLastSeen(): Promise<void> {
  const supabase = createClient();
  await supabase.rpc("touch_last_seen");
}
