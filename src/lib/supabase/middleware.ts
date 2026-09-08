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

const PUBLIC_PATHS = ["/login", "/auth/callback", "/auth/auth-code-error"];

export async function updateSession(request: NextRequest) {
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

  const { pathname } = request.nextUrl;
  const isPublicPath = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

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
  if (user && !isPublicPath) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, team_id")
      .eq("id", user.id)
      .single();

    if (pathname === "/") {
      const url = request.nextUrl.clone();
      url.pathname = profile?.team_id
        ? ROLE_HOME[profile.role ?? ""] ?? "/pending"
        : "/pending";
      return NextResponse.redirect(url);
    }

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
