import crypto from "crypto";

const CLIENT_ID = process.env.AWS_COGNITO_CLIENT_ID!;
const COGNITO_DOMAIN = process.env.AWS_COGNITO_DOMAIN!; // e.g. eu-central-1qdb7cuta3.auth.eu-central-1.amazoncognito.com
const APP_URL = process.env.NEXT_PUBLIC_APP_URL!;

export const REDIRECT_URI = `${APP_URL}/api/auth/callback`;
const SCOPE = "email openid phone";

/** Generates a cryptographically random PKCE code_verifier. */
export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** Derives the PKCE code_challenge (S256) from the verifier. */
export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

/** Builds the Cognito Hosted UI authorization URL for the PKCE flow. */
export function buildAuthorizationUrl(
  codeChallenge: string,
  state: string
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });
  return `https://${COGNITO_DOMAIN}/oauth2/authorize?${params.toString()}`;
}

interface TokenResponse {
  id_token: string;
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

/**
 * Exchanges the authorization code for tokens via Cognito's /oauth2/token endpoint.
 * Logs full details to the server console for debugging.
 */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string
): Promise<TokenResponse> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: codeVerifier,
  });

  const url = `https://${COGNITO_DOMAIN}/oauth2/token`;
  console.log("[cognito-oidc] Token exchange → POST", url);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const rawBody = await response.text();
  if (!response.ok) {
    console.error(
      "[cognito-oidc] Token exchange FAILED:",
      response.status,
      response.statusText,
      rawBody
    );
    throw new Error(`Token exchange failed (${response.status}): ${rawBody}`);
  }

  console.log("[cognito-oidc] Token exchange OK, status:", response.status);
  return JSON.parse(rawBody) as TokenResponse;
}

/**
 * Builds the Cognito Hosted UI logout URL.
 * The logoutUri must be registered as an "Allowed sign-out URL" in the Cognito app client.
 */
export function buildLogoutUrl(logoutUri: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    logout_uri: logoutUri,
  });
  return `https://${COGNITO_DOMAIN}/logout?${params.toString()}`;
}
