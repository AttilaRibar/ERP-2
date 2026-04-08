import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";

const COOKIE_NAME = "settle_session";
const SETTLE_SECRET = new TextEncoder().encode(
  process.env.SETTLE_JWT_SECRET ?? "settle-default-secret-change-me-in-production"
);

export interface SettleSessionPayload extends JWTPayload {
  contractId: number;
  partnerId: number;
  token: string;
}

/** Create a signed JWT for the settle session. Expires in 24 hours. */
export async function createSettleSession(
  contractId: number,
  partnerId: number,
  token: string
): Promise<string> {
  return new SignJWT({ contractId, partnerId, token })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(SETTLE_SECRET);
}

/** Verify and decode the settle session JWT. Returns null if invalid. */
export async function verifySettleSession(
  jwt: string
): Promise<SettleSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(jwt, SETTLE_SECRET);
    return payload as SettleSessionPayload;
  } catch {
    return null;
  }
}

/** Read the settle_session cookie and return the verified payload. */
export async function getSettleSession(): Promise<SettleSessionPayload | null> {
  const cookieStore = await cookies();
  const jwt = cookieStore.get(COOKIE_NAME)?.value;
  if (!jwt) return null;
  return verifySettleSession(jwt);
}

/**
 * Require a valid settle session. Throws if not authenticated.
 * Returns the verified payload with contractId and partnerId.
 */
export async function requireSettleSession(): Promise<SettleSessionPayload> {
  const session = await getSettleSession();
  if (!session) {
    throw new Error("SETTLE_UNAUTHORIZED");
  }
  return session;
}
