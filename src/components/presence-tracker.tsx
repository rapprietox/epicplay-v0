"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { presenceTopic, LAST_SEEN_UPDATE_INTERVAL_MS } from "@/lib/presence";
import { touchLastSeen } from "@/lib/presence-actions";

const LAST_SEEN_STORAGE_KEY = (userId: string) => `presence_last_seen_touch_${userId}`;

// Team activity batch: mounted once per signed-in section layout
// (coach/operator/player -- see each directory's layout.tsx), not on
// /login or /pending, which have no user or no team to join a
// per-team channel with. Renders nothing -- pure side effect.
//
// {config: {private: true}} is what makes Realtime actually consult the
// RLS policies on realtime.messages (20261102130001_team_presence.sql)
// for this channel, rather than treating it as an ordinary public
// channel anyone with a valid session could listen to regardless of
// role. Every member (coach, operator, player) tracks their own
// presence here; only the coach-only team-activity-client.tsx ever
// attaches a listener to read it back.
export function PresenceTracker({
  userId,
  teamId,
  role,
  playerName,
}: {
  userId: string;
  teamId: string;
  role: string;
  playerName: string | null;
}) {
  const pathname = usePathname();
  const lastSeenTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(presenceTopic(teamId), { config: { private: true } });

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        channel.track({ userId, role, playerName, page: pathname });
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
    // Re-joins on path change so the tracked "page" stays current --
    // channel.track() alone (without resubscribing) would also work, but
    // a fresh subscribe keeps this effect's cleanup/dependency shape
    // simple and the channel is cheap to re-create.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, userId, role, playerName, pathname]);

  useEffect(() => {
    function maybeTouch() {
      try {
        const key = LAST_SEEN_STORAGE_KEY(userId);
        const last = Number(window.localStorage.getItem(key) ?? "0");
        if (Date.now() - last < LAST_SEEN_UPDATE_INTERVAL_MS) return;
        window.localStorage.setItem(key, String(Date.now()));
      } catch {
        // Private browsing / storage disabled -- fall through and touch
        // anyway rather than silently never updating last_seen_at.
      }
      void touchLastSeen();
    }

    maybeTouch();
    lastSeenTimerRef.current = setInterval(maybeTouch, LAST_SEEN_UPDATE_INTERVAL_MS);
    return () => {
      if (lastSeenTimerRef.current) clearInterval(lastSeenTimerRef.current);
    };
  }, [userId]);

  return null;
}
