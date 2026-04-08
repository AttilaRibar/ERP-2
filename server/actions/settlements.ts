"use server";

import { db } from "@/lib/db";
import {
  settlementContracts,
  settlementInvoices,
  settlementItems,
  partners,
  versions,
  budgets,
  projects,
} from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/permissions";
import { randomBytes, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";
import type {
  SettlementContractRow,
  SettlementInvoiceRow,
  SettlementItemRow,
} from "@/types/settlements";

const scryptAsync = promisify(scrypt);

// ---- Helpers ----

type ActionResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; error: string };

function generateAccessToken(): string {
  return randomBytes(32).toString("hex"); // 64 hex chars = 256 bit
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${buf.toString("hex")}`;
}

export async function verifyPassword(
  storedHash: string,
  password: string
): Promise<boolean> {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  const storedBuf = Buffer.from(hash, "hex");
  return timingSafeEqual(buf, storedBuf);
}

// ---- List Contracts ----

export async function listSettlementContracts(): Promise<SettlementContractRow[]> {
  await requirePermission("settlements:read");

  const rows = await db
    .select({
      id: settlementContracts.id,
      budgetId: settlementContracts.budgetId,
      versionId: settlementContracts.versionId,
      partnerId: settlementContracts.partnerId,
      accessToken: settlementContracts.accessToken,
      totalNetAmount: settlementContracts.totalNetAmount,
      label: settlementContracts.label,
      status: settlementContracts.status,
      createdBy: settlementContracts.createdBy,
      createdAt: settlementContracts.createdAt,
      updatedAt: settlementContracts.updatedAt,
      partnerName: partners.name,
      versionName: versions.versionName,
      budgetName: budgets.name,
      projectName: projects.name,
    })
    .from(settlementContracts)
    .leftJoin(partners, eq(settlementContracts.partnerId, partners.id))
    .leftJoin(versions, eq(settlementContracts.versionId, versions.id))
    .leftJoin(budgets, eq(settlementContracts.budgetId, budgets.id))
    .leftJoin(projects, eq(budgets.projectId, projects.id))
    .orderBy(settlementContracts.id);

  return rows.map((r) => ({
    ...r,
    status: r.status as SettlementContractRow["status"],
    partnerName: r.partnerName ?? "–",
    versionName: r.versionName ?? "–",
    budgetName: r.budgetName ?? "–",
    projectName: r.projectName ?? "–",
  }));
}

// ---- Get Single Contract ----

export async function getSettlementContract(
  contractId: number
): Promise<ActionResult<SettlementContractRow>> {
  await requirePermission("settlements:read");

  const rows = await db
    .select({
      id: settlementContracts.id,
      budgetId: settlementContracts.budgetId,
      versionId: settlementContracts.versionId,
      partnerId: settlementContracts.partnerId,
      accessToken: settlementContracts.accessToken,
      totalNetAmount: settlementContracts.totalNetAmount,
      label: settlementContracts.label,
      status: settlementContracts.status,
      createdBy: settlementContracts.createdBy,
      createdAt: settlementContracts.createdAt,
      updatedAt: settlementContracts.updatedAt,
      partnerName: partners.name,
      versionName: versions.versionName,
      budgetName: budgets.name,
      projectName: projects.name,
    })
    .from(settlementContracts)
    .leftJoin(partners, eq(settlementContracts.partnerId, partners.id))
    .leftJoin(versions, eq(settlementContracts.versionId, versions.id))
    .leftJoin(budgets, eq(settlementContracts.budgetId, budgets.id))
    .leftJoin(projects, eq(budgets.projectId, projects.id))
    .where(eq(settlementContracts.id, contractId))
    .limit(1);

  if (rows.length === 0) return { success: false, error: "Nem található" };

  const r = rows[0];
  return {
    success: true,
    data: {
      ...r,
      status: r.status as SettlementContractRow["status"],
      partnerName: r.partnerName ?? "–",
      versionName: r.versionName ?? "–",
      budgetName: r.budgetName ?? "–",
      projectName: r.projectName ?? "–",
    },
  };
}

// ---- Create Contract ----

const CreateContractSchema = z.object({
  budgetId: z.number().int().positive(),
  versionId: z.number().int().positive(),
  partnerId: z.number().int().positive(),
  password: z.string().min(6, "A jelszónak legalább 6 karakter hosszúnak kell lennie"),
  totalNetAmount: z.number().min(0),
  label: z.string().min(1, "A megnevezés kötelező"),
  invoices: z
    .array(
      z.object({
        invoiceNumber: z.number().int().positive(),
        label: z.string().min(1),
        maxAmount: z.number().min(0),
      })
    )
    .min(1, "Legalább egy részszámlát meg kell adni"),
});

export async function createSettlementContract(
  input: z.infer<typeof CreateContractSchema>
): Promise<ActionResult<{ contractId: number; accessToken: string }>> {
  await requirePermission("settlements:write");

  const parsed = CreateContractSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Érvénytelen adatok" };
  }

  const { budgetId, versionId, partnerId, password, totalNetAmount, label, invoices } = parsed.data;

  const accessToken = generateAccessToken();
  const passwordHash = await hashPassword(password);

  return await db.transaction(async (tx) => {
    const [contract] = await tx
      .insert(settlementContracts)
      .values({
        budgetId,
        versionId,
        partnerId,
        accessToken,
        passwordHash,
        totalNetAmount: String(totalNetAmount),
        label,
        status: "active",
      })
      .returning({ id: settlementContracts.id });

    // Create all invoices in order
    for (const inv of invoices) {
      await tx.insert(settlementInvoices).values({
        contractId: contract.id,
        invoiceNumber: inv.invoiceNumber,
        label: inv.label,
        maxAmount: String(inv.maxAmount),
        status: "locked",
      });
    }

    return {
      success: true as const,
      data: { contractId: contract.id, accessToken },
    };
  });
}

// ---- Get Invoices for Contract ----

export async function getContractInvoices(
  contractId: number
): Promise<SettlementInvoiceRow[]> {
  await requirePermission("settlements:read");

  const rows = await db
    .select()
    .from(settlementInvoices)
    .where(eq(settlementInvoices.contractId, contractId))
    .orderBy(settlementInvoices.invoiceNumber);

  return rows as SettlementInvoiceRow[];
}

// ---- Open Invoice (admin unlocks it for subcontractor) ----

export async function openInvoice(
  invoiceId: number
): Promise<ActionResult<undefined>> {
  await requirePermission("settlements:write");

  const [inv] = await db
    .select()
    .from(settlementInvoices)
    .where(eq(settlementInvoices.id, invoiceId))
    .limit(1);

  if (!inv) return { success: false, error: "Részszámla nem található" };
  if (inv.status !== "locked") {
    return { success: false, error: "Csak zárt részszámla nyitható meg" };
  }

  // Ensure previous invoices are approved (sequential enforcement)
  if (inv.invoiceNumber > 1) {
    const prevInvoices = await db
      .select()
      .from(settlementInvoices)
      .where(
        and(
          eq(settlementInvoices.contractId, inv.contractId),
          sql`${settlementInvoices.invoiceNumber} < ${inv.invoiceNumber}`
        )
      );

    const allPrevApproved = prevInvoices.every((p) => p.status === "approved");
    if (!allPrevApproved) {
      return {
        success: false,
        error: "Az előző részszámláknak jóváhagyottnak kell lenniük",
      };
    }
  }

  await db
    .update(settlementInvoices)
    .set({ status: "open", updatedAt: new Date() })
    .where(eq(settlementInvoices.id, invoiceId));

  return { success: true, data: undefined };
}

// ---- Approve Invoice ----

export async function approveInvoice(
  invoiceId: number,
  note?: string
): Promise<ActionResult<undefined>> {
  await requirePermission("settlements:write");

  const [inv] = await db
    .select()
    .from(settlementInvoices)
    .where(eq(settlementInvoices.id, invoiceId))
    .limit(1);

  if (!inv) return { success: false, error: "Részszámla nem található" };
  if (inv.status !== "submitted") {
    return { success: false, error: "Csak beküldött részszámla hagyható jóvá" };
  }

  await db
    .update(settlementInvoices)
    .set({
      status: "approved",
      reviewedAt: new Date(),
      reviewNote: note ?? null,
      updatedAt: new Date(),
    })
    .where(eq(settlementInvoices.id, invoiceId));

  return { success: true, data: undefined };
}

// ---- Reject Invoice ----

const RejectSchema = z.object({
  invoiceId: z.number().int().positive(),
  note: z.string().min(1, "Az elutasítás indoklása kötelező"),
});

export async function rejectInvoice(
  invoiceId: number,
  note: string
): Promise<ActionResult<undefined>> {
  await requirePermission("settlements:write");

  const parsed = RejectSchema.safeParse({ invoiceId, note });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Érvénytelen adatok" };
  }

  const [inv] = await db
    .select()
    .from(settlementInvoices)
    .where(eq(settlementInvoices.id, invoiceId))
    .limit(1);

  if (!inv) return { success: false, error: "Részszámla nem található" };
  if (inv.status !== "submitted") {
    return { success: false, error: "Csak beküldött részszámla utasítható el" };
  }

  await db
    .update(settlementInvoices)
    .set({
      status: "rejected",
      reviewedAt: new Date(),
      reviewNote: parsed.data.note,
      updatedAt: new Date(),
    })
    .where(eq(settlementInvoices.id, invoiceId));

  return { success: true, data: undefined };
}

// ---- Get Settlement Items for Admin Review ----

export async function getInvoiceSettlementItems(
  invoiceId: number
): Promise<SettlementItemRow[]> {
  await requirePermission("settlements:read");

  const rows = await db
    .select({
      id: settlementItems.id,
      invoiceId: settlementItems.invoiceId,
      itemCode: settlementItems.itemCode,
      claimedMaterialAmount: settlementItems.claimedMaterialAmount,
      claimedFeeAmount: settlementItems.claimedFeeAmount,
      note: settlementItems.note,
    })
    .from(settlementItems)
    .where(eq(settlementItems.invoiceId, invoiceId));

  return rows;
}

// ---- Update Contract Status ----

export async function updateContractStatus(
  contractId: number,
  status: "active" | "completed" | "cancelled"
): Promise<ActionResult<undefined>> {
  await requirePermission("settlements:write");

  await db
    .update(settlementContracts)
    .set({ status, updatedAt: new Date() })
    .where(eq(settlementContracts.id, contractId));

  return { success: true, data: undefined };
}

// ---- Change Password ----

export async function changeContractPassword(
  contractId: number,
  newPassword: string
): Promise<ActionResult<undefined>> {
  await requirePermission("settlements:write");

  if (newPassword.length < 6) {
    return { success: false, error: "A jelszónak legalább 6 karakter hosszúnak kell lennie" };
  }

  const passwordHash = await hashPassword(newPassword);
  await db
    .update(settlementContracts)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(settlementContracts.id, contractId));

  return { success: true, data: undefined };
}

// ---- List contracted versions for dropdown ----

export async function listContractedVersions(): Promise<
  Array<{ versionId: number; versionName: string; budgetId: number; budgetName: string; projectName: string }>
> {
  await requirePermission("settlements:read");

  const rows = await db
    .select({
      versionId: versions.id,
      versionName: versions.versionName,
      budgetId: budgets.id,
      budgetName: budgets.name,
      projectName: projects.name,
    })
    .from(versions)
    .innerJoin(budgets, eq(versions.budgetId, budgets.id))
    .innerJoin(projects, eq(budgets.projectId, projects.id))
    .where(eq(versions.versionType, "contracted"))
    .orderBy(projects.name, budgets.name, versions.versionName);

  return rows.map((r) => ({
    ...r,
    budgetName: r.budgetName ?? "–",
    projectName: r.projectName ?? "–",
  }));
}

// ---- List subcontractor partners for dropdown ----

export async function listSubcontractorPartners(): Promise<
  Array<{ id: number; name: string }>
> {
  await requirePermission("settlements:read");

  return db
    .select({ id: partners.id, name: partners.name })
    .from(partners)
    .where(eq(partners.partnerType, "subcontractor"))
    .orderBy(partners.name);
}
