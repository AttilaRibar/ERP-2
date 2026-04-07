"use server";

import { db } from "@/lib/db";
import { versions, budgetItems, budgetSections } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type {
  BudgetItemInput,
  SectionInput,
  VersionInfo,
  VersionType,
  ReconstructedItem,
  ReconstructedSection,
} from "./versions";
import { getVersionItems, getVersionSections, getPartnersForVersionSelect } from "./versions";

export { getPartnersForVersionSelect };

export interface ImportVersionInput {
  budgetId: number;
  parentId: number | null;
  versionName: string;
  versionType: VersionType;
  partnerId: number | null;
  sections: SectionInput[];
  items: BudgetItemInput[];
}

// ---- Smart matching helpers ----

/**
 * Match imported sections to parent sections by name, building a remap
 * of importedSectionCode → parentSectionCode for sections that exist in both.
 */
function buildSectionCodeRemap(
  importedSections: SectionInput[],
  parentSections: ReconstructedSection[],
): Map<string, string> {
  const remap = new Map<string, string>();

  // Top-level sections: match by name
  const parentTopByName = new Map<string, ReconstructedSection>();
  for (const ps of parentSections) {
    if (!ps.parentSectionCode) {
      parentTopByName.set(ps.name, ps);
    }
  }

  const importedTopByCode = new Map<string, SectionInput>();
  for (const is of importedSections) {
    if (!is.parentSectionCode) {
      importedTopByCode.set(is.sectionCode, is);
      const match = parentTopByName.get(is.name);
      if (match) {
        remap.set(is.sectionCode, match.sectionCode);
      }
    }
  }

  // Sub-sections: match by parentName + name
  const parentSubByKey = new Map<string, ReconstructedSection>();
  for (const ps of parentSections) {
    if (ps.parentSectionCode) {
      const parent = parentSections.find((s) => s.sectionCode === ps.parentSectionCode);
      if (parent) {
        parentSubByKey.set(`${parent.name}||${ps.name}`, ps);
      }
    }
  }

  for (const is of importedSections) {
    if (is.parentSectionCode) {
      const importedParent = importedTopByCode.get(is.parentSectionCode);
      if (importedParent) {
        const match = parentSubByKey.get(`${importedParent.name}||${is.name}`);
        if (match) {
          remap.set(is.sectionCode, match.sectionCode);
        }
      }
    }
  }

  return remap;
}

/**
 * Match imported items to parent items by itemNumber, building a remap
 * of importedItemCode → parentItemCode.
 *
 * For unique itemNumbers (1:1 in both parent and import) a simple match is used.
 * For duplicate itemNumbers (same catalogue item in multiple sections) we
 * disambiguate using the section context (remapped sectionCode).
 */
function buildItemCodeRemap(
  importedItems: BudgetItemInput[],
  parentItems: ReconstructedItem[],
  sectionRemap: Map<string, string>,
): Map<string, string> {
  const remap = new Map<string, string>();

  // Count occurrences in parent
  const parentCountByNum = new Map<string, number>();
  const parentByNum = new Map<string, ReconstructedItem>();
  for (const pi of parentItems) {
    if (pi.itemNumber) {
      parentCountByNum.set(pi.itemNumber, (parentCountByNum.get(pi.itemNumber) ?? 0) + 1);
      parentByNum.set(pi.itemNumber, pi);
    }
  }

  // Index parent items by itemNumber+sectionCode for duplicate disambiguation
  const parentByNumSection = new Map<string, ReconstructedItem>();
  for (const pi of parentItems) {
    if (pi.itemNumber && pi.sectionCode) {
      parentByNumSection.set(`${pi.itemNumber}||${pi.sectionCode}`, pi);
    }
  }

  // Count occurrences in imported
  const importedCountByNum = new Map<string, number>();
  for (const ii of importedItems) {
    if (ii.itemNumber) {
      importedCountByNum.set(ii.itemNumber, (importedCountByNum.get(ii.itemNumber) ?? 0) + 1);
    }
  }

  const usedParentCodes = new Set<string>();

  for (const ii of importedItems) {
    if (!ii.itemNumber) continue;
    const parentCount = parentCountByNum.get(ii.itemNumber) ?? 0;
    const importedCount = importedCountByNum.get(ii.itemNumber) ?? 0;

    if (parentCount === 1 && importedCount === 1) {
      // Unique match by itemNumber alone
      const parentItem = parentByNum.get(ii.itemNumber);
      if (parentItem && !usedParentCodes.has(parentItem.itemCode)) {
        remap.set(ii.itemCode, parentItem.itemCode);
        usedParentCodes.add(parentItem.itemCode);
      }
    } else if (parentCount >= 1 && importedCount >= 1) {
      // Duplicate itemNumber — disambiguate by section
      const remappedSectionCode = ii.sectionCode
        ? (sectionRemap.get(ii.sectionCode) ?? ii.sectionCode)
        : null;
      if (remappedSectionCode) {
        const key = `${ii.itemNumber}||${remappedSectionCode}`;
        const parentItem = parentByNumSection.get(key);
        if (parentItem && !usedParentCodes.has(parentItem.itemCode)) {
          remap.set(ii.itemCode, parentItem.itemCode);
          usedParentCodes.add(parentItem.itemCode);
        }
      }
    }
  }

  return remap;
}

/**
 * Apply code remaps to sections and items, then compute deltas vs parent.
 */
function applyRemapsAndComputeDeltas(
  importedSections: SectionInput[],
  importedItems: BudgetItemInput[],
  parentSections: ReconstructedSection[],
  parentItems: ReconstructedItem[],
): { deltaItems: DeltaItem[]; deltaSections: DeltaSection[] } {
  const sectionRemap = buildSectionCodeRemap(importedSections, parentSections);
  const itemRemap = buildItemCodeRemap(importedItems, parentItems, sectionRemap);

  // Apply section remap
  const remappedSections: SectionInput[] = importedSections.map((s) => ({
    ...s,
    sectionCode: sectionRemap.get(s.sectionCode) ?? s.sectionCode,
    parentSectionCode: s.parentSectionCode
      ? (sectionRemap.get(s.parentSectionCode) ?? s.parentSectionCode)
      : null,
  }));

  // Apply item remap (both itemCode and sectionCode)
  const remappedItems: BudgetItemInput[] = importedItems.map((i) => ({
    ...i,
    itemCode: itemRemap.get(i.itemCode) ?? i.itemCode,
    sectionCode: i.sectionCode
      ? (sectionRemap.get(i.sectionCode) ?? i.sectionCode)
      : null,
  }));

  // Now compute deltas: matching works because codes are aligned
  const deltaItems = computeItemDelta(parentItems, remappedItems);
  const deltaSections = computeSectionDelta(parentSections, remappedSections);

  return { deltaItems, deltaSections };
}

// ---- Delta computation (mirrors versions.ts logic) ----

interface DeltaItem extends BudgetItemInput {
  isDeleted: boolean;
}

interface DeltaSection extends SectionInput {
  isDeleted: boolean;
}

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

function computeItemDelta(
  parentItems: ReconstructedItem[],
  newItems: BudgetItemInput[],
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
        sectionCode: item.sectionCode,
        alternativeOfItemCode: item.alternativeOfItemCode,
        isDeleted: true,
      });
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
  newSections: SectionInput[],
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

  for (const [code] of parentMap) {
    if (!newMap.has(code)) {
      const sec = parentMap.get(code)!;
      delta.push({
        sectionCode: sec.sectionCode,
        parentSectionCode: sec.parentSectionCode,
        name: sec.name,
        sequenceNo: sec.sequenceNo,
        isDeleted: true,
      });
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

// ---- Main import action ----

export async function importVersionWithItems(
  input: ImportVersionInput
): Promise<{ success: boolean; data?: VersionInfo; error?: string }> {
  const { budgetId, parentId, versionName, versionType, partnerId, sections, items } = input;

  if (!versionName || versionName.trim().length === 0) {
    return { success: false, error: "A verzió neve kötelező" };
  }
  if (items.length === 0) {
    return { success: false, error: "Nincsenek importálható tételek" };
  }

  try {
    // Create version
    const [created] = await db
      .insert(versions)
      .values({
        budgetId,
        parentId,
        versionName: versionName.trim(),
        versionType,
        partnerId,
      })
      .returning();

    if (parentId) {
      // Fetch parent's reconstructed items/sections
      const [parentItems, parentSections] = await Promise.all([
        getVersionItems(parentId),
        getVersionSections(parentId),
      ]);

      // Smart match by itemNumber/sectionName, then compute minimal delta
      const { deltaItems, deltaSections } = applyRemapsAndComputeDeltas(
        sections,
        items,
        parentSections,
        parentItems,
      );

      await persistDeltaItems(created.id, deltaItems);
      await persistDeltaSections(created.id, deltaSections);
    } else {
      // Root version — insert all items and sections directly
      if (items.length > 0) {
        await db.insert(budgetItems).values(
          items.map((item) => ({
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
            sectionCode: item.sectionCode ?? null,
            isDeleted: false,
          }))
        );
      }

      if (sections.length > 0) {
        await db.insert(budgetSections).values(
          sections.map((sec) => ({
            versionId: created.id,
            sectionCode: sec.sectionCode,
            parentSectionCode: sec.parentSectionCode ?? null,
            name: sec.name,
            sequenceNo: sec.sequenceNo,
            isDeleted: false,
          }))
        );
      }
    }

    // Fetch partner name
    let partnerName: string | null = null;
    if (created.partnerId) {
      const partners = await getPartnersForVersionSelect();
      const p = partners.find((p) => p.id === created.partnerId);
      partnerName = p?.name ?? null;
    }

    return {
      success: true,
      data: {
        id: created.id,
        budgetId: created.budgetId,
        parentId: created.parentId,
        versionName: created.versionName,
        versionType: created.versionType as VersionType,
        partnerId: created.partnerId,
        partnerName,
        originalFileName: created.originalFileName ?? null,
        originalFilePath: created.originalFilePath ?? null,
        notes: created.notes ?? null,
        createdAt: created.createdAt,
        hasChildren: false,
      },
    };
  } catch (err) {
    console.error("Import error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Ismeretlen hiba történt az importálás során",
    };
  }
}
