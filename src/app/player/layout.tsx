import { getPresenceContext } from "@/lib/presence-context";
import { PresenceTracker } from "@/components/presence-tracker";

// Team activity batch: purely additive -- see src/app/coach/layout.tsx
// for the full reasoning. Covers /player, /player/clubhouse, and
// /player/clubhouse/games/[gameId] alike, with no change to any of them.
export default async function PlayerLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getPresenceContext();
  return (
    <>
      {ctx && <PresenceTracker userId={ctx.userId} teamId={ctx.teamId} role={ctx.role} playerName={ctx.playerName} />}
      {children}
    </>
  );
}
