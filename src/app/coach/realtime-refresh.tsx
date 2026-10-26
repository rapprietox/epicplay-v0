"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Refreshes the (server-rendered) dashboard whenever the operator logs a
// play. Debounced since a single at-bat can fire several rapid pitch
// inserts -- no need to re-render the whole page for each one.
//
// Dashboard staleness fix: originally only watched games/at_bats, so an
// already-open tab never picked up a roster rename, a stolen-base
// correction, or a lineup/substitution change -- those tables are now
// also in the supabase_realtime publication (see
// 20261026100001_realtime_additional_tables.sql), so subscribing to them
// here actually has something to listen for. stolen_bases/lineup/
// substitutions are already scoped to one game at a time server-side,
// but none of them carry team_id directly, so (unlike `games`) there's no
// cheap postgres_changes filter to narrow them to this team -- scheduling
// a refresh for any such change anywhere is the same cost as the existing
// unfiltered `at_bats` subscription already accepts.
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
      .on("postgres_changes", { event: "*", schema: "public", table: "stolen_bases" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `team_id=eq.${teamId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "lineup" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "substitutions" }, scheduleRefresh)
      .subscribe();

    return () => {
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(channel);
    };
  }, [teamId, router]);

  return null;
}
