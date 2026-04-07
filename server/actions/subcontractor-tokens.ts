"use server";

import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { subcontractorAccessTokens } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { validateSubcontractorToken } from "@/lib/auth/subcontractor";

// ─── Types ───────────────────────────────────────────────────────────────────

export type TokenResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; error: string };

// ─── Generate ────────────────────────────────────────────────────────────────

const GenerateSchema = z.object({
  partnerId: z.number().int().positive(),
  label: z.string().min(1, "A megnevezés kötelező"),
  expiresInDays: z.number().int().min(1).max(3650),
});

/**
 * Generates a cryptographically secure 64-char hex magic-link token,
 * stores it in the DB and returns the token + magic link URL.
 */
export async function generateSubcontractorToken(
  partnerId: number,
  label: string,
  expiresInDays: number
): Promise<TokenResult<{ tokenId: number; token: string; magicLink: string }>> {
  const parsed = GenerateSchema.safeParse({ partnerId, label, expiresInDays });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Érvénytelen adatok" };
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + parsed.data.expiresInDays);

  const [row] = await db
    .insert(subcontractorAccessTokens)
    .values({
      partnerId: parsed.data.partnerId,
      token,
      label: parsed.data.label,
      expiresAt,
      createdBy: "admin",
    })
    .returning();

  const magicLink = `${process.env.NEXT_PUBLIC_APP_URL}/subcontractor/${token}`;

  return {
    success: true,
    data: { tokenId: row.id, token, magicLink },
  };
}

// ─── Revoke ───────────────────────────────────────────────────────────────────

/**
 * Revokes a subcontractor access token by setting revoked_at = now().
 */
export async function revokeSubcontractorToken(
  tokenId: number
): Promise<TokenResult> {
  const [updated] = await db
    .update(subcontractorAccessTokens)
    .set({ revokedAt: new Date() })
    .where(eq(subcontractorAccessTokens.id, tokenId))
    .returning();

  if (!updated) {
    return { success: false, error: "Token nem található" };
  }

  return { success: true, data: undefined };
}

// ─── List ─────────────────────────────────────────────────────────────────────

export type SubcontractorTokenRow =
  typeof subcontractorAccessTokens.$inferSelect;

/**
 * Lists all tokens for a given partner (including revoked/expired).
 */
export async function listSubcontractorTokens(
  partnerId: number
): Promise<SubcontractorTokenRow[]> {
  return db
    .select()
    .from(subcontractorAccessTokens)
    .where(eq(subcontractorAccessTokens.partnerId, partnerId))
    .orderBy(subcontractorAccessTokens.createdAt);
}

// ─── Resolve ──────────────────────────────────────────────────────────────────

/**
 * Resolves the partner from a raw token string.
 * Validates the token is not expired/revoked and marks it as used.
 *
 * @returns `{ partnerId }` or `null` if invalid/expired/revoked
 */
export async function resolveTokenPartner(
  token: string
): Promise<{ partnerId: number } | null> {
  return validateSubcontractorToken(token);
}
