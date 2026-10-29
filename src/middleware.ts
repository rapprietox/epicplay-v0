import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // mp4/webm added for the marketing page's hero/section videos -- the
    // function-level check in updateSession() is the real fix (this is
    // just the efficiency complement: skip invoking middleware at all
    // for a static media file, not just skip its auth logic once invoked).
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4|webm)$).*)",
  ],
};
