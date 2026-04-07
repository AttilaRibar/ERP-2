/**
 * Maps generic parsed Excel data to budget-specific DB structures
 * (BudgetItemInput + SectionInput).
 *
 * Supports "smart matching" against a parent version's items/sections so that
 * matching items reuse the same itemCode/sectionCode — enabling proper delta
 * tracking instead of treating every row as delete+add.
 */
import type { ParsedBudgetItem, ExcelParseResult } from "./excel-parser";
import type { BudgetItemInput, SectionInput, ReconstructedItem, ReconstructedSection } from "@/server/actions/versions";

export interface MappedBudgetData {
  sections: SectionInput[];
  items: BudgetItemInput[];
}

/** Parent version data for smart matching */
export interface ParentVersionData {
  items: ReconstructedItem[];
  sections: ReconstructedSection[];
}

function generateUUID(): string {
  return crypto.randomUUID();
}

/**
 * Convert ExcelParseResult into sections + items ready for DB insertion.
 * Main categories (worksheet names) → top-level sections (parentSectionCode = null)
 * Sub-categories within worksheets → child sections
 *
 * If `parentData` is provided, items and sections are matched by itemNumber /
 * section name to reuse the parent's UUIDs, enabling proper delta tracking.
 */
export function mapParsedDataToBudget(
  parsed: ExcelParseResult,
  parentData?: ParentVersionData,
): MappedBudgetData {
  const sections: SectionInput[] = [];
  const items: BudgetItemInput[] = [];

  // Parent lookup maps for smart matching
  // Items: match by itemNumber (tételszám)
  const parentItemByNumber = new Map<string, ReconstructedItem>();
  // Track how many times each itemNumber appears to handle duplicates
  const parentItemCountByNumber = new Map<string, number>();
  // Index parent items by itemNumber+sectionCode for duplicate disambiguation
  const parentItemByNumSection = new Map<string, ReconstructedItem>();
  if (parentData) {
    for (const pi of parentData.items) {
      if (pi.itemNumber) {
        parentItemCountByNumber.set(pi.itemNumber, (parentItemCountByNumber.get(pi.itemNumber) ?? 0) + 1);
        parentItemByNumber.set(pi.itemNumber, pi);
        if (pi.sectionCode) {
          parentItemByNumSection.set(`${pi.itemNumber}||${pi.sectionCode}`, pi);
        }
      }
    }
  }

  // Sections: match by name (exact) — top-level sections by name, sub-sections by parent+name
  const parentTopSectionByName = new Map<string, ReconstructedSection>();
  const parentSubSectionByKey = new Map<string, ReconstructedSection>();
  if (parentData) {
    for (const ps of parentData.sections) {
      if (!ps.parentSectionCode) {
        parentTopSectionByName.set(ps.name, ps);
      } else {
        // Find parent section name for compound key
        const parentSec = parentData.sections.find(s => s.sectionCode === ps.parentSectionCode);
        if (parentSec) {
          parentSubSectionByKey.set(`${parentSec.name}||${ps.name}`, ps);
        }
      }
    }
  }

  const mainCatCodes = new Map<string, string>();
  const subCatCodes = new Map<string, string>(); // key: "main||sub"

  let sectionSeq = 0;
  let itemSeq = 0;

  // Track used parent itemCodes to avoid double-matching duplicates
  const usedParentItemCodes = new Set<string>();

  // First pass: create all sections (matching parent sections by name)
  for (const summary of parsed.sheetSummaries) {
    const parentTopSection = parentTopSectionByName.get(summary.sheetName);
    const mainCode = parentTopSection?.sectionCode ?? generateUUID();
    mainCatCodes.set(summary.sheetName, mainCode);
    sectionSeq++;
    sections.push({
      sectionCode: mainCode,
      parentSectionCode: null,
      name: summary.sheetName,
      sequenceNo: sectionSeq,
    });

    for (const sub of summary.subCategories) {
      const subKey = `${summary.sheetName}||${sub}`;
      const parentSubSection = parentSubSectionByKey.get(subKey);
      const subCode = parentSubSection?.sectionCode ?? generateUUID();
      subCatCodes.set(subKey, subCode);
      sectionSeq++;
      sections.push({
        sectionCode: subCode,
        parentSectionCode: mainCode,
        name: sub,
        sequenceNo: sectionSeq,
      });
    }
  }

  // Second pass: map items (matching parent items by itemNumber)
  for (const item of parsed.items) {
    itemSeq++;

    // Determine which section this item belongs to
    let sectionCode: string | null = null;
    if (item.subCategory) {
      const subKey = `${item.mainCategory}||${item.subCategory}`;
      sectionCode = subCatCodes.get(subKey) ?? mainCatCodes.get(item.mainCategory) ?? null;
    } else {
      sectionCode = mainCatCodes.get(item.mainCategory) ?? null;
    }

    // Try to match with parent item by itemNumber
    let itemCode = generateUUID();
    if (parentData && item.itemNumber) {
      const count = parentItemCountByNumber.get(item.itemNumber) ?? 0;
      if (count === 1) {
        // Unique match by itemNumber alone
        const parentItem = parentItemByNumber.get(item.itemNumber);
        if (parentItem && !usedParentItemCodes.has(parentItem.itemCode)) {
          itemCode = parentItem.itemCode;
          usedParentItemCodes.add(parentItem.itemCode);
        }
      } else if (count > 1 && sectionCode) {
        // Duplicate itemNumber — disambiguate by matching section
        const key = `${item.itemNumber}||${sectionCode}`;
        const parentItem = parentItemByNumSection.get(key);
        if (parentItem && !usedParentItemCodes.has(parentItem.itemCode)) {
          itemCode = parentItem.itemCode;
          usedParentItemCodes.add(parentItem.itemCode);
        }
      }
    }

    items.push({
      itemCode,
      sequenceNo: itemSeq,
      itemNumber: item.itemNumber,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      materialUnitPrice: item.materialUnitPrice,
      feeUnitPrice: item.feeUnitPrice,
      notes: "",
      sectionCode,
      alternativeOfItemCode: null,
    });
  }

  return { sections, items };
}
