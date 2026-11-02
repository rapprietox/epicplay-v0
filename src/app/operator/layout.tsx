import { getPresenceContext } from "@/lib/presence-context";
import { PresenceTracker } from "@/components/presence-tracker";

// Team activity batch: purely additive -- see src/app/coach/layout.tsx
// for the full reasoning. Never touches the operator screen itself.
export default async function OperatorLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getPresenceContext();
  return (
    <>
      {ctx && <PresenceTracker userId={ctx.userId} teamId={ctx.teamId} role={ctx.role} playerName={ctx.playerName} />}
      {children}
    </>
  );
}
