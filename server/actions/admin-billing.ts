"use server";

import { db } from "@/lib/db";
import { subcontractorBillings, partners, versions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { listSubcontractorTokens } from "./subcontractor-tokens";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AdminActionResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; error: string };

export type BillingWithDetails = typeof subcontractorBillings.$inferSelect & {
  partnerName: string;
  versionName: string;
};

// ─── listAllBillings ─────────────────────────────────────────────────────────

/**
 * Lists all subcontractor billings with partner and version info.
 */
export async function listAllBillings(): Promise<BillingWithDetails[]> {
  const rows = await db
    .select({
      id: subcontractorBillings.id,
      partnerId: subcontractorBillings.partnerId,
      versionId: subcontractorBillings.versionId,
      billingNumber: subcontractorBillings.billingNumber,
      amount: subcontractorBillings.amount,
      description: subcontractorBillings.description,
      status: subcontractorBillings.status,
      periodStart: subcontractorBillings.periodStart,
      periodEnd: subcontractorBillings.periodEnd,
      submittedAt: subcontractorBillings.submittedAt,
      reviewedAt: subcontractorBillings.reviewedAt,
      reviewerNotes: subcontractorBillings.reviewerNotes,
      createdAt: subcontractorBillings.createdAt,
      partnerName: partners.name,
      versionName: versions.versionName,
    })
    .from(subcontractorBillings)
    .leftJoin(partners, eq(subcontractorBillings.partnerId, partners.id))
    .leftJoin(versions, eq(subcontractorBillings.versionId, versions.id))
    .orderBy(subcontractorBillings.id);

  return rows.map((r) => ({
    ...r,
    partnerName: r.partnerName ?? "–",
    versionName: r.versionName ?? "–",
  }));
}

// ─── approveBilling ───────────────────────────────────────────────────────────

const ReviewSchema = z.object({
  billingId: z.number().int().positive(),
  notes: z.string().optional(),
});

/**
 * Approves a submitted billing.
 */
export async function approveBilling(
  billingId: number,
  notes?: string
): Promise<AdminActionResult<typeof subcontractorBillings.$inferSelect>> {
  const parsed = ReviewSchema.safeParse({ billingId, notes });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Érvénytelen adatok",
    };
  }

  const [updated] = await db
    .update(subcontractorBillings)
    .set({
      status: "approved",
      reviewedAt: new Date(),
      reviewerNotes: notes ?? null,
    })
    .where(eq(subcontractorBillings.id, parsed.data.billingId))
    .returning();

  if (!updated) {
    return { success: false, error: "A számla nem található" };
  }

  return { success: true, data: updated };
}

// ─── rejectBilling ────────────────────────────────────────────────────────────

const RejectSchema = z.object({
  billingId: z.number().int().positive(),
  notes: z.string().min(1, "Az elutasítás indoklása kötelező"),
});

/**
 * Rejects a submitted billing with a mandatory note.
 */
export async function rejectBilling(
  billingId: number,
  notes: string
): Promise<AdminActionResult<typeof subcontractorBillings.$inferSelect>> {
  const parsed = RejectSchema.safeParse({ billingId, notes });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Érvénytelen adatok",
    };
  }

  const [updated] = await db
    .update(subcontractorBillings)
    .set({
      status: "rejected",
      reviewedAt: new Date(),
      reviewerNotes: parsed.data.notes,
    })
    .where(eq(subcontractorBillings.id, parsed.data.billingId))
    .returning();

  if (!updated) {
    return { success: false, error: "A számla nem található" };
  }

  return { success: true, data: updated };
}

// ─── listPartnerTokens ────────────────────────────────────────────────────────

/**
 * Lists all access tokens for a given partner (admin view).
 * Delegates to listSubcontractorTokens from subcontractor-tokens.ts.
 */
export { listSubcontractorTokens as listPartnerTokens };
