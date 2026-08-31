import { type NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * GET /api/auth/callback
 *
 * Supabase Auth PKCE callback. Magic links, invitations, password recovery and
 * third-party providers all redirect here with a `code`, which is exchanged
 * for a session; `@supabase/ssr` writes the session cookies as part of the
 * exchange.
 *
 * IMPORTANT: register `<app-origin>/api/auth/callback` under
 * Authentication → URL Configuration → Redirect URLs in the Supabase dashboard.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  // Supabase returned an error (expired link, cancelled consent, …)
  if (error) {
    console.error("[auth/callback] Supabase error:", error, errorDescription);
    return NextResponse.redirect(
      new URL(
        `/login?error=${encodeURIComponent(errorDescription ?? error)}`,
        request.url
      )
    );
  }

  if (!code) {
    console.error("[auth/callback] Missing authorization code");
    return NextResponse.redirect(new URL("/login?error=missing_code", request.url));
  }

  const supabase = await createSupabaseServerClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    console.error("[auth/callback] Code exchange failed:", exchangeError.message);
    return NextResponse.redirect(
      new URL("/login?error=code_exchange_failed", request.url)
    );
  }

  // Only allow relative redirect targets — never bounce to an external origin
  const redirectTo = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return NextResponse.redirect(new URL(redirectTo, request.url));
}
