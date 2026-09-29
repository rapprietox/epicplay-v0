import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Clubhouse batch: an invite link (/invite/[token]) passes
// ?next=/invite/TOKEN through the OAuth redirectTo URL (Supabase
// preserves the query string through the round trip) so a freshly
// signed-in player lands back on the invite page instead of "/", which
// then runs the actual claim. Validated here authoritatively (not just
// trusting login/page.tsx's own client-side check) -- must be a single
// leading slash, never "//host/..." or an absolute URL, or this becomes
// an open redirect.
function safeNextPath(raw: string | null): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("://")) return "/";
  return raw;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/auth-code-error`);
}
