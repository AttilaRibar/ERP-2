import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";

export interface CognitoJwtPayload extends JWTPayload {
  sub: string;
  email?: string;
  name?: string;
  "cognito:groups"?: string[];
  "cognito:username": string;
}

/** Lazily-initialized JWKS set — cached across requests via module scope. */
let JWKS: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!JWKS) {
    const region = process.env.AWS_REGION!;
    const userPoolId = process.env.AWS_COGNITO_USER_POOL_ID!;
    const url = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`;
    JWKS = createRemoteJWKSet(new URL(url));
  }
  return JWKS;
}

/**
 * Verifies a Cognito-issued JWT (id_token) against the JWKS endpoint.
 * Returns the decoded payload or null if invalid/expired.
 */
export async function verifyJwt(
  token: string
): Promise<CognitoJwtPayload | null> {
  try {
    const region = process.env.AWS_REGION!;
    const userPoolId = process.env.AWS_COGNITO_USER_POOL_ID!;

    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`,
    });

    return payload as CognitoJwtPayload;
  } catch {
    return null;
  }
}

export interface AuthSession {
  user: CognitoJwtPayload;
  /** The raw, JWKS-verified id_token — safe to pass to downstream AWS services. */
  idToken: string;
}

/** Reads and verifies the id_token cookie. Returns the validated session or null. */
export async function getCurrentUser(): Promise<AuthSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("id_token")?.value;
  if (!token) return null;
  const payload = await verifyJwt(token);
  if (!payload) return null;
  return { user: payload, idToken: token };
}
