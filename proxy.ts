import { type NextRequest, NextResponse } from "next/server";
import { verifyJwt } from "@/lib/auth/session";

/** Paths that don't require authentication */
const PUBLIC_PATHS = ["/login", "/api/auth/"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths through
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    // Redirect already-authenticated users away from login page (GET only)
    // POST requests are internal Next.js RSC/flight fetches — never redirect those
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
