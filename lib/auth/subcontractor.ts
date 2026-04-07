import { db } from "@/lib/db";
import { subcontractorAccessTokens } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";

/**
 * Validates a subcontractor access token from the DB.
 * - Checks the token exists
 * - Checks it has not been revoked
 * - Checks it has not expired
 * - Updates used_at timestamp on first use
 *
 * @returns `{ partnerId }` if valid, `null` otherwise
 */
export async function validateSubcontractorToken(
  token: string
): Promise<{ partnerId: number } | null> {
  const rows = await db
    .select()
    .from(subcontractorAccessTokens)
    .where(eq(subcontractorAccessTokens.token, token))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  // Revoked tokens are never valid
  if (row.revokedAt !== null) return null;

  // Expired tokens are never valid
  if (new Date(row.expiresAt) < new Date()) return null;

  // Update used_at on first use — conditional WHERE prevents duplicate updates
  if (row.usedAt === null) {
    await db
      .update(subcontractorAccessTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(subcontractorAccessTokens.id, row.id),
          isNull(subcontractorAccessTokens.usedAt)
        )
      );
  }

  return { partnerId: row.partnerId };
}
