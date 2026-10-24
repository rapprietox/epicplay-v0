"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Critical mobile fix: /player/clubhouse had no nav and no sign-out --
// a player on mobile had no way off this page at all. A small,
// dedicated bar rather than reusing SignOutButton's own styling (border
// + background pill), since this spec calls for small red text with no
// background -- a different visual treatment for a different context,
// not a change the shared component's other callers asked for.
export function ClubhouseNavBar() {
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <nav
      className="sticky top-0 z-50 flex min-h-[48px] items-center justify-between px-4"
      style={{ background: "#080E08", borderBottom: "1px solid #1A3D28" }}
    >
      <span className="font-heading text-sm font-bold text-accent-gold">⚾ EpicPlay AI</span>
      <button type="button" onClick={signOut} className="text-sm font-medium text-accent-red">
        Sign Out
      </button>
    </nav>
  );
}
