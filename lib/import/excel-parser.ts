/**
 * Generic Excel parser module.
 * Designed for extensibility — different strategies can be plugged in to handle
 * various Excel layouts. The default strategy handles the Hungarian construction
 * budget format (költségvetés).
 */
import * as XLSX from "xlsx";

// ---- Public types ----

/** A single parsed budget line item */
export interface ParsedBudgetItem {
  sequenceNo: number;
  itemNumber: string;
  name: string;
  quantity: number;
  unit: string;
  materialUnitPrice: number;
  feeUnitPrice: number;
  /** Computed: quantity × materialUnitPrice */
  materialTotal: number;
  /** Computed: quantity × feeUnitPrice */
  feeTotal: number;
  /** Main category (worksheet name) */
  mainCategory: string;
  /** Sub-category within the worksheet (e.g. "71 Elektromosenergia-ellátás") */
  subCategory: string | null;
}

/** Warning / skipped row info */
export interface ParseWarning {
  sheet: string;
  row: number;
  message: string;
  rawData?: unknown[];
}

/** Full result of parsing an Excel file */
export interface ExcelParseResult {
  items: ParsedBudgetItem[];
  warnings: ParseWarning[];
  /** Sheets that were skipped (no items found) */
  skippedSheets: string[];
  /** Per-sheet summary */
  sheetSummaries: SheetSummary[];
  /** Grand totals */
  totals: {
    materialTotal: number;
    feeTotal: number;
    itemCount: number;
  };
}

export interface SheetSummary {
  sheetName: string;
  itemCount: number;
  materialTotal: number;
  feeTotal: number;
  subCategories: string[];
}

// ---- Strategy interface for future extensibility ----

export interface ExcelParseStrategy {
  /** Returns true if this strategy can handle the given workbook */
  canHandle(workbook: XLSX.WorkBook): boolean;
  /** Parse the workbook using this strategy */
  parse(workbook: XLSX.WorkBook): ExcelParseResult;
}

// ---- Hungarian budget format strategy ----

/** Column indices for the standard Hungarian budget format */
const COL = {
  SSZ: 0,         // Sorszám (sequence number)
  ITEM_NUM: 1,    // Tételszám (item code)
  NAME: 2,        // Tétel szövege (description)
  QUANTITY: 3,    // Mennyiség
  UNIT: 4,        // Egység
  MAT_UNIT: 5,    // Anyag egységár
  FEE_UNIT: 6,    // Díj egységár
  MAT_TOTAL: 7,   // Anyag összesen
  FEE_TOTAL: 8,   // Díj összesen
} as const;

/** Known header variations for auto-detection */
const HEADER_PATTERNS = [
  /^ssz\.?$/i,
  /^t[eé]telsz[aá]m$/i,
  /^t[eé]tel\s*sz[oö]veg/i,
  /^menny/i,
  /^egys[eé]g$/i,
  /^anyag\s*egys[eé]g/i,
  /^d[ií]j\s*egys[eé]g/i,
  /^anyag\s*[oö]sszesen$/i,
  /^d[ií]j\s*[oö]sszesen$/i,
];

/** Sheets to skip (no budget items expected) */
const SKIP_SHEET_PATTERNS = [
  /z[aá]rad[eé]k/i,
  /fejezet\s*[oö]sszesít/i,
  /[oö]sszesít[oő]/i,
  /summary/i,
  /cover/i,
];

function shouldSkipSheet(name: string): boolean {
  return SKIP_SHEET_PATTERNS.some((p) => p.test(name));
}

function isHeaderRow(row: unknown[]): boolean {
  if (!row || row.length < 5) return false;
  const matches = row
    .slice(0, 9)
    .filter((cell, i) => {
      if (typeof cell !== "string") return false;
      return HEADER_PATTERNS[i]?.test(cell.trim());
    });
  return matches.length >= 3;
}

function isSummaryRow(row: unknown[]): boolean {
  const text = String(row[COL.NAME] ?? "").toLowerCase();
  return (
    text.includes("fejezet összesen") ||
    text.includes("összesen:") ||
    text.includes("mindösszesen")
  );
}

function isCategoryRow(row: unknown[]): boolean {
  const ssz = row[COL.SSZ];
  const name = row[COL.NAME];
  // Category rows have text in first column and nothing or empty in the item columns
  if (typeof ssz === "string" && ssz.trim().length > 0) {
    // Check no numeric data in quantity/price columns
    const q = row[COL.QUANTITY];
    const matUnit = row[COL.MAT_UNIT];
    const feeUnit = row[COL.FEE_UNIT];
    if (
      (q === "" || q === undefined || q === null || q === 0) &&
      (matUnit === "" || matUnit === undefined || matUnit === null || matUnit === 0) &&
      (feeUnit === "" || feeUnit === undefined || feeUnit === null || feeUnit === 0)
    ) {
      return true;
    }
  }
  return false;
}

function isDataRow(row: unknown[]): boolean {
  const ssz = row[COL.SSZ];
  const name = row[COL.NAME];
  return (
    typeof ssz === "number" &&
    ssz > 0 &&
    typeof name === "string" &&
    name.trim().length > 0
  );
}

function toNumber(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const cleaned = val.replace(/\s/g, "").replace(",", ".");
    const n = Number(cleaned);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

export class HungarianBudgetStrategy implements ExcelParseStrategy {
  canHandle(workbook: XLSX.WorkBook): boolean {
    // Check if any sheet has the expected header structure
    for (const name of workbook.SheetNames) {
      const ws = workbook.Sheets[name];
      if (!ws) continue;
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];
      if (data.length > 0 && isHeaderRow(data[0])) return true;
    }
    // Also check for "Fejezet összesítő" or "Záradék" sheets
    return workbook.SheetNames.some(
      (n) => /fejezet/i.test(n) || /z[aá]rad[eé]k/i.test(n)
    );
  }

  parse(workbook: XLSX.WorkBook): ExcelParseResult {
    const items: ParsedBudgetItem[] = [];
    const warnings: ParseWarning[] = [];
    const skippedSheets: string[] = [];
    const sheetSummaries: SheetSummary[] = [];

    for (const sheetName of workbook.SheetNames) {
      if (shouldSkipSheet(sheetName)) {
        skippedSheets.push(sheetName);
        continue;
      }

      const ws = workbook.Sheets[sheetName];
      if (!ws) {
        skippedSheets.push(sheetName);
        continue;
      }

      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];
      if (data.length === 0) {
        skippedSheets.push(sheetName);
        continue;
      }

      let currentSubCategory: string | null = null;
      let sheetItemCount = 0;
      let sheetMaterialTotal = 0;
      let sheetFeeTotal = 0;
      const subCategories: Set<string> = new Set();
      let seqCounter = 0;

      for (let rowIdx = 0; rowIdx < data.length; rowIdx++) {
        const row = data[rowIdx];
        if (!row || row.length === 0) continue;

        // Skip header row
        if (isHeaderRow(row)) continue;

        // Skip summary row
        if (isSummaryRow(row)) continue;

        // Category row
        if (isCategoryRow(row)) {
          currentSubCategory = String(row[COL.SSZ]).trim();
          subCategories.add(currentSubCategory);
          continue;
        }

        // Data row
        if (isDataRow(row)) {
          seqCounter++;
          const quantity = toNumber(row[COL.QUANTITY]);
          const matUnit = toNumber(row[COL.MAT_UNIT]);
          const feeUnit = toNumber(row[COL.FEE_UNIT]);
          const matTotal = quantity * matUnit;
          const feeTotal = quantity * feeUnit;

          // Verify totals match Excel (warning if not)
          const excelMatTotal = toNumber(row[COL.MAT_TOTAL]);
          const excelFeeTotal = toNumber(row[COL.FEE_TOTAL]);
          if (excelMatTotal !== 0 && Math.abs(matTotal - excelMatTotal) > 1) {
            warnings.push({
              sheet: sheetName,
              row: rowIdx + 1,
              message: `Anyag összeg eltérés: számított ${matTotal} vs Excel ${excelMatTotal}`,
              rawData: row.slice(0, 9),
            });
          }
          if (excelFeeTotal !== 0 && Math.abs(feeTotal - excelFeeTotal) > 1) {
            warnings.push({
              sheet: sheetName,
              row: rowIdx + 1,
              message: `Díj összeg eltérés: számított ${feeTotal} vs Excel ${excelFeeTotal}`,
              rawData: row.slice(0, 9),
            });
          }

          items.push({
            sequenceNo: seqCounter,
            itemNumber: String(row[COL.ITEM_NUM] ?? "").trim(),
            name: String(row[COL.NAME] ?? "").trim(),
            quantity,
            unit: String(row[COL.UNIT] ?? "").trim(),
            materialUnitPrice: matUnit,
            feeUnitPrice: feeUnit,
            materialTotal: matTotal,
            feeTotal: feeTotal,
            mainCategory: sheetName,
            subCategory: currentSubCategory,
          });

          sheetItemCount++;
          sheetMaterialTotal += matTotal;
          sheetFeeTotal += feeTotal;
          continue;
        }

        // Non-empty row that's not recognized
        const nonEmpty = row.filter(
          (c) => c !== "" && c !== null && c !== undefined
        );
        if (nonEmpty.length > 1) {
          warnings.push({
            sheet: sheetName,
            row: rowIdx + 1,
            message: "Nem felismerhető sor — kihagyva",
            rawData: row.slice(0, 9),
          });
        }
      }

      if (sheetItemCount === 0) {
        skippedSheets.push(sheetName);
      } else {
        sheetSummaries.push({
          sheetName,
          itemCount: sheetItemCount,
          materialTotal: sheetMaterialTotal,
          feeTotal: sheetFeeTotal,
          subCategories: Array.from(subCategories),
        });
      }
    }

    return {
      items,
      warnings,
      skippedSheets,
      sheetSummaries,
      totals: {
        materialTotal: items.reduce((s, i) => s + i.materialTotal, 0),
        feeTotal: items.reduce((s, i) => s + i.feeTotal, 0),
        itemCount: items.length,
      },
    };
  }
}

// ---- Main parse function ----

const strategies: ExcelParseStrategy[] = [new HungarianBudgetStrategy()];

/**
 * Register an additional parse strategy.
 * Strategies are tested in registration order; first match wins.
 */
export function registerStrategy(strategy: ExcelParseStrategy): void {
  strategies.push(strategy);
}

/**
 * Parse an Excel file buffer into budget items.
 * Automatically selects the appropriate parsing strategy.
 */
export function parseExcelBuffer(buffer: ArrayBuffer): ExcelParseResult {
  const workbook = XLSX.read(buffer, { type: "array" });

  for (const strategy of strategies) {
    if (strategy.canHandle(workbook)) {
      return strategy.parse(workbook);
    }
  }

  // Fallback: try Hungarian strategy anyway (most common use case)
  return new HungarianBudgetStrategy().parse(workbook);
}
