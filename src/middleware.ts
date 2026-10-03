import { NextResponse, type NextRequest } from "next/server";
import { redirectWithCookies, updateSession } from "@/lib/supabase/middleware";

/** Paths reachable without a session. Everything else requires sign-in. */
const PUBLIC_PREFIXES = ["/login", "/auth", "/document", "/api/health"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export async function middleware(request: NextRequest) {
  // DEMO_MODE has no login: the app resolves a local demo admin server-side (see lib/auth/session).
  if (process.env.DEMO_MODE === "true") return NextResponse.next();

  const { response, user, configured } = await updateSession(request);
  const { pathname } = request.nextUrl;

  // Public routes (login, secure document links, health check) never need a session.
  if (isPublicPath(pathname)) return response;

  // Supabase not configured yet: let the pages render their own "setup required" state
  // instead of redirecting in a loop.
  if (!configured) return response;

  if (!user) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    if (pathname !== "/") loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
    return redirectWithCookies(loginUrl, response);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Run on everything except Next internals and static files.
     * (Stamp / letterhead are NOT served statically - they live outside /public.)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
