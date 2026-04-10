"use server";

import { db } from "@/lib/db";
import { budgetItems, versions, budgets, projects, partners } from "@/lib/db/schema";
import { eq, ilike, or, and } from "drizzle-orm";

export interface ItemSearchRow {
  id: number;
  itemCode: string;
  itemNumber: string;
  name: string;
  quantity: number;
  unit: string;
  materialUnitPrice: number;
  feeUnitPrice: number;
  versionId: number;
  versionName: string;
  versionType: string;
  budgetId: number;
  budgetName: string;
  projectId: number;
  projectCode: string | null;
  projectName: string;
  partnerName: string | null;
}

/**
 * Search budget items across all projects/budgets/versions.
 * Supports optional scoping filters (all optional).
 * Pre-filters with ILIKE; client-side handles fuzzy scoring.
 * Max 400 results returned to keep payload manageable.
 */
export async function searchBudgetItems(
  query: string,
  projectId?: number | null,
  budgetId?: number | null,
  versionId?: number | null,
): Promise<ItemSearchRow[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const pattern = `%${q}%`;

  const conditions = [
    or(
      ilike(budgetItems.itemNumber, pattern),
      ilike(budgetItems.name, pattern),
    )!,
    eq(budgetItems.isDeleted, false),
  ];

  if (versionId) {
    conditions.push(eq(budgetItems.versionId, versionId));
  } else if (budgetId) {
    conditions.push(eq(versions.budgetId, budgetId));
  } else if (projectId) {
    conditions.push(eq(budgets.projectId, projectId));
  }

  const rows = await db
    .select({
      id: budgetItems.id,
      itemCode: budgetItems.itemCode,
      itemNumber: budgetItems.itemNumber,
      name: budgetItems.name,
      quantity: budgetItems.quantity,
      unit: budgetItems.unit,
      materialUnitPrice: budgetItems.materialUnitPrice,
      feeUnitPrice: budgetItems.feeUnitPrice,
      versionId: versions.id,
      versionName: versions.versionName,
      versionType: versions.versionType,
      budgetId: budgets.id,
      budgetName: budgets.name,
      projectId: projects.id,
      projectCode: projects.projectCode,
      projectName: projects.name,
      partnerName: partners.name,
    })
    .from(budgetItems)
    .innerJoin(versions, eq(budgetItems.versionId, versions.id))
    .innerJoin(budgets, eq(versions.budgetId, budgets.id))
    .innerJoin(projects, eq(budgets.projectId, projects.id))
    .leftJoin(partners, eq(versions.partnerId, partners.id))
    .where(and(...conditions))
    .orderBy(budgetItems.itemNumber, budgetItems.name)
    .limit(400);

  return rows.map((r) => ({
    ...r,
    quantity: Number(r.quantity),
    materialUnitPrice: Number(r.materialUnitPrice),
    feeUnitPrice: Number(r.feeUnitPrice),
  }));
}
