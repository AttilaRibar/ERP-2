"use server";

import { db } from "@/lib/db";
import { budgetItems, versions, budgets, projects, partners } from "@/lib/db/schema";
import { eq, ilike, or, and, sql } from "drizzle-orm";

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
  sectionCode: string | null;
  /** Full category/subcategory path, e.g. "Elektromos / Gyengeáram". */
  sectionPath: string | null;
}

interface SectionPathRow {
  sectionCode: string;
  parentSectionCode: string | null;
  name: string;
}

function buildSectionPath(
  sectionCode: string,
  sectionByCode: Map<string, SectionPathRow>,
): string | null {
  const names: string[] = [];
  const visited = new Set<string>();
  let current: SectionPathRow | undefined = sectionByCode.get(sectionCode);

  while (current && !visited.has(current.sectionCode)) {
    visited.add(current.sectionCode);
    names.push(current.name);
    current = current.parentSectionCode
      ? sectionByCode.get(current.parentSectionCode)
      : undefined;
  }

  return names.length > 0 ? names.reverse().join(" / ") : null;
}

async function getSectionPathsByVersion(
  versionIds: number[],
): Promise<Map<number, Map<string, string>>> {
  const uniqueVersionIds = Array.from(new Set(versionIds));
  const pathsByVersion = new Map<number, Map<string, string>>();
  if (uniqueVersionIds.length === 0) return pathsByVersion;

  const versionIdsSql = sql.join(
    uniqueVersionIds.map((versionId) => sql`${versionId}`),
    sql`, `,
  );

  const result = await db.execute(sql`
    WITH RECURSIVE target_versions(target_version_id) AS (
      SELECT unnest(ARRAY[${versionIdsSql}]::bigint[])
    ),
    ancestors(target_version_id, id, parent_id, depth) AS (
      SELECT tv.target_version_id, v.id, v.parent_id, 0 AS depth
      FROM target_versions tv
      JOIN versions v ON v.id = tv.target_version_id
      UNION ALL
      SELECT a.target_version_id, v.id, v.parent_id, a.depth + 1
      FROM versions v
      JOIN ancestors a ON v.id = a.parent_id
    ),
    ranked_sections AS (
      SELECT
        a.target_version_id,
        bs.section_code,
        bs.parent_section_code,
        bs.name,
        bs.is_deleted,
        ROW_NUMBER() OVER (
          PARTITION BY a.target_version_id, bs.section_code
          ORDER BY a.depth ASC
        ) AS rn
      FROM budget_sections bs
      JOIN ancestors a ON bs.version_id = a.id
    )
    SELECT target_version_id, section_code, parent_section_code, name
    FROM ranked_sections
    WHERE rn = 1 AND NOT is_deleted
  `);

  const sectionsByVersion = new Map<number, Map<string, SectionPathRow>>();
  for (const row of result as unknown as Record<string, unknown>[]) {
    const targetVersionId = Number(row.target_version_id);
    const section: SectionPathRow = {
      sectionCode: String(row.section_code),
      parentSectionCode: row.parent_section_code ? String(row.parent_section_code) : null,
      name: String(row.name),
    };

    const sections = sectionsByVersion.get(targetVersionId) ?? new Map<string, SectionPathRow>();
    sections.set(section.sectionCode, section);
    sectionsByVersion.set(targetVersionId, sections);
  }

  for (const [versionId, sections] of sectionsByVersion) {
    const sectionPaths = new Map<string, string>();
    for (const sectionCode of sections.keys()) {
      const path = buildSectionPath(sectionCode, sections);
      if (path) sectionPaths.set(sectionCode, path);
    }
    pathsByVersion.set(versionId, sectionPaths);
  }

  return pathsByVersion;
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
      sectionCode: budgetItems.sectionCode,
    })
    .from(budgetItems)
    .innerJoin(versions, eq(budgetItems.versionId, versions.id))
    .innerJoin(budgets, eq(versions.budgetId, budgets.id))
    .innerJoin(projects, eq(budgets.projectId, projects.id))
    .leftJoin(partners, eq(versions.partnerId, partners.id))
    .where(and(...conditions))
    .orderBy(budgetItems.itemNumber, budgetItems.name)
    .limit(400);

  const sectionPathsByVersion = await getSectionPathsByVersion(
    rows.map((row) => Number(row.versionId)),
  );

  return rows.map((r) => ({
    ...r,
    quantity: Number(r.quantity),
    materialUnitPrice: Number(r.materialUnitPrice),
    feeUnitPrice: Number(r.feeUnitPrice),
    sectionCode: r.sectionCode,
    sectionPath: r.sectionCode
      ? (sectionPathsByVersion.get(Number(r.versionId))?.get(r.sectionCode) ?? null)
      : null,
  }));
}
