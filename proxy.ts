import { type NextRequest, NextResponse } from "next/server";
import { verifyJwt } from "@/lib/auth/session";
import { verifySettleSession } from "@/lib/auth/settle-session";

/** Paths that don't require authentication */
const PUBLIC_PATHS = ["/login", "/api/auth/", "/api/settle/auth"];

/** Subcontractor portal paths — use settle_session JWT (not Cognito) */
const SETTLE_PATH_PREFIX = "/settle";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths through
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    // Redirect already-authenticated users away from login page (GET only)
    if (request.method === "GET" && pathname === "/login") {
      const token = request.cookies.get("id_token")?.value;
      if (token) {
        const payload = await verifyJwt(token);
        if (payload) {
          return NextResponse.redirect(new URL("/", request.url));
        }
      }
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

  // Validate the id_token cookie
  const token = request.cookies.get("id_token")?.value;

  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const payload = await verifyJwt(token);

  if (!payload) {
    // Token is invalid or expired — clear cookies and redirect to login
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete("id_token");
    response.cookies.delete("access_token");
    response.cookies.delete("refresh_token");
    return response;
  }

  // Forward user context to Server Components and Server Actions via headers
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-user-id", payload.sub);
  requestHeaders.set("x-user-email", payload.email ?? "");
  requestHeaders.set(
    "x-user-groups",
    JSON.stringify(payload["cognito:groups"] ?? [])
  );
  requestHeaders.set("x-user-name", payload["cognito:username"] ?? "");
  requestHeaders.set("x-user-display-name", payload.name ?? "");

  return NextResponse.next({ request: { headers: requestHeaders } });
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
