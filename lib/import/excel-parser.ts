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

/** Column mapping for a sheet — detected dynamically from the header row */
interface ColumnMap {
  SSZ: number;
  ITEM_NUM: number | null; // null for gyengeáram (no tételszám column)
  NAME: number;
  QUANTITY: number;
  UNIT: number;
  MAT_UNIT: number;
  FEE_UNIT: number;
  MAT_TOTAL: number;
  FEE_TOTAL: number;
}

/** Standard 9-column layout (Ssz | Tételszám | Tétel szövege | Menny | Egység | Anyag | Díj | Anyag össz | Díj össz) */
const COL_STANDARD: ColumnMap = {
  SSZ: 0, ITEM_NUM: 1, NAME: 2, QUANTITY: 3, UNIT: 4,
  MAT_UNIT: 5, FEE_UNIT: 6, MAT_TOTAL: 7, FEE_TOTAL: 8,
};

/** Gyengeáram 8-column layout (Tétel | Megnevezés | Mennyiség | Egység | Anyag egységár | Munkadíj egységár | Anyag összesen | Munkadíj összesen) */
const COL_GYENGERAM: ColumnMap = {
  SSZ: 0, ITEM_NUM: null, NAME: 1, QUANTITY: 2, UNIT: 3,
  MAT_UNIT: 4, FEE_UNIT: 5, MAT_TOTAL: 6, FEE_TOTAL: 7,
};

/** Gépész 10-column layout (Ssz | Tételszám | Tétel szövege | Menny | Egység | Egys. anyag | Egys. gépköltség | Egys. díj | Anyag összesen | Díj összesen) */
const COL_GEPESZ: ColumnMap = {
  SSZ: 0, ITEM_NUM: 1, NAME: 2, QUANTITY: 3, UNIT: 4,
  MAT_UNIT: 5, FEE_UNIT: 7, MAT_TOTAL: 8, FEE_TOTAL: 9,
};

/** Backward-compatible alias for code that uses COL.xxx directly */
const COL = COL_STANDARD;

/** Known header variations for standard format auto-detection */
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

/** Detect the column layout from a header row */
function detectColumnMap(row: unknown[]): { colMap: ColumnMap; headerIdx: number } | null {
  if (!row || row.length < 5) return null;
  const cells = row.map((c) => (typeof c === "string" ? c.trim().toLowerCase() : ""));

  // Standard format: check positional patterns
  const stdMatches = cells.slice(0, 9).filter((cell, i) => HEADER_PATTERNS[i]?.test(cell));
  if (stdMatches.length >= 3) {
    // Check if there's an extra "gépköltség" column (gépész layout)
    const hasGepkoltseg = cells.some((c) => /g[eé]pk[oö]lts[eé]g/i.test(c));
    if (hasGepkoltseg) {
      return { colMap: COL_GEPESZ, headerIdx: -1 };
    }
    return { colMap: COL_STANDARD, headerIdx: -1 };
  }

  // Gyengeáram format: "Tétel" + "Megnevezés" + "Mennyiség" + "Egység"
  const hasTétel = cells.some((c) => /^t[eé]tel$/i.test(c));
  const hasMegnevezés = cells.some((c) => /^megnevez[eé]s$/i.test(c));
  const hasMennyiség = cells.some((c) => /^mennyis[eé]g$/i.test(c));
  if (hasTétel && hasMegnevezés && hasMennyiség) {
    return { colMap: COL_GYENGERAM, headerIdx: -1 };
  }

  return null;
}

/** Check if a row is any recognized header row */
function isAnyHeaderRow(row: unknown[]): boolean {
  return detectColumnMap(row) !== null;
}

/** Sheets to skip (no budget items expected) */
const SKIP_SHEET_PATTERNS = [
  /z[aá]rad[eé]k/i,
  /fejezet\s*[oö]sszesít/i,
  /[oö]sszesít[oő]/i,
  /^[oö]sszesít[oő]/i,
  /^munkanem\s*[oö]sszesít/i,
  /summary/i,
  /cover/i,
];

function shouldSkipSheet(name: string): boolean {
  return SKIP_SHEET_PATTERNS.some((p) => p.test(name));
}

function isHeaderRow(row: unknown[]): boolean {
  return isAnyHeaderRow(row);
}

function isEmptyCell(val: unknown): boolean {
  return val === "" || val === undefined || val === null || val === 0;
}

function isSummaryRow(row: unknown[], col: ColumnMap = COL_STANDARD): boolean {
  const check = (text: string) =>
    text.includes("fejezet összesen") ||
    text.includes("összesen:") ||
    text.includes("összesen (huf)") ||
    text.includes("mindösszesen");
  const nameText = String(row[col.NAME] ?? "").toLowerCase();
  if (check(nameText)) return true;
  // Also check Tételszám column — some formats place summary text there
  if (col.ITEM_NUM !== null) {
    const itemText = String(row[col.ITEM_NUM] ?? "").toLowerCase();
    if (check(itemText)) return true;
  }
  return false;
}

function isCategoryRow(row: unknown[], col: ColumnMap = COL_STANDARD): boolean {
  const ssz = row[col.SSZ];
  const numericEmpty = isEmptyCell(row[col.QUANTITY]) && isEmptyCell(row[col.MAT_UNIT]) && isEmptyCell(row[col.FEE_UNIT]);

  // Pattern 1: Category text in SSZ column (col[0])
  if (typeof ssz === "string" && ssz.trim().length > 0 && numericEmpty) {
    return true;
  }

  // Pattern 2: Category text in name column with SSZ empty — common in Hungarian
  // construction budgets where the munkanem/category name appears in the name
  // or item number column with SSZ and all other data columns empty
  const nameVal = row[col.NAME];
  if (
    typeof nameVal === "string" &&
    nameVal.trim().length > 0 &&
    isEmptyCell(ssz) &&
    numericEmpty
  ) {
    // For standard layout, only match if NAME col is empty and text is in ITEM_NUM
    // For gyengeáram layout (no ITEM_NUM), text in NAME col is the category
    if (col.ITEM_NUM === null) {
      return true;
    }
  }

  // Pattern 3: Category text in Tételszám column (col[1]) for standard layout
  if (col.ITEM_NUM !== null) {
    const itemNum = row[col.ITEM_NUM];
    if (
      typeof itemNum === "string" &&
      itemNum.trim().length > 0 &&
      isEmptyCell(ssz) &&
      isEmptyCell(row[col.NAME]) &&
      numericEmpty
    ) {
      return true;
    }
  }

  return false;
}

/** Extract the category name from a row detected as a category row */
function getCategoryName(row: unknown[], col: ColumnMap = COL_STANDARD): string {
  const ssz = String(row[col.SSZ] ?? "").trim();
  if (ssz) return ssz;
  if (col.ITEM_NUM !== null) {
    const itemNum = String(row[col.ITEM_NUM] ?? "").trim();
    if (itemNum) return itemNum;
  }
  return String(row[col.NAME] ?? "").trim();
}

function isDataRow(row: unknown[], col: ColumnMap = COL_STANDARD): boolean {
  const ssz = row[col.SSZ];
  const name = row[col.NAME];
  // Accept both numeric SSZ and text-formatted numeric SSZ
  const sszNum = typeof ssz === "number" ? ssz
    : (typeof ssz === "string" ? parseFloat(ssz.replace(/\s/g, "")) : NaN);
  return (
    !isNaN(sszNum) &&
    sszNum > 0 &&
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
    // Check if any sheet has the expected header structure (standard or gyengeáram)
    for (const name of workbook.SheetNames) {
      const ws = workbook.Sheets[name];
      if (!ws) continue;
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];
      const maxScan = Math.min(data.length, 20);
      for (let i = 0; i < maxScan; i++) {
        if (isAnyHeaderRow(data[i])) return true;
      }
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

      // Find the header row and detect column layout
      let headerRowIdx = -1;
      let col: ColumnMap = COL_STANDARD;
      const maxScan = Math.min(data.length, 20);
      for (let i = 0; i < maxScan; i++) {
        const detected = detectColumnMap(data[i]);
        if (detected) {
          headerRowIdx = i;
          col = detected.colMap;
          break;
        }
      }

      for (let rowIdx = 0; rowIdx < data.length; rowIdx++) {
        const row = data[rowIdx];
        if (!row || row.length === 0) continue;

        // Skip rows up to and including the header row (title/metadata rows)
        if (headerRowIdx >= 0 && rowIdx <= headerRowIdx) continue;

        // Skip additional header rows (e.g. repeated headers from merged cells)
        if (isHeaderRow(row)) continue;

        // Skip summary row
        if (isSummaryRow(row, col)) continue;

        // Category row
        if (isCategoryRow(row, col)) {
          currentSubCategory = getCategoryName(row, col);
          if (currentSubCategory) subCategories.add(currentSubCategory);
          continue;
        }

        // Data row
        if (isDataRow(row, col)) {
          seqCounter++;
          const quantity = toNumber(row[col.QUANTITY]);
          const matUnit = toNumber(row[col.MAT_UNIT]);
          const feeUnit = toNumber(row[col.FEE_UNIT]);
          const matTotal = quantity * matUnit;
          const feeTotal = quantity * feeUnit;

          // Verify totals match Excel (warning if not)
          const excelMatTotal = toNumber(row[col.MAT_TOTAL]);
          const excelFeeTotal = toNumber(row[col.FEE_TOTAL]);
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
            itemNumber: col.ITEM_NUM !== null ? String(row[col.ITEM_NUM] ?? "").trim() : "",
            name: String(row[col.NAME] ?? "").trim(),
            quantity,
            unit: String(row[col.UNIT] ?? "").trim(),
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
