"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={signOut}
      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground/70 transition hover:border-accent-primary hover:text-white"
    >
      Sign out
    </button>
  );
}
