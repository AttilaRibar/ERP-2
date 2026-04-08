"use server";

/**
 * Server actions for the subcontractor settlement portal.
 *
 * SECURITY: Every action reads contractId from the settle_session JWT.
 * All database queries are scoped with WHERE contract_id = $contractId.
 * The subcontractor can NEVER access data from another contract.
 */

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
import { eq, and, sql, ne } from "drizzle-orm";
import { z } from "zod";
import { requireSettleSession } from "@/lib/auth/settle-session";
import type {
  SettleDashboardData,
  InvoiceEditorData,
  SettleBudgetItem,
  SettleSection,
  PreviousClaim,
  SettlementItemRow,
} from "@/types/settlements";

type ActionResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; error: string };

// ---- Dashboard Data ----

export async function getSettleDashboard(): Promise<ActionResult<SettleDashboardData>> {
  const session = await requireSettleSession();

  // Fetch contract — SCOPED to session.contractId only
  const [contract] = await db
    .select({
      label: settlementContracts.label,
      totalNetAmount: settlementContracts.totalNetAmount,
      status: settlementContracts.status,
      partnerName: partners.name,
      projectName: projects.name,
      budgetName: budgets.name,
    })
    .from(settlementContracts)
    .innerJoin(partners, eq(settlementContracts.partnerId, partners.id))
    .innerJoin(versions, eq(settlementContracts.versionId, versions.id))
    .innerJoin(budgets, eq(settlementContracts.budgetId, budgets.id))
    .innerJoin(projects, eq(budgets.projectId, projects.id))
    .where(
      and(
        eq(settlementContracts.id, session.contractId),
        eq(settlementContracts.partnerId, session.partnerId)
      )
    )
    .limit(1);

  if (!contract) return { success: false, error: "Nem található" };

  // Fetch invoices — SCOPED to this contract
  const invoiceRows = await db
    .select({
      id: settlementInvoices.id,
      invoiceNumber: settlementInvoices.invoiceNumber,
      label: settlementInvoices.label,
      maxAmount: settlementInvoices.maxAmount,
      status: settlementInvoices.status,
      claimedMaterialTotal: settlementInvoices.claimedMaterialTotal,
      claimedFeeTotal: settlementInvoices.claimedFeeTotal,
      submittedAt: settlementInvoices.submittedAt,
      reviewedAt: settlementInvoices.reviewedAt,
      reviewNote: settlementInvoices.reviewNote,
    })
    .from(settlementInvoices)
    .where(eq(settlementInvoices.contractId, session.contractId))
    .orderBy(settlementInvoices.invoiceNumber);

  return {
    success: true,
    data: {
      contract: {
        label: contract.label,
        totalNetAmount: Number(contract.totalNetAmount),
        partnerName: contract.partnerName,
        projectName: contract.projectName ?? "–",
        budgetName: contract.budgetName,
        status: contract.status as SettleDashboardData["contract"]["status"],
      },
      invoices: invoiceRows.map((inv) => ({
        ...inv,
        status: inv.status as InvoiceEditorData["invoice"]["status"],
      })),
    },
  };
}

// ---- Invoice Editor Data ----

export async function getInvoiceEditorData(
  invoiceId: number
): Promise<ActionResult<InvoiceEditorData>> {
  const session = await requireSettleSession();

  // Fetch invoice — SCOPED: must belong to this contract
  const [invoice] = await db
    .select()
    .from(settlementInvoices)
    .where(
      and(
        eq(settlementInvoices.id, invoiceId),
        eq(settlementInvoices.contractId, session.contractId)
      )
    )
    .limit(1);

  if (!invoice) return { success: false, error: "Részszámla nem található" };

  // Only open or rejected invoices can be edited
  if (invoice.status !== "open" && invoice.status !== "rejected") {
    return { success: false, error: "Ez a részszámla nem szerkeszthető" };
  }

  // Fetch contract info
  const [contract] = await db
    .select({
      label: settlementContracts.label,
      totalNetAmount: settlementContracts.totalNetAmount,
      versionId: settlementContracts.versionId,
      partnerName: partners.name,
      projectName: projects.name,
      budgetName: budgets.name,
    })
    .from(settlementContracts)
    .innerJoin(partners, eq(settlementContracts.partnerId, partners.id))
    .innerJoin(budgets, eq(settlementContracts.budgetId, budgets.id))
    .innerJoin(projects, eq(budgets.projectId, projects.id))
    .where(
      and(
        eq(settlementContracts.id, session.contractId),
        eq(settlementContracts.partnerId, session.partnerId)
      )
    )
    .limit(1);

  if (!contract) return { success: false, error: "Szerződés nem található" };

  // Fetch budget items for this version (reconstructed from version chain)
  const budgetItemsRaw = await reconstructVersionItems(contract.versionId);
  const sectionsRaw = await reconstructVersionSections(contract.versionId);

  // Filter out alternatives — only show main items
  const budgetItemsFiltered: SettleBudgetItem[] = budgetItemsRaw
    .filter((i) => !i.alternativeOfItemCode)
    .map((i) => ({
      itemCode: i.itemCode,
      sequenceNo: i.sequenceNo,
      itemNumber: i.itemNumber,
      name: i.name,
      quantity: Number(i.quantity),
      unit: i.unit,
      materialUnitPrice: Number(i.materialUnitPrice),
      feeUnitPrice: Number(i.feeUnitPrice),
      sectionCode: i.sectionCode,
    }));

  const sections: SettleSection[] = sectionsRaw.map((s) => ({
    sectionCode: s.sectionCode,
    parentSectionCode: s.parentSectionCode,
    name: s.name,
    sequenceNo: s.sequenceNo,
  }));

  // Fetch cumulative claims from previous APPROVED invoices
  const previousClaims = await getPreviousClaims(
    session.contractId,
    invoice.invoiceNumber
  );

  // Fetch current items for this invoice
  const currentItems = await db
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

  return {
    success: true,
    data: {
      contract: {
        label: contract.label,
        totalNetAmount: Number(contract.totalNetAmount),
        partnerName: contract.partnerName,
        projectName: contract.projectName ?? "–",
        budgetName: contract.budgetName,
      },
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        label: invoice.label,
        maxAmount: Number(invoice.maxAmount),
        status: invoice.status as InvoiceEditorData["invoice"]["status"],
      },
      budgetItems: budgetItemsFiltered,
      sections,
      previousClaims,
      currentItems: currentItems as SettlementItemRow[],
    },
  };
}

// ---- Save Settlement Items (draft) ----

const SaveItemsSchema = z.object({
  invoiceId: z.number().int().positive(),
  items: z.array(
    z.object({
      itemCode: z.string().uuid(),
      claimedMaterialAmount: z.number().min(0),
      claimedFeeAmount: z.number().min(0),
      note: z.string().max(500).default(""),
    })
  ),
});

export async function saveSettlementItems(
  input: z.infer<typeof SaveItemsSchema>
): Promise<ActionResult<undefined>> {
  const session = await requireSettleSession();

  const parsed = SaveItemsSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Érvénytelen adatok" };
  }

  // Verify invoice belongs to this contract and is editable
  const [invoice] = await db
    .select()
    .from(settlementInvoices)
    .where(
      and(
        eq(settlementInvoices.id, parsed.data.invoiceId),
        eq(settlementInvoices.contractId, session.contractId)
      )
    )
    .limit(1);

  if (!invoice) return { success: false, error: "Részszámla nem található" };
  if (invoice.status !== "open" && invoice.status !== "rejected") {
    return { success: false, error: "Ez a részszámla nem szerkeszthető" };
  }

  // Fetch contract to get version for validation
  const [contract] = await db
    .select({ versionId: settlementContracts.versionId })
    .from(settlementContracts)
    .where(eq(settlementContracts.id, session.contractId))
    .limit(1);

  if (!contract) return { success: false, error: "Szerződés nem található" };

  // Validate: all item codes must belong to the contracted version
  const versionItems = await reconstructVersionItems(contract.versionId);
  const validItemCodes = new Set(
    versionItems.filter((i) => !i.alternativeOfItemCode).map((i) => i.itemCode)
  );

  for (const item of parsed.data.items) {
    if (!validItemCodes.has(item.itemCode)) {
      return { success: false, error: `Érvénytelen tételkód: ${item.itemCode}` };
    }
  }

  // Validate: cumulative amounts don't exceed total per item (material and fee separately)
  const previousClaims = await getPreviousClaims(
    session.contractId,
    invoice.invoiceNumber
  );
  const prevMap = new Map(
    previousClaims.map((p) => [p.itemCode, { material: p.totalClaimedMaterial, fee: p.totalClaimedFee }])
  );

  for (const item of parsed.data.items) {
    const bi = versionItems.find((v) => v.itemCode === item.itemCode);
    if (!bi) continue;
    const totalMaterial = Number(bi.quantity) * Number(bi.materialUnitPrice);
    const totalFee = Number(bi.quantity) * Number(bi.feeUnitPrice);
    const prev = prevMap.get(item.itemCode) ?? { material: 0, fee: 0 };
    const remainingMaterial = totalMaterial - prev.material;
    const remainingFee = totalFee - prev.fee;
    if (item.claimedMaterialAmount > remainingMaterial + 0.01) {
      return {
        success: false,
        error: `A(z) "${item.itemCode}" tételnél az anyag elszámolás meghaladja a maradék összeget`,
      };
    }
    if (item.claimedFeeAmount > remainingFee + 0.01) {
      return {
        success: false,
        error: `A(z) "${item.itemCode}" tételnél a díj elszámolás meghaladja a maradék összeget`,
      };
    }
  }

  // Save items — upsert pattern
  await db.transaction(async (tx) => {
    // Delete existing items for this invoice
    await tx
      .delete(settlementItems)
      .where(eq(settlementItems.invoiceId, parsed.data.invoiceId));

    // Insert new items (only those with non-zero amounts)
    const toInsert = parsed.data.items.filter(
      (i) => i.claimedMaterialAmount > 0 || i.claimedFeeAmount > 0
    );
    if (toInsert.length > 0) {
      await tx.insert(settlementItems).values(
        toInsert.map((i) => ({
          invoiceId: parsed.data.invoiceId,
          itemCode: i.itemCode,
          claimedMaterialAmount: String(i.claimedMaterialAmount),
          claimedFeeAmount: String(i.claimedFeeAmount),
          note: i.note,
        }))
      );
    }

    // Update denormalized totals
    let materialTotal = 0;
    let feeTotal = 0;
    for (const si of toInsert) {
      materialTotal += si.claimedMaterialAmount;
      feeTotal += si.claimedFeeAmount;
    }

    await tx
      .update(settlementInvoices)
      .set({
        claimedMaterialTotal: String(materialTotal),
        claimedFeeTotal: String(feeTotal),
        updatedAt: new Date(),
      })
      .where(eq(settlementInvoices.id, parsed.data.invoiceId));
  });

  return { success: true, data: undefined };
}

// ---- Submit Invoice ----

export async function submitInvoice(
  invoiceId: number,
  note?: string
): Promise<ActionResult<undefined>> {
  const session = await requireSettleSession();

  // Verify ownership
  const [invoice] = await db
    .select()
    .from(settlementInvoices)
    .where(
      and(
        eq(settlementInvoices.id, invoiceId),
        eq(settlementInvoices.contractId, session.contractId)
      )
    )
    .limit(1);

  if (!invoice) return { success: false, error: "Részszámla nem található" };
  if (invoice.status !== "open" && invoice.status !== "rejected") {
    return { success: false, error: "Ez a részszámla nem küldhető be" };
  }

  // Verify max amount not exceeded
  const total =
    Number(invoice.claimedMaterialTotal) + Number(invoice.claimedFeeTotal);
  if (total > Number(invoice.maxAmount) + 0.01) {
    return {
      success: false,
      error: `Az elszámolt összeg (${total.toLocaleString("hu")} Ft) meghaladja a megengedett maximumot (${Number(invoice.maxAmount).toLocaleString("hu")} Ft)`,
    };
  }

  await db
    .update(settlementInvoices)
    .set({
      status: "submitted",
      submittedAt: new Date(),
      submittedNote: note ?? null,
      updatedAt: new Date(),
    })
    .where(eq(settlementInvoices.id, invoiceId));

  return { success: true, data: undefined };
}

// ---- Internal Helpers (not exported to client) ----

interface ReconstructedItemRaw {
  itemCode: string;
  sequenceNo: number;
  itemNumber: string;
  name: string;
  quantity: string;
  unit: string;
  materialUnitPrice: string;
  feeUnitPrice: string;
  sectionCode: string | null;
  alternativeOfItemCode: string | null;
}

async function reconstructVersionItems(
  versionId: number
): Promise<ReconstructedItemRaw[]> {
  const result = await db.execute(sql`
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id, 0 AS depth
      FROM versions WHERE id = ${versionId}
      UNION ALL
      SELECT v.id, v.parent_id, a.depth + 1
      FROM versions v JOIN ancestors a ON v.id = a.parent_id
    ),
    ranked_items AS (
      SELECT
        bi.item_code, bi.sequence_no, bi.item_number, bi.name,
        bi.quantity, bi.unit, bi.material_unit_price, bi.fee_unit_price,
        bi.section_code, bi.alternative_of_item_code, bi.is_deleted,
        ROW_NUMBER() OVER (PARTITION BY bi.item_code ORDER BY a.depth ASC) AS rn
      FROM budget_items bi JOIN ancestors a ON bi.version_id = a.id
    )
    SELECT item_code, sequence_no, item_number, name, quantity, unit,
           material_unit_price, fee_unit_price, section_code, alternative_of_item_code
    FROM ranked_items WHERE rn = 1 AND NOT is_deleted
    ORDER BY sequence_no
  `);

  const rows = result as unknown as Record<string, unknown>[];
  return rows.map((r) => ({
    itemCode: String(r.item_code),
    sequenceNo: Number(r.sequence_no),
    itemNumber: String(r.item_number),
    name: String(r.name),
    quantity: String(r.quantity),
    unit: String(r.unit),
    materialUnitPrice: String(r.material_unit_price),
    feeUnitPrice: String(r.fee_unit_price),
    sectionCode: r.section_code ? String(r.section_code) : null,
    alternativeOfItemCode: r.alternative_of_item_code ? String(r.alternative_of_item_code) : null,
  }));
}

interface ReconstructedSectionRaw {
  sectionCode: string;
  parentSectionCode: string | null;
  name: string;
  sequenceNo: number;
}

async function reconstructVersionSections(
  versionId: number
): Promise<ReconstructedSectionRaw[]> {
  const result = await db.execute(sql`
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id, 0 AS depth
      FROM versions WHERE id = ${versionId}
      UNION ALL
      SELECT v.id, v.parent_id, a.depth + 1
      FROM versions v JOIN ancestors a ON v.id = a.parent_id
    ),
    ranked_sections AS (
      SELECT
        bs.section_code, bs.parent_section_code, bs.name, bs.sequence_no,
        bs.is_deleted,
        ROW_NUMBER() OVER (PARTITION BY bs.section_code ORDER BY a.depth ASC) AS rn
      FROM budget_sections bs JOIN ancestors a ON bs.version_id = a.id
    )
    SELECT section_code, parent_section_code, name, sequence_no
    FROM ranked_sections WHERE rn = 1 AND NOT is_deleted
    ORDER BY sequence_no
  `);

  const rows = result as unknown as Record<string, unknown>[];
  return rows.map((r) => ({
    sectionCode: String(r.section_code),
    parentSectionCode: r.parent_section_code ? String(r.parent_section_code) : null,
    name: String(r.name),
    sequenceNo: Number(r.sequence_no),
  }));
}

async function getPreviousClaims(
  contractId: number,
  beforeInvoiceNumber: number
): Promise<PreviousClaim[]> {
  // Sum claimed amounts from all APPROVED invoices with a lower invoice_number
  const result = await db.execute(sql`
    SELECT si.item_code,
           SUM(si.claimed_material_amount) AS total_claimed_material,
           SUM(si.claimed_fee_amount) AS total_claimed_fee
    FROM settlement_items si
    JOIN settlement_invoices inv ON si.invoice_id = inv.id
    WHERE inv.contract_id = ${contractId}
      AND inv.invoice_number < ${beforeInvoiceNumber}
      AND inv.status = 'approved'
    GROUP BY si.item_code
  `);

  const rows = result as unknown as Record<string, unknown>[];
  return rows.map((r) => ({
    itemCode: String(r.item_code),
    totalClaimedMaterial: Number(r.total_claimed_material),
    totalClaimedFee: Number(r.total_claimed_fee),
  }));
}
