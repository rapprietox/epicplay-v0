import type { Metadata } from "next";
import { LiveView } from "./live-view";

export const dynamic = "force-dynamic";

// Public, no-login page -- never indexed. The page itself never talks
// to Supabase at all (no server-side fetch here); all data comes from
// the client polling /api/live/[token], which is the one place the
// token-scoping and field allowlist are enforced.
export const metadata: Metadata = {
  title: "Live Game | EpicPlay AI",
  robots: { index: false, follow: false },
};

export default function LiveGamePage({ params }: { params: { token: string } }) {
  return <LiveView token={params.token} />;
}
