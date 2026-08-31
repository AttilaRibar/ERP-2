import { type NextRequest, NextResponse } from "next/server";
import { userFromClaims } from "@/lib/auth/session";
import { verifySettleSession } from "@/lib/auth/settle-session";
import {
  clearSupabaseCookies,
  createSupabaseProxyClient,
} from "@/lib/supabase/proxy-client";

/** Paths that don't require authentication */
const PUBLIC_PATHS = ["/login", "/api/auth/", "/api/settle/auth"];

/** Subcontractor portal paths — use settle_session JWT (not Supabase Auth) */
const SETTLE_PATH_PREFIX = "/settle";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths through
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    // Redirect already-authenticated users away from login page (GET only)
    if (request.method === "GET" && pathname === "/login") {
      const { supabase, applyAuthCookies } = createSupabaseProxyClient(request);
      const { data } = await supabase.auth.getClaims();
      if (data?.claims?.sub) {
        return applyAuthCookies(NextResponse.redirect(new URL("/", request.url)));
      }
      return applyAuthCookies(NextResponse.next());
    }
    return NextResponse.next();
  }

  // ── Subcontractor settle portal ──
  if (pathname.startsWith(SETTLE_PATH_PREFIX)) {
    // The /settle/[token] login page is public (no session needed)
    // But /settle/[token]/dashboard and /settle/[token]/invoice/* require session
    const segments = pathname.split("/").filter(Boolean); // ["settle", token, ...]
    if (segments.length <= 2) {
      // /settle/[token] — login page, public
      return NextResponse.next();
    }

    // Deeper paths require settle_session cookie
    const jwt = request.cookies.get("settle_session")?.value;
    if (!jwt) {
      // Redirect to the token login page
      const tokenSegment = segments[1];
      return NextResponse.redirect(new URL(`/settle/${tokenSegment}`, request.url));
    }

    const payload = await verifySettleSession(jwt);
    if (!payload) {
      const tokenSegment = segments[1];
      const response = NextResponse.redirect(new URL(`/settle/${tokenSegment}`, request.url));
      response.cookies.delete("settle_session");
      return response;
    }

    // Forward settle context via headers (for server components)
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-settle-contract-id", String(payload.contractId));
    requestHeaders.set("x-settle-partner-id", String(payload.partnerId));

    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // ── Supabase Auth session ──
  // `getClaims()` verifies the access token (locally against the project JWKS
  // when asymmetric signing keys are used) and refreshes it when it is close
  // to expiring. Refreshed cookies are written onto the response below.
  const { supabase, applyAuthCookies, hasRefreshedCookies } =
    createSupabaseProxyClient(request);
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (error || !claims?.sub) {
    // No session, or it is invalid/expired — clear cookies and redirect
    const response = NextResponse.redirect(new URL("/login", request.url));
    clearSupabaseCookies(request, response);
    return response;
  }

  const user = userFromClaims(claims);

  // Forward user context to Server Components and Server Actions via headers
  const requestHeaders = new Headers(request.headers);
  if (hasRefreshedCookies()) {
    // Pass the refreshed tokens downstream instead of the stale ones
    requestHeaders.set("cookie", request.cookies.toString());
  }
  requestHeaders.set("x-user-id", user.id);
  requestHeaders.set("x-user-email", user.email);
  requestHeaders.set("x-user-roles", JSON.stringify(user.roles));
  requestHeaders.set("x-user-name", user.name);
  requestHeaders.set("x-user-display-name", user.name || user.email);

  return applyAuthCookies(
    NextResponse.next({ request: { headers: requestHeaders } })
  );
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static (Next.js static assets)
     * - _next/image (image optimization)
     * - favicon.ico
     * - public folder files
     */
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
