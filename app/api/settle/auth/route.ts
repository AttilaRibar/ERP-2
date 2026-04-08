import { type NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { settlementContracts } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { verifyPassword } from "@/server/actions/settlements";
import { createSettleSession } from "@/lib/auth/settle-session";
import { z } from "zod";

const LoginSchema = z.object({
  token: z.string().min(1).max(128),
  password: z.string().min(1).max(256),
});

/**
 * POST /api/settle/auth
 * Authenticates a subcontractor via access_token + password.
 * Sets a settle_session httpOnly cookie on success.
 *
 * SECURITY:
 * - Constant-time password comparison (scrypt + timingSafeEqual)
 * - Generic error message to prevent enumeration
 * - Rate limiting should be applied externally (e.g. Upstash)
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Érvénytelen kérés" },
      { status: 400 }
    );
  }

  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Érvénytelen adatok" },
      { status: 400 }
    );
  }

  const { token, password } = parsed.data;

  // Find contract by access token
  const [contract] = await db
    .select({
      id: settlementContracts.id,
      partnerId: settlementContracts.partnerId,
      passwordHash: settlementContracts.passwordHash,
      status: settlementContracts.status,
      accessToken: settlementContracts.accessToken,
    })
    .from(settlementContracts)
    .where(
      and(
        eq(settlementContracts.accessToken, token),
        eq(settlementContracts.status, "active")
      )
    )
    .limit(1);

  // Generic error — don't reveal whether the token exists
  if (!contract) {
    return NextResponse.json(
      { error: "Érvénytelen hozzáférés vagy jelszó" },
      { status: 401 }
    );
  }

  const isValid = await verifyPassword(contract.passwordHash, password);
  if (!isValid) {
    return NextResponse.json(
      { error: "Érvénytelen hozzáférés vagy jelszó" },
      { status: 401 }
    );
  }

  // Create session JWT
  const jwt = await createSettleSession(
    contract.id,
    contract.partnerId,
    contract.accessToken
  );

  const isSecure = process.env.NODE_ENV === "production";
  const cookieStore = await cookies();
  cookieStore.set("settle_session", jwt, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "strict",
    maxAge: 86400, // 24 hours
    path: "/settle",
  });

  return NextResponse.json({ success: true });
}
