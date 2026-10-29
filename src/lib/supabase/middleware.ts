import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/supabase/types";

const ROLE_HOME: Record<string, string> = {
  operator: "/operator",
  player: "/player",
  coach: "/coach",
};

// Sections a role may reach beyond its own home. For V0, a coach can also
// open /operator to run live game logging themselves -- many small teams
// don't have a separate operator, and this doubles as a way to test the
// operator screen without a second Google account.
const EXTRA_ALLOWED_SECTIONS: Record<string, string[]> = {
  coach: ["/operator"],
};

// Clubhouse batch: "/invite" added -- an anonymous visitor must be able
// to reach it at all, and right after Google sign-in the player's own
// profiles.team_id is still null until the invite page's claimInvite()
// call finishes, so without this the role-redirect block below would
// bounce them to /pending before the claim ever runs.
const PUBLIC_PATHS = ["/login", "/auth/callback", "/auth/auth-code-error", "/invite"];

// Marketing-homepage fix: "/" is public too (src/app/page.tsx renders the
// full marketing site -- a native React/Three.js/GSAP build at
// src/app/_marketing -- for anonymous visitors, and redirects signed-in
// users to their own dashboard itself, see that file). Earlier versions
// of this routed through a static public/marketing.html file read via
// fs.readFileSync + dangerouslySetInnerHTML, and before that a
// middleware NextResponse.rewrite, neither of which is used any more.
// Deliberately NOT folded into PUBLIC_PATHS above: every one of those is
// matched with
// `pathname.startsWith(path)`, and "/" is a prefix of every path on the
// site -- adding it there would mark /coach, /operator, /player, etc. as
// public too and disable auth entirely. It's matched with a plain `===`
// instead, exactly because of that footgun.

export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip entirely for static files and API routes -- these should never
  // run the Supabase auth check or get caught by the role-routing
  // redirect below. This is what was actually breaking the marketing
  // page's hero/section videos: the config.matcher in src/middleware.ts
  // excludes a handful of image extensions but never listed .mp4, so a
  // video request for an anonymous visitor (no user, and the path isn't
  // in PUBLIC_PATHS) was hitting the "!user && !isPublicPath" branch
  // below and getting redirected to /login instead of ever reaching the
  // file. Also covers /api/* -- the Stripe webhook route has no
  // Supabase session either, so it had the same latent bug.
  if (pathname.startsWith("/_next/") || pathname.startsWith("/api/") || pathname.includes(".")) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicPath = pathname === "/" || PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // Role-based routing: once logged in, keep each role inside its own
  // section (/operator, /player, /coach) and bounce them out of the others.
  // "/" itself is a public path now (see above), so a signed-in user
  // landing on "/" never reaches this block at all -- src/app/page.tsx
  // does that redirect itself (it needs to render the marketing page for
  // anonymous visitors anyway, so it already has to call getUser()).
  if (user && !isPublicPath) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, team_id")
      .eq("id", user.id)
      .single();

    const home = profile?.team_id ? ROLE_HOME[profile.role ?? ""] : undefined;
    const allowedSections = home ? [home, ...(EXTRA_ALLOWED_SECTIONS[profile?.role ?? ""] ?? [])] : [];
    const inAllowedSection = allowedSections.some((h) => pathname.startsWith(h));
    const isRoleSection = Object.values(ROLE_HOME).some((h) => pathname.startsWith(h));

    if (isRoleSection && !inAllowedSection) {
      const url = request.nextUrl.clone();
      url.pathname = home ?? "/pending";
      return NextResponse.redirect(url);
    }
  }

  return response;
}
