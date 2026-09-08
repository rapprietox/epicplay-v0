"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Refreshes the (server-rendered) dashboard whenever the operator logs a
// play. Debounced since a single at-bat can fire several rapid pitch
// inserts -- no need to re-render the whole page for each one.
export function RealtimeRefresh({ teamId }: { teamId: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();

    function scheduleRefresh() {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 1000);
    }

    const channel = supabase
      .channel(`team-${teamId}-live`)
      .on("postgres_changes", { event: "*", schema: "public", table: "games", filter: `team_id=eq.${teamId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "at_bats" }, scheduleRefresh)
      .subscribe();

    return () => {
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(channel);
    };
  }, [teamId, router]);

  return null;
}
