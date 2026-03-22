import { type NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  buildAuthorizationUrl,
} from "@/lib/aws/cognito-oidc";

/**
 * GET /api/auth/login
 * Generates PKCE verifier + state, stores them in short-lived cookies,
 * then redirects the browser to the Cognito Hosted UI.
 */
export async function GET(request: NextRequest) {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = crypto.randomBytes(16).toString("base64url");

  console.log("[auth/login] Initiating OIDC PKCE flow, state:", state);

  const cookieStore = await cookies();
  const isSecure = process.env.NODE_ENV === "production";

  // Short-lived PKCE cookies (10 minutes)
  cookieStore.set("pkce_verifier", codeVerifier, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  cookieStore.set("oauth_state", state, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  const authUrl = buildAuthorizationUrl(codeChallenge, state);

  // Print the full URL and the expected callback URL so it's easy to verify
  // what needs to be registered in the Cognito app client settings.
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback`;
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("[auth/login] OIDC Authorization URL:");
  console.log(authUrl);
  console.log("[auth/login] redirect_uri (must be an Allowed Callback URL):");
  console.log(redirectUri);
  console.log("[auth/login] Cognito Domain:", process.env.AWS_COGNITO_DOMAIN);
  console.log("[auth/login] Client ID:     ", process.env.AWS_COGNITO_CLIENT_ID);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  return NextResponse.redirect(authUrl);
}
