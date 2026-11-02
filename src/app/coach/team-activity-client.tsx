"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { presenceTopic, type PresenceEntry } from "@/lib/presence";

export interface RosterMember {
  userId: string;
  role: string;
  displayName: string;
  lastSeenAt: string | null;
}

const ROLE_LABEL: Record<string, string> = { coach: "Coach", operator: "Operator", player: "Player" };

function formatLastSeen(iso: string | null): string {
  if (!iso) return "Never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Team activity batch: listen-only -- this component never calls
// channel.track() itself. Every member (including the coach viewing
// this very card) already tracks their own presence once, from the
// shared PresenceTracker mounted in each section's layout.tsx; a second
// track() call here would just create a duplicate, possibly
// out-of-sync entry for the same session. {config: {private: true}}
// must match the tracker side exactly, or Realtime treats them as two
// different channels with two different authorization checks.
export function TeamActivityClient({ teamId, roster }: { teamId: string; roster: RosterMember[] }) {
  const [online, setOnline] = useState<Map<string, PresenceEntry>>(new Map());

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(presenceTopic(teamId), { config: { private: true } });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<PresenceEntry>();
        const next = new Map<string, PresenceEntry>();
        for (const presences of Object.values(state)) {
          for (const p of presences) next.set(p.userId, p);
        }
        setOnline(next);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [teamId]);

  const onlineIds = new Set(online.keys());
  const sortedRoster = [...roster].sort((a, b) => {
    const aOnline = onlineIds.has(a.userId);
    const bOnline = onlineIds.has(b.userId);
    if (aOnline !== bOnline) return aOnline ? -1 : 1;
    return (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? "");
  });

  return (
    <div className="mt-3 flex flex-col divide-y divide-border">
      {sortedRoster.length === 0 && <p className="py-2 text-sm text-foreground/40">No team members yet.</p>}
      {sortedRoster.map((member) => {
        const presence = online.get(member.userId);
        return (
          <div key={member.userId} className="flex items-center justify-between gap-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              {presence ? (
                <span className="h-2 w-2 shrink-0 rounded-full bg-accent-green" style={{ boxShadow: "0 0 6px 2px rgba(46, 204, 113, 0.6)" }} />
              ) : (
                <span className="h-2 w-2 shrink-0 rounded-full bg-foreground/20" />
              )}
              <span className="text-white">{member.displayName}</span>
              <span className="text-xs text-foreground/40">{ROLE_LABEL[member.role] ?? member.role}</span>
            </div>
            <span className="text-xs text-foreground/50">{presence ? presence.page : formatLastSeen(member.lastSeenAt)}</span>
          </div>
        );
      })}
    </div>
  );
}
