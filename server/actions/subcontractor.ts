"use server";

import { db } from "@/lib/db";
import { subcontractorBillings, versions, partners } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { resolveTokenPartner } from "./subcontractor-tokens";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ActionResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; error: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Validates the token server-side and returns the resolved partnerId.
 * Never accepts a client-supplied partnerId.
 */
async function requireTokenPartner(
  token: string
): Promise<{ partnerId: number } | null> {
  return resolveTokenPartner(token);
}

// ─── getMyVersions ────────────────────────────────────────────────────────────

/**
 * Returns all `contracted` versions assigned to the partner identified by token.
 */
export async function getMyVersions(token: string) {
  const resolved = await requireTokenPartner(token);
  if (!resolved) return [];

  return db
    .select()
    .from(versions)
    .where(
      and(
        eq(versions.partnerId, resolved.partnerId),
        eq(versions.versionType, "contracted")
      )
    )
    .orderBy(versions.id);
}

// ─── getMyBillings ────────────────────────────────────────────────────────────

/**
 * Returns all billings submitted by the partner identified by token.
 */
export async function getMyBillings(token: string) {
  const resolved = await requireTokenPartner(token);
  if (!resolved) return [];

  return db
    .select()
    .from(subcontractorBillings)
    .where(eq(subcontractorBillings.partnerId, resolved.partnerId))
    .orderBy(subcontractorBillings.id);
}

// ─── createBilling ────────────────────────────────────────────────────────────

const CreateBillingSchema = z.object({
  versionId: z.number().int().positive(),
  amount: z.number().positive("Az összeg nem lehet nulla vagy negatív"),
  description: z.string().min(1, "A leírás megadása kötelező"),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
});

export type CreateBillingData = z.infer<typeof CreateBillingSchema>;

/**
 * Creates a new draft billing for the partner identified by token.
 * Validates that the version belongs to this partner and has type 'contracted'.
 */
export async function createBilling(
  token: string,
  data: CreateBillingData
): Promise<ActionResult<typeof subcontractorBillings.$inferSelect>> {
  const resolved = await requireTokenPartner(token);
  if (!resolved) {
    return { success: false, error: "Érvénytelen vagy lejárt token" };
  }

  const parsed = CreateBillingSchema.safeParse(data);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Érvénytelen adatok",
    };
  }

  // Verify version ownership and type
  const versionRows = await db
    .select()
    .from(versions)
    .where(eq(versions.id, parsed.data.versionId))
    .limit(1);

  const version = versionRows[0];
  if (!version) {
    return { success: false, error: "A verzió nem található" };
  }
  if (version.partnerId !== resolved.partnerId) {
    return { success: false, error: "Ehhez a verzióhoz nincs hozzáférése" };
  }
  if (version.versionType !== "contracted") {
    return {
      success: false,
      error: "Csak leszerződött verziókhoz nyújtható be számla",
    };
  }

  const [created] = await db
    .insert(subcontractorBillings)
    .values({
      partnerId: resolved.partnerId,
      versionId: parsed.data.versionId,
      amount: String(parsed.data.amount),
      description: parsed.data.description,
      periodStart: parsed.data.periodStart ?? null,
      periodEnd: parsed.data.periodEnd ?? null,
      status: "draft",
    })
    .returning();

  return { success: true, data: created };
}

// ─── updateBilling ────────────────────────────────────────────────────────────

const UpdateBillingSchema = z.object({
  amount: z.number().positive().optional(),
  description: z.string().min(1).optional(),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
});

export type UpdateBillingData = z.infer<typeof UpdateBillingSchema>;

/**
 * Updates a draft billing. Only the owning partner may update their own billings.
 */
export async function updateBilling(
  token: string,
  billingId: number,
  data: UpdateBillingData
): Promise<ActionResult<typeof subcontractorBillings.$inferSelect>> {
  const resolved = await requireTokenPartner(token);
  if (!resolved) {
    return { success: false, error: "Érvénytelen vagy lejárt token" };
  }

  const parsed = UpdateBillingSchema.safeParse(data);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Érvénytelen adatok",
    };
  }

  // Fetch billing and verify ownership + draft status
  const existing = await db
    .select()
    .from(subcontractorBillings)
    .where(
      and(
        eq(subcontractorBillings.id, billingId),
        eq(subcontractorBillings.partnerId, resolved.partnerId)
      )
    )
    .limit(1);

  if (!existing[0]) {
    return { success: false, error: "A számla nem található" };
  }
  if (existing[0].status !== "draft") {
    return {
      success: false,
      error: "Csak vázlat státuszú számla szerkeszthető",
    };
  }

  const patch: Partial<typeof subcontractorBillings.$inferInsert> = {};
  if (parsed.data.amount !== undefined) patch.amount = String(parsed.data.amount);
  if (parsed.data.description !== undefined) patch.description = parsed.data.description;
  if (parsed.data.periodStart !== undefined) patch.periodStart = parsed.data.periodStart;
  if (parsed.data.periodEnd !== undefined) patch.periodEnd = parsed.data.periodEnd;

  const [updated] = await db
    .update(subcontractorBillings)
    .set(patch)
    .where(eq(subcontractorBillings.id, billingId))
    .returning();

  return { success: true, data: updated };
}

// ─── submitBilling ────────────────────────────────────────────────────────────

/**
 * Submits a draft billing for admin review.
 */
export async function submitBilling(
  token: string,
  billingId: number
): Promise<ActionResult<typeof subcontractorBillings.$inferSelect>> {
  const resolved = await requireTokenPartner(token);
  if (!resolved) {
    return { success: false, error: "Érvénytelen vagy lejárt token" };
  }

  const existing = await db
    .select()
    .from(subcontractorBillings)
    .where(
      and(
        eq(subcontractorBillings.id, billingId),
        eq(subcontractorBillings.partnerId, resolved.partnerId)
      )
    )
    .limit(1);

  if (!existing[0]) {
    return { success: false, error: "A számla nem található" };
  }
  if (existing[0].status !== "draft") {
    return {
      success: false,
      error: "Csak vázlat státuszú számla nyújtható be",
    };
  }

  const [updated] = await db
    .update(subcontractorBillings)
    .set({ status: "submitted", submittedAt: new Date() })
    .where(eq(subcontractorBillings.id, billingId))
    .returning();

  return { success: true, data: updated };
}

// ─── getMyPartner ─────────────────────────────────────────────────────────────

/**
 * Returns the partner record for the token's owner.
 */
export async function getMyPartner(token: string) {
  const resolved = await requireTokenPartner(token);
  if (!resolved) return null;

  const rows = await db
    .select()
    .from(partners)
    .where(eq(partners.id, resolved.partnerId))
    .limit(1);

  return rows[0] ?? null;
}
