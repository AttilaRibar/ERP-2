import { type NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCodeForTokens } from "@/lib/aws/cognito-oidc";

/**
 * GET /api/auth/callback
 * Handles the OAuth2 Authorization Code redirect from Cognito.
 * Exchanges the code for tokens and stores them in httpOnly cookies.
 *
 * IMPORTANT: Register `{APP_URL}/api/auth/callback` as an
 * "Allowed callback URL" in your Cognito App client settings.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  // Cognito returned an error
  if (error) {
    console.error("[auth/callback] Cognito error:", error, errorDescription);
    return NextResponse.redirect(
      new URL(
        `/login?error=${encodeURIComponent(errorDescription ?? error)}`,
        request.url
      )
    );
  }

  const cookieStore = await cookies();
  const codeVerifier = cookieStore.get("pkce_verifier")?.value;
  const savedState = cookieStore.get("oauth_state")?.value;

  console.log("[auth/callback] Received code:", !!code, "state match:", state === savedState);

  // CSRF state check
  if (!state || state !== savedState) {
    console.error("[auth/callback] State mismatch — possible CSRF attack");
    return NextResponse.redirect(
      new URL("/login?error=state_mismatch", request.url)
    );
  }

  if (!code || !codeVerifier) {
    console.error("[auth/callback] Missing authorization code or PKCE verifier");
    return NextResponse.redirect(
      new URL("/login?error=missing_code", request.url)
    );
  }

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code, codeVerifier);
  } catch (err) {
    console.error("[auth/callback] Token exchange error:", err);
    return NextResponse.redirect(
      new URL("/login?error=token_exchange_failed", request.url)
    );
  }

  const isSecure = process.env.NODE_ENV === "production";
  const maxAge = tokens.expires_in ?? 3600;

  cookieStore.set("id_token", tokens.id_token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    maxAge,
    path: "/",
  });
  cookieStore.set("access_token", tokens.access_token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    maxAge,
    path: "/",
  });
  if (tokens.refresh_token) {
    cookieStore.set("refresh_token", tokens.refresh_token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60,
      path: "/",
    });
  }

  // Clean up PKCE cookies
  cookieStore.delete("pkce_verifier");
  cookieStore.delete("oauth_state");

  console.log("[auth/callback] Login successful, redirecting to /");
  return NextResponse.redirect(new URL("/", request.url));
}
