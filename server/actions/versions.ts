"use server";

import { db } from "@/lib/db";
import { versions, budgetItems, budgetSections, partners } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

// ---- Types ----

export type VersionType = "offer" | "contracted" | "unpriced";

export interface VersionInfo {
  id: number;
  budgetId: number;
  parentId: number | null;
  versionName: string;
  versionType: VersionType;
  partnerId: number | null;
  partnerName: string | null;
  originalFileName: string | null;
  originalFilePath: string | null;
  notes: string | null;
  createdAt: Date | null;
  hasChildren: boolean;
}

export interface ReconstructedSection {
  id: number;
  versionId: number;
  sectionCode: string;
  parentSectionCode: string | null;
  name: string;
  sequenceNo: number;
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
  sectionCode: string | null;
  alternativeOfItemCode: string | null;
}

export interface SectionInput {
  sectionCode: string;
  parentSectionCode: string | null;
  name: string;
  sequenceNo: number;
}

export interface SectionTotals {
  sectionCode: string | null;
  sectionName: string;
  materialTotal: number;
  feeTotal: number;
  itemCount: number;
  children: SectionTotals[];
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
  sectionCode: string | null;
  alternativeOfItemCode: string | null;
}

interface DeltaItem extends BudgetItemInput {
  isDeleted: boolean;
}

interface DeltaSection extends SectionInput {
  isDeleted: boolean;
}

export interface ComparisonItem {
  itemCode: string;
  status: "added" | "removed" | "changed" | "unchanged";
  sectionChanged: boolean;
  itemA?: ReconstructedItem;
  itemB?: ReconstructedItem;
  materialDelta?: number;
  feeDelta?: number;
}

export interface ComparisonResult {
  items: ComparisonItem[];
  sections: ReconstructedSection[];
  sectionsA: ReconstructedSection[];
  sectionsB: ReconstructedSection[];
  totalA: { count: number; materialTotal: number; feeTotal: number };
  totalB: { count: number; materialTotal: number; feeTotal: number };
  sectionTotalsA: SectionTotals[];
  sectionTotalsB: SectionTotals[];
  /** True when either compared version is "unpriced" — price deltas should be hidden */
  ignorePrice: boolean;
  notesA: string | null;
  notesB: string | null;
}

// ---- Queries ----

export async function getVersionsByBudgetId(budgetId: number): Promise<VersionInfo[]> {
  const rows = await db
    .select({
      id: versions.id,
      budgetId: versions.budgetId,
      parentId: versions.parentId,
      versionName: versions.versionName,
      versionType: versions.versionType,
      partnerId: versions.partnerId,
      partnerName: partners.name,
      originalFileName: versions.originalFileName,
      originalFilePath: versions.originalFilePath,
      notes: versions.notes,
      createdAt: versions.createdAt,
    })
    .from(versions)
    .leftJoin(partners, eq(versions.partnerId, partners.id))
    .where(eq(versions.budgetId, budgetId))
    .orderBy(versions.createdAt);

  const childSet = new Set(
    rows.filter((r) => r.parentId !== null).map((r) => r.parentId!)
  );

  return rows.map((r) => ({
    ...r,
    versionType: (r.versionType ?? "offer") as VersionType,
    hasChildren: childSet.has(r.id),
  }));
}

export async function getVersionSections(versionId: number): Promise<ReconstructedSection[]> {
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
    ranked_sections AS (
      SELECT
        bs.id,
        bs.version_id,
        bs.section_code,
        bs.parent_section_code,
        bs.name,
        bs.sequence_no,
        bs.is_deleted,
        ROW_NUMBER() OVER (PARTITION BY bs.section_code ORDER BY a.depth ASC) AS rn
      FROM budget_sections bs
      JOIN ancestors a ON bs.version_id = a.id
    )
    SELECT id, version_id, section_code, parent_section_code, name, sequence_no
    FROM ranked_sections
    WHERE rn = 1 AND NOT is_deleted
    ORDER BY sequence_no, id
  `);

  const rows = result as unknown as Record<string, unknown>[];
  return rows.map((row) => ({
    id: Number(row.id),
    versionId: Number(row.version_id),
    sectionCode: String(row.section_code),
    parentSectionCode: row.parent_section_code ? String(row.parent_section_code) : null,
    name: String(row.name),
    sequenceNo: Number(row.sequence_no),
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
        bi.section_code,
        bi.alternative_of_item_code,
        bi.is_deleted,
        ROW_NUMBER() OVER (PARTITION BY bi.item_code ORDER BY a.depth ASC) AS rn
      FROM budget_items bi
      JOIN ancestors a ON bi.version_id = a.id
    )
    SELECT id, version_id, item_code, sequence_no, item_number, name,
           quantity, unit, material_unit_price, fee_unit_price, notes, section_code,
           alternative_of_item_code
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
    sectionCode: row.section_code ? String(row.section_code) : null,
    alternativeOfItemCode: row.alternative_of_item_code ? String(row.alternative_of_item_code) : null,
  }));
}

// ---- Helpers ----

function buildSectionTotals(
  sections: ReconstructedSection[],
  items: ReconstructedItem[],
  parentCode: string | null = null
): SectionTotals[] {
  const children = sections
    .filter((s) => s.parentSectionCode === parentCode)
    .sort((a, b) => a.sequenceNo - b.sequenceNo);

  return children.map((sec) => {
    const nested = buildSectionTotals(sections, items, sec.sectionCode);
    const directItems = items.filter((i) => i.sectionCode === sec.sectionCode);
    const nestedMat = nested.reduce((s, n) => s + n.materialTotal, 0);
    const nestedFee = nested.reduce((s, n) => s + n.feeTotal, 0);
    const nestedCount = nested.reduce((s, n) => s + n.itemCount, 0);
    return {
      sectionCode: sec.sectionCode,
      sectionName: sec.name,
      materialTotal: directItems.reduce((s, i) => s + i.quantity * i.materialUnitPrice, 0) + nestedMat,
      feeTotal: directItems.reduce((s, i) => s + i.quantity * i.feeUnitPrice, 0) + nestedFee,
      itemCount: directItems.length + nestedCount,
      children: nested,
    };
  });
}

// ---- Mutations ----

const VersionNameSchema = z.string().min(1, "A verzió neve kötelező").max(100);

export async function getPartnersForVersionSelect() {
  return db
    .select({ id: partners.id, name: partners.name })
    .from(partners)
    .orderBy(partners.name);
}

export async function createVersion(
  budgetId: number,
  parentId: number | null,
  name: string,
  versionType: VersionType = "offer",
  partnerId: number | null = null
): Promise<{ success: boolean; data?: VersionInfo; error?: string }> {
  const parsed = VersionNameSchema.safeParse(name);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };

  const [created] = await db
    .insert(versions)
    .values({ budgetId, parentId, versionName: parsed.data, versionType, partnerId })
    .returning();

  let partnerName: string | null = null;
  if (created.partnerId) {
    const [p] = await db.select({ name: partners.name }).from(partners).where(eq(partners.id, created.partnerId));
    partnerName = p?.name ?? null;
  }

  return {
    success: true,
    data: { ...created, notes: created.notes ?? null, versionType: created.versionType as VersionType, partnerName, hasChildren: false },
  };
}

export async function updateVersionNotes(
  versionId: number,
  notes: string | null
): Promise<{ success: boolean; error?: string }> {
  await db.update(versions).set({ notes: notes?.trim() || null }).where(eq(versions.id, versionId));
  return { success: true };
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
  await db.delete(budgetSections).where(eq(budgetSections.versionId, versionId));
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
    parent.notes !== item.notes ||
    parent.sectionCode !== item.sectionCode ||
    parent.alternativeOfItemCode !== item.alternativeOfItemCode
  );
}

function computeDelta(
  parentItems: ReconstructedItem[],
  newItems: BudgetItemInput[]
): DeltaItem[] {
  const parentMap = new Map(parentItems.map((i) => [i.itemCode, i]));
  const newMap = new Map(newItems.map((i) => [i.itemCode, i]));
  const delta: DeltaItem[] = [];
  const deltaCodeSet = new Set<string>();

  for (const [code, item] of newMap) {
    const parent = parentMap.get(code);
    if (!parent) {
      delta.push({ ...item, isDeleted: false });
      deltaCodeSet.add(code);
    } else if (itemChanged(parent, item)) {
      delta.push({ ...item, isDeleted: false });
      deltaCodeSet.add(code);
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
        sectionCode: item.sectionCode,
        alternativeOfItemCode: item.alternativeOfItemCode,
        isDeleted: true,
      });
      deltaCodeSet.add(code);
    }
  }

  // Ensure original items referenced by alternatives are included in the delta.
  // This guarantees alternatives never reference items that only exist in a
  // parent version — the original is always co-located with its alternatives.
  for (const item of newItems) {
    if (item.alternativeOfItemCode && !deltaCodeSet.has(item.alternativeOfItemCode)) {
      const original = newMap.get(item.alternativeOfItemCode);
      if (original) {
        delta.push({ ...original, isDeleted: false });
        deltaCodeSet.add(item.alternativeOfItemCode);
      }
    }
  }

  return delta;
}

function sectionChanged(parent: ReconstructedSection, sec: SectionInput): boolean {
  return (
    parent.parentSectionCode !== sec.parentSectionCode ||
    parent.name !== sec.name ||
    parent.sequenceNo !== sec.sequenceNo
  );
}

function computeSectionDelta(
  parentSections: ReconstructedSection[],
  newSections: SectionInput[]
): DeltaSection[] {
  const parentMap = new Map(parentSections.map((s) => [s.sectionCode, s]));
  const newMap = new Map(newSections.map((s) => [s.sectionCode, s]));
  const delta: DeltaSection[] = [];

  for (const [code, sec] of newMap) {
    const parent = parentMap.get(code);
    if (!parent || sectionChanged(parent, sec)) {
      delta.push({ ...sec, isDeleted: false });
    }
  }

  for (const [code, sec] of parentMap) {
    if (!newMap.has(code)) {
      delta.push({ ...sec, isDeleted: true });
    }
  }

  return delta;
}

async function persistDeltaItems(versionId: number, deltaItems: DeltaItem[]) {
  if (deltaItems.length === 0) return;
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
      sectionCode: item.sectionCode ?? null,
      alternativeOfItemCode: item.alternativeOfItemCode ?? null,
      isDeleted: item.isDeleted,
    }))
  );
}

async function persistDeltaSections(versionId: number, deltaSections: DeltaSection[]) {
  if (deltaSections.length === 0) return;
  await db.insert(budgetSections).values(
    deltaSections.map((sec) => ({
      versionId,
      sectionCode: sec.sectionCode,
      parentSectionCode: sec.parentSectionCode ?? null,
      name: sec.name,
      sequenceNo: sec.sequenceNo,
      isDeleted: sec.isDeleted,
    }))
  );
}

export async function saveItemsToVersion(
  versionId: number,
  newItems: BudgetItemInput[],
  newSections: SectionInput[] = []
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

  const [parentItems, parentSections] = await (version.parentId
    ? Promise.all([getVersionItems(version.parentId), getVersionSections(version.parentId)])
    : Promise.resolve([[], []] as [ReconstructedItem[], ReconstructedSection[]]));

  const deltaItems = computeDelta(parentItems, newItems);
  const deltaSections = computeSectionDelta(parentSections, newSections);

  await db.delete(budgetItems).where(eq(budgetItems.versionId, versionId));
  await db.delete(budgetSections).where(eq(budgetSections.versionId, versionId));

  await persistDeltaItems(versionId, deltaItems);
  await persistDeltaSections(versionId, deltaSections);

  return { success: true };
}

export async function saveItemsAsNewVersion(
  parentVersionId: number,
  versionName: string,
  newItems: BudgetItemInput[],
  newSections: SectionInput[] = [],
  versionType: VersionType = "offer",
  partnerId: number | null = null
): Promise<{ success: boolean; data?: VersionInfo; error?: string }> {
  const parsed = VersionNameSchema.safeParse(versionName);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };

  const [parent] = await db
    .select()
    .from(versions)
    .where(eq(versions.id, parentVersionId));
  if (!parent) return { success: false, error: "Szülő verzió nem található" };

  const [parentItems, parentSections] = await Promise.all([
    getVersionItems(parentVersionId),
    getVersionSections(parentVersionId),
  ]);

  const deltaItems = computeDelta(parentItems, newItems);
  const deltaSections = computeSectionDelta(parentSections, newSections);

  const [created] = await db
    .insert(versions)
    .values({
      budgetId: parent.budgetId,
      parentId: parentVersionId,
      versionName: parsed.data,
      versionType,
      partnerId,
    })
    .returning();

  let partnerName: string | null = null;
  if (created.partnerId) {
    const [p] = await db.select({ name: partners.name }).from(partners).where(eq(partners.id, created.partnerId));
    partnerName = p?.name ?? null;
  }

  await persistDeltaItems(created.id, deltaItems);
  await persistDeltaSections(created.id, deltaSections);

  return {
    success: true,
    data: { ...created, versionType: created.versionType as VersionType, partnerName, hasChildren: false },
  };
}

// ---- Comparison ----

export async function compareVersions(
  versionAId: number,
  versionBId: number
): Promise<ComparisonResult> {
  // Fetch version metadata to check for unpriced type
  const [versionARows, versionBRows] = await Promise.all([
    db.select({ versionType: versions.versionType, notes: versions.notes }).from(versions).where(eq(versions.id, versionAId)),
    db.select({ versionType: versions.versionType, notes: versions.notes }).from(versions).where(eq(versions.id, versionBId)),
  ]);
  const versionAType = versionARows[0]?.versionType as VersionType | undefined;
  const versionBType = versionBRows[0]?.versionType as VersionType | undefined;
  const notesA = versionARows[0]?.notes ?? null;
  const notesB = versionBRows[0]?.notes ?? null;
  // When either version is "unpriced", price changes should not count as modifications
  const ignorePrice = versionAType === "unpriced" || versionBType === "unpriced";

  const [itemsA, itemsB, sectionsA, sectionsB] = await Promise.all([
    getVersionItems(versionAId),
    getVersionItems(versionBId),
    getVersionSections(versionAId),
    getVersionSections(versionBId),
  ]);

  const mapA = new Map(itemsA.map((i) => [i.itemCode, i]));
  const mapB = new Map(itemsB.map((i) => [i.itemCode, i]));
  const allCodes = new Set([...mapA.keys(), ...mapB.keys()]);

  const items: ComparisonItem[] = [];

  for (const code of allCodes) {
    const a = mapA.get(code);
    const b = mapB.get(code);

    if (a && !b) {
      items.push({ itemCode: code, status: "removed", sectionChanged: false, itemA: a });
    } else if (!a && b) {
      items.push({ itemCode: code, status: "added", sectionChanged: false, itemB: b });
    } else if (a && b) {
      const matDelta = b.quantity * b.materialUnitPrice - a.quantity * a.materialUnitPrice;
      const feeDelta = b.quantity * b.feeUnitPrice - a.quantity * a.feeUnitPrice;
      const sectionMoved = a.sectionCode !== b.sectionCode;

      const dataChanged =
        a.name !== b.name ||
        a.quantity !== b.quantity ||
        (!ignorePrice && a.materialUnitPrice !== b.materialUnitPrice) ||
        (!ignorePrice && a.feeUnitPrice !== b.feeUnitPrice) ||
        a.itemNumber !== b.itemNumber ||
        a.unit !== b.unit ||
        a.notes !== b.notes;

      const changed = dataChanged || sectionMoved;

      if (changed) {
        items.push({
          itemCode: code,
          status: "changed",
          sectionChanged: sectionMoved,
          itemA: a,
          itemB: b,
          materialDelta: matDelta,
          feeDelta: feeDelta,
        });
      } else {
        items.push({
          itemCode: code,
          status: "unchanged",
          sectionChanged: false,
          itemA: a,
          itemB: b,
        });
      }
    }
  }

  const order: Record<string, number> = { removed: 0, changed: 1, added: 2, unchanged: 3 };
  items.sort((a, b) => order[a.status] - order[b.status]);

  // Merged section list (union of both versions – for display)
  const sectionMap = new Map<string, ReconstructedSection>();
  for (const s of sectionsA) sectionMap.set(s.sectionCode, s);
  for (const s of sectionsB) sectionMap.set(s.sectionCode, s);
  const sections = Array.from(sectionMap.values());

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

  return {
    items,
    sections,
    sectionsA,
    sectionsB,
    totalA,
    totalB,
    sectionTotalsA: buildSectionTotals(sectionsA, itemsA),
    sectionTotalsB: buildSectionTotals(sectionsB, itemsB),
    ignorePrice,
    notesA,
    notesB,
  };
}

// ---- Multi-version comparison ----

export interface MultiVersionEntry {
  versionId: number;
  versionName: string;
  versionType: VersionType;
  partnerName: string | null;
  notes: string | null;
  totalMaterial: number;
  totalFee: number;
  totalCombined: number;
  itemCount: number;
  sectionTotals: SectionTotals[];
}

export interface MultiVersionItemEntry {
  itemCode: string;
  itemNumber: string;
  name: string;
  unit: string;
  sectionName: string | null;
  /** Per-version data: null means item doesn't exist in that version */
  perVersion: (MultiVersionItemPrice | null)[];
}

export interface MultiVersionItemPrice {
  quantity: number;
  materialUnitPrice: number;
  feeUnitPrice: number;
  combinedUnitPrice: number;
  /** Quantity × material unit price */
  materialTotal: number;
  /** Quantity × fee unit price */
  feeTotal: number;
  /** Quantity × combined unit price */
  combinedTotal: number;
}

export interface MultiComparisonResult {
  versions: MultiVersionEntry[];
  /** Union of all section codes/names across all versions */
  allSectionCodes: string[];
  /** Item-level data across all versions (for variance analysis) */
  items: MultiVersionItemEntry[];
}

export async function compareMultipleVersions(
  versionIds: number[]
): Promise<MultiComparisonResult> {
  if (versionIds.length < 2) throw new Error("Legalább 2 verzió szükséges");

  // Fetch all version metadata in parallel
  const versionMetaRows = await Promise.all(
    versionIds.map((id) =>
      db
        .select({
          id: versions.id,
          versionName: versions.versionName,
          versionType: versions.versionType,
          partnerId: versions.partnerId,
          partnerName: partners.name,
          notes: versions.notes,
        })
        .from(versions)
        .leftJoin(partners, eq(versions.partnerId, partners.id))
        .where(eq(versions.id, id))
        .then((rows) => rows[0])
    )
  );

  // Fetch items + sections for all versions in parallel
  const [allItems, allSections] = await Promise.all([
    Promise.all(versionIds.map((id) => getVersionItems(id))),
    Promise.all(versionIds.map((id) => getVersionSections(id))),
  ]);

  const entries: MultiVersionEntry[] = versionIds.map((id, idx) => {
    const meta = versionMetaRows[idx];
    const items = allItems[idx];
    const sections = allSections[idx];

    const totalMaterial = items.reduce((s, i) => s + i.quantity * i.materialUnitPrice, 0);
    const totalFee = items.reduce((s, i) => s + i.quantity * i.feeUnitPrice, 0);

    return {
      versionId: id,
      versionName: meta?.versionName ?? `Verzió #${id}`,
      versionType: (meta?.versionType ?? "offer") as VersionType,
      partnerName: meta?.partnerName ?? null,
      notes: meta?.notes ?? null,
      totalMaterial,
      totalFee,
      totalCombined: totalMaterial + totalFee,
      itemCount: items.length,
      sectionTotals: buildSectionTotals(sections, items),
    };
  });

  // Collect all section codes
  const allCodes = new Set<string>();
  for (const sections of allSections) {
    for (const s of sections) allCodes.add(s.sectionCode);
  }

  // Build section name lookup (code → name) across all versions
  const sectionNameMap = new Map<string, string>();
  for (const sections of allSections) {
    for (const s of sections) sectionNameMap.set(s.sectionCode, s.name);
  }

  // Build item-level cross-version data
  const allItemCodes = new Set<string>();
  const itemMaps = allItems.map((items) => {
    const map = new Map<string, ReconstructedItem>();
    for (const item of items) {
      map.set(item.itemCode, item);
      allItemCodes.add(item.itemCode);
    }
    return map;
  });

  // Pick representative item info (first version that has it)
  const multiItems: MultiVersionItemEntry[] = [];
  for (const code of allItemCodes) {
    let representative: ReconstructedItem | null = null;
    const perVersion: (MultiVersionItemPrice | null)[] = [];

    for (let vi = 0; vi < versionIds.length; vi++) {
      const item = itemMaps[vi].get(code) ?? null;
      if (item && !representative) representative = item;
      perVersion.push(
        item
          ? {
              quantity: item.quantity,
              materialUnitPrice: item.materialUnitPrice,
              feeUnitPrice: item.feeUnitPrice,
              combinedUnitPrice: item.materialUnitPrice + item.feeUnitPrice,
              materialTotal: item.quantity * item.materialUnitPrice,
              feeTotal: item.quantity * item.feeUnitPrice,
              combinedTotal: item.quantity * (item.materialUnitPrice + item.feeUnitPrice),
            }
          : null
      );
    }

    if (representative) {
      multiItems.push({
        itemCode: code,
        itemNumber: representative.itemNumber,
        name: representative.name,
        unit: representative.unit,
        sectionName: representative.sectionCode
          ? sectionNameMap.get(representative.sectionCode) ?? null
          : null,
        perVersion,
      });
    }
  }

  return {
    versions: entries,
    allSectionCodes: Array.from(allCodes),
    items: multiItems,
  };
}
