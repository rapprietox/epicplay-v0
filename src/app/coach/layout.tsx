import { getPresenceContext } from "@/lib/presence-context";
import { PresenceTracker } from "@/components/presence-tracker";

// Team activity batch: purely additive -- renders the (invisible)
// presence tracker alongside whatever the actual /coach/* page renders,
// never replacing or gating it. Each page under this section keeps its
// own auth/redirect logic exactly as before; this layout never redirects.
export default async function CoachLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getPresenceContext();
  return (
    <>
      {ctx && <PresenceTracker userId={ctx.userId} teamId={ctx.teamId} role={ctx.role} playerName={ctx.playerName} />}
      {children}
    </>
  );
}
