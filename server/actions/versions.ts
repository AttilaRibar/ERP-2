"use server";

import { db } from "@/lib/db";
import { versions, budgetItems } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

// ---- Types ----

export interface VersionInfo {
  id: number;
  budgetId: number;
  parentId: number | null;
  versionName: string;
  createdAt: Date | null;
  hasChildren: boolean;
}

export interface ReconstructedItem {
  id: number;
  versionId: number;
  itemCode: string;
  sequenceNo: number;
  itemNumber: string;
  name: string;
  quantity: number;
  unit: string;
  materialUnitPrice: number;
  feeUnitPrice: number;
  notes: string;
}

export interface BudgetItemInput {
  itemCode: string;
  sequenceNo: number;
  itemNumber: string;
  name: string;
  quantity: number;
  unit: string;
  materialUnitPrice: number;
  feeUnitPrice: number;
  notes: string;
}

interface DeltaItem extends BudgetItemInput {
  isDeleted: boolean;
}

export interface ComparisonItem {
  itemCode: string;
  status: "added" | "removed" | "changed" | "unchanged";
  itemA?: ReconstructedItem;
  itemB?: ReconstructedItem;
  materialDelta?: number;
  feeDelta?: number;
}

export interface ComparisonResult {
  items: ComparisonItem[];
  totalA: { count: number; materialTotal: number; feeTotal: number };
  totalB: { count: number; materialTotal: number; feeTotal: number };
}

// ---- Queries ----

export async function getVersionsByBudgetId(budgetId: number): Promise<VersionInfo[]> {
  const rows = await db
    .select({
      id: versions.id,
      budgetId: versions.budgetId,
      parentId: versions.parentId,
      versionName: versions.versionName,
      createdAt: versions.createdAt,
    })
    .from(versions)
    .where(eq(versions.budgetId, budgetId))
    .orderBy(versions.createdAt);

  const childSet = new Set(
    rows.filter((r) => r.parentId !== null).map((r) => r.parentId!)
  );

  return rows.map((r) => ({
    ...r,
    hasChildren: childSet.has(r.id),
  }));
}

export async function getVersionItems(versionId: number): Promise<ReconstructedItem[]> {
  const result = await db.execute(sql`
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id, 0 AS depth
      FROM versions
      WHERE id = ${versionId}
      UNION ALL
      SELECT v.id, v.parent_id, a.depth + 1
      FROM versions v
      JOIN ancestors a ON v.id = a.parent_id
    ),
    ranked_items AS (
      SELECT
        bi.id,
        bi.version_id,
        bi.item_code,
        bi.sequence_no,
        bi.item_number,
        bi.name,
        bi.quantity,
        bi.unit,
        bi.material_unit_price,
        bi.fee_unit_price,
        bi.notes,
        bi.is_deleted,
        ROW_NUMBER() OVER (PARTITION BY bi.item_code ORDER BY a.depth ASC) AS rn
      FROM budget_items bi
      JOIN ancestors a ON bi.version_id = a.id
    )
    SELECT id, version_id, item_code, sequence_no, item_number, name,
           quantity, unit, material_unit_price, fee_unit_price, notes
    FROM ranked_items
    WHERE rn = 1 AND NOT is_deleted
    ORDER BY sequence_no, id
  `);

  const rows = result as unknown as Record<string, unknown>[];
  return rows.map((row) => ({
    id: Number(row.id),
    versionId: Number(row.version_id),
    itemCode: String(row.item_code),
    sequenceNo: Number(row.sequence_no),
    itemNumber: String(row.item_number),
    name: String(row.name),
    quantity: Number(row.quantity),
    unit: String(row.unit),
    materialUnitPrice: Number(row.material_unit_price),
    feeUnitPrice: Number(row.fee_unit_price),
    notes: String(row.notes),
  }));
}

// ---- Mutations ----

const VersionNameSchema = z.string().min(1, "A verzió neve kötelező").max(100);

export async function createVersion(
  budgetId: number,
  parentId: number | null,
  name: string
): Promise<{ success: boolean; data?: VersionInfo; error?: string }> {
  const parsed = VersionNameSchema.safeParse(name);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };

  const [created] = await db
    .insert(versions)
    .values({ budgetId, parentId, versionName: parsed.data })
    .returning();

  return {
    success: true,
    data: { ...created, hasChildren: false },
  };
}

export async function renameVersion(
  versionId: number,
  name: string
): Promise<{ success: boolean; error?: string }> {
  const parsed = VersionNameSchema.safeParse(name);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };

  await db.update(versions).set({ versionName: parsed.data }).where(eq(versions.id, versionId));
  return { success: true };
}

export async function deleteVersionAction(
  versionId: number
): Promise<{ success: boolean; error?: string }> {
  const children = await db
    .select({ id: versions.id })
    .from(versions)
    .where(eq(versions.parentId, versionId));

  if (children.length > 0) {
    return { success: false, error: "Nem törölhető: a verziónak vannak gyermekei" };
  }

  await db.delete(budgetItems).where(eq(budgetItems.versionId, versionId));
  await db.delete(versions).where(eq(versions.id, versionId));
  return { success: true };
}

// ---- Delta computation ----

function itemChanged(parent: ReconstructedItem, item: BudgetItemInput): boolean {
  return (
    parent.sequenceNo !== item.sequenceNo ||
    parent.itemNumber !== item.itemNumber ||
    parent.name !== item.name ||
    parent.quantity !== item.quantity ||
    parent.unit !== item.unit ||
    parent.materialUnitPrice !== item.materialUnitPrice ||
    parent.feeUnitPrice !== item.feeUnitPrice ||
    parent.notes !== item.notes
  );
}

function computeDelta(
  parentItems: ReconstructedItem[],
  newItems: BudgetItemInput[]
): DeltaItem[] {
  const parentMap = new Map(parentItems.map((i) => [i.itemCode, i]));
  const newMap = new Map(newItems.map((i) => [i.itemCode, i]));
  const delta: DeltaItem[] = [];

  for (const [code, item] of newMap) {
    const parent = parentMap.get(code);
    if (!parent) {
      delta.push({ ...item, isDeleted: false });
    } else if (itemChanged(parent, item)) {
      delta.push({ ...item, isDeleted: false });
    }
  }

  for (const [code, item] of parentMap) {
    if (!newMap.has(code)) {
      delta.push({
        itemCode: code,
        sequenceNo: item.sequenceNo,
        itemNumber: item.itemNumber,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        materialUnitPrice: item.materialUnitPrice,
        feeUnitPrice: item.feeUnitPrice,
        notes: item.notes,
        isDeleted: true,
      });
    }
  }

  return delta;
}

export async function saveItemsToVersion(
  versionId: number,
  newItems: BudgetItemInput[]
): Promise<{ success: boolean; error?: string }> {
  const [version] = await db
    .select()
    .from(versions)
    .where(eq(versions.id, versionId));
  if (!version) return { success: false, error: "Verzió nem található" };

  const children = await db
    .select({ id: versions.id })
    .from(versions)
    .where(eq(versions.parentId, versionId));
  if (children.length > 0) {
    return { success: false, error: "Csak levél verzióba lehet menteni" };
  }

  const parentItems = version.parentId
    ? await getVersionItems(version.parentId)
    : [];

  const deltaItems = computeDelta(parentItems, newItems);

  await db.delete(budgetItems).where(eq(budgetItems.versionId, versionId));

  if (deltaItems.length > 0) {
    await db.insert(budgetItems).values(
      deltaItems.map((item) => ({
        versionId,
        itemCode: item.itemCode,
        sequenceNo: item.sequenceNo,
        itemNumber: item.itemNumber,
        name: item.name,
        quantity: String(item.quantity),
        unit: item.unit,
        materialUnitPrice: String(item.materialUnitPrice),
        feeUnitPrice: String(item.feeUnitPrice),
        notes: item.notes,
        isDeleted: item.isDeleted,
      }))
    );
  }

  return { success: true };
}

export async function saveItemsAsNewVersion(
  parentVersionId: number,
  versionName: string,
  newItems: BudgetItemInput[]
): Promise<{ success: boolean; data?: VersionInfo; error?: string }> {
  const parsed = VersionNameSchema.safeParse(versionName);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };

  const [parent] = await db
    .select()
    .from(versions)
    .where(eq(versions.id, parentVersionId));
  if (!parent) return { success: false, error: "Szülő verzió nem található" };

  const parentItems = await getVersionItems(parentVersionId);
  const deltaItems = computeDelta(parentItems, newItems);

  const [created] = await db
    .insert(versions)
    .values({
      budgetId: parent.budgetId,
      parentId: parentVersionId,
      versionName: parsed.data,
    })
    .returning();

  if (deltaItems.length > 0) {
    await db.insert(budgetItems).values(
      deltaItems.map((item) => ({
        versionId: created.id,
        itemCode: item.itemCode,
        sequenceNo: item.sequenceNo,
        itemNumber: item.itemNumber,
        name: item.name,
        quantity: String(item.quantity),
        unit: item.unit,
        materialUnitPrice: String(item.materialUnitPrice),
        feeUnitPrice: String(item.feeUnitPrice),
        notes: item.notes,
        isDeleted: item.isDeleted,
      }))
    );
  }

  return {
    success: true,
    data: { ...created, hasChildren: false },
  };
}

// ---- Comparison ----

export async function compareVersions(
  versionAId: number,
  versionBId: number
): Promise<ComparisonResult> {
  const [itemsA, itemsB] = await Promise.all([
    getVersionItems(versionAId),
    getVersionItems(versionBId),
  ]);

  const mapA = new Map(itemsA.map((i) => [i.itemCode, i]));
  const mapB = new Map(itemsB.map((i) => [i.itemCode, i]));
  const allCodes = new Set([...mapA.keys(), ...mapB.keys()]);

  const items: ComparisonItem[] = [];

  for (const code of allCodes) {
    const a = mapA.get(code);
    const b = mapB.get(code);

    if (a && !b) {
      items.push({ itemCode: code, status: "removed", itemA: a });
    } else if (!a && b) {
      items.push({ itemCode: code, status: "added", itemB: b });
    } else if (a && b) {
      const matDelta =
        b.quantity * b.materialUnitPrice - a.quantity * a.materialUnitPrice;
      const feeDelta =
        b.quantity * b.feeUnitPrice - a.quantity * a.feeUnitPrice;

      const changed =
        a.name !== b.name ||
        a.quantity !== b.quantity ||
        a.materialUnitPrice !== b.materialUnitPrice ||
        a.feeUnitPrice !== b.feeUnitPrice ||
        a.itemNumber !== b.itemNumber ||
        a.unit !== b.unit ||
        a.notes !== b.notes;

      if (changed) {
        items.push({
          itemCode: code,
          status: "changed",
          itemA: a,
          itemB: b,
          materialDelta: matDelta,
          feeDelta: feeDelta,
        });
      } else {
        items.push({ itemCode: code, status: "unchanged", itemA: a, itemB: b });
      }
    }
  }

  const order: Record<string, number> = { removed: 0, changed: 1, added: 2, unchanged: 3 };
  items.sort((a, b) => order[a.status] - order[b.status]);

  const totalA = {
    count: itemsA.length,
    materialTotal: itemsA.reduce((s, i) => s + i.quantity * i.materialUnitPrice, 0),
    feeTotal: itemsA.reduce((s, i) => s + i.quantity * i.feeUnitPrice, 0),
  };

  const totalB = {
    count: itemsB.length,
    materialTotal: itemsB.reduce((s, i) => s + i.quantity * i.materialUnitPrice, 0),
    feeTotal: itemsB.reduce((s, i) => s + i.quantity * i.feeUnitPrice, 0),
  };

  return { items, totalA, totalB };
}
