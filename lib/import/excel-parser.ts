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
  /** Original worksheet before any import-time category wrapping. */
  sourceSheet: string;
  /** 1-based Excel row number. */
  sourceRow: number;
  /** Filled by the import UI when multiple files are merged. */
  sourceFileName?: string;
}

/** Detailed parser diagnostic tied to a concrete Excel row. */
export interface ParseIssue {
  sheet: string;
  row: number;
  message: string;
  fileName?: string;
  rawData?: unknown[];
}

/** Backward-compatible alias for older import UI code paths. */
export type ParseWarning = ParseIssue;

/** Full result of parsing an Excel file */
export interface ExcelParseResult {
  items: ParsedBudgetItem[];
  readErrors: ParseIssue[];
  formulaErrors: ParseIssue[];
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

/**
 * Column mapping for a sheet — detected dynamically from the header row.
 * Indices that are not present in the workbook are set to -1 (or null for ITEM_NUM).
 * The required columns are NAME, QUANTITY, UNIT, MAT_UNIT, FEE_UNIT, MAT_TOTAL, FEE_TOTAL.
 */
interface ColumnMap {
  /** Sequence number column. -1 if absent. */
  SSZ: number;
  /** Item number / type / code column. null if absent. */
  ITEM_NUM: number | null;
  NAME: number;
  QUANTITY: number;
  UNIT: number;
  MAT_UNIT: number;
  FEE_UNIT: number;
  MAT_TOTAL: number;
  FEE_TOTAL: number;
}

/** Default fallback used only by helpers that need a value before detection — never used for parsing. */
const COL_DEFAULT: ColumnMap = {
  SSZ: 0, ITEM_NUM: 1, NAME: 2, QUANTITY: 3, UNIT: 4,
  MAT_UNIT: 5, FEE_UNIT: 6, MAT_TOTAL: 7, FEE_TOTAL: 8,
};

/** Normalize a header cell for matching: lowercase, collapse whitespace, drop diacritics handled via regex classes. */
function normHeader(c: unknown): string {
  if (typeof c !== "string") return "";
  return c.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Role-based header detection.
 * Each cell is classified into a role by matching against text patterns.
 * Works for any layout containing the required columns regardless of order or extra columns.
 */
function detectColumnMap(row: unknown[]): ColumnMap | null {
  if (!row || row.length < 5) return null;
  const cells = row.map(normHeader);

  // Need at least a few non-empty header-ish cells
  if (cells.filter((c) => c.length > 0).length < 4) return null;

  let SSZ = -1;
  let ITEM_NUM: number | null = null;
  let NAME = -1;
  let QUANTITY = -1;
  let UNIT = -1;
  let MAT_UNIT = -1;
  let FEE_UNIT = -1;
  let MAT_TOTAL = -1;
  let FEE_TOTAL = -1;

  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (!c) continue;

    const isAnyag = /anyag/.test(c);
    const isDij = /(d[ií]j|munkad[ií]j|b[eé]r)/.test(c);
    const isOssz = /[oö]ssz/.test(c); // összeg / összesen
    const isEgys = /(egys[eé]g[aá]r|egys[eé]g\s*[aá]r|egys[.\s]|^egys[eé]g$|^egys[eé]g[aá]r$)/.test(c);

    // Totals (must be checked before unit prices because both contain "anyag"/"díj")
    if (MAT_TOTAL < 0 && isAnyag && isOssz) { MAT_TOTAL = i; continue; }
    if (FEE_TOTAL < 0 && isDij && isOssz) { FEE_TOTAL = i; continue; }

    // Unit prices
    if (MAT_UNIT < 0 && isAnyag && (isEgys || /anyag\s*egys|egys[.\s]*anyag/.test(c)) && !isOssz) {
      MAT_UNIT = i; continue;
    }
    if (FEE_UNIT < 0 && isDij && (isEgys || /(d[ií]j|munkad[ií]j)\s*egys|egys[.\s]*(d[ií]j|munkad[ií]j)/.test(c)) && !isOssz) {
      FEE_UNIT = i; continue;
    }

    // Sequence number — also match bare "Tétel" / "Sorszám" used as a sequence column
    // in shorter layouts that don't have a separate Tételszám/item-number column.
    if (SSZ < 0 && /^(ssz\.?|sorsz[aá]m|s\.sz\.?|#|t[eé]tel)$/.test(c)) { SSZ = i; continue; }

    // Item number / code / type column
    if (
      ITEM_NUM === null &&
      /^(t[eé]telsz[aá]m|t[eé]tel\s*sz[aá]ma|t[ií]pus|cikksz[aá]m|cikk\s*sz[aá]m|term[eé]k\s*k[oó]d|k[oó]d|cikk|sku)$/.test(c)
    ) { ITEM_NUM = i; continue; }

    // Quantity
    if (
      QUANTITY < 0 &&
      /^(menny\.?|mennyis[eé]g|m\.|db|darab|qty|quantity)$/.test(c)
    ) { QUANTITY = i; continue; }

    // Unit
    if (
      UNIT < 0 &&
      /^(egys[eé]g|m\.?\s*e\.?|m[eé]rt[eé]kegys[eé]g|unit|me)$/.test(c)
    ) { UNIT = i; continue; }

    // Name (longest / most descriptive label — prefer explicit "szöveg"/"megnevezés"/"leírás"/"tétel szövege")
    // Note: bare "tétel" is intentionally NOT matched here — it is treated as SSZ above
    // (used as a sequence-number column in compact layouts).
    if (
      NAME < 0 &&
      /(t[eé]tel\s*sz[oö]veg|megnevez[eé]s|le[ií]r[aá]s|t[eé]tel\s*neve|description|name|munkanem)/.test(c)
    ) { NAME = i; continue; }
  }

  // If NAME wasn't matched explicitly, try to infer it as the first non-empty header cell
  // that wasn't assigned to another role (best-effort fallback).
  if (NAME < 0) {
    const used = new Set<number>([
      SSZ, ITEM_NUM ?? -1, QUANTITY, UNIT, MAT_UNIT, FEE_UNIT, MAT_TOTAL, FEE_TOTAL,
    ]);
    for (let i = 0; i < cells.length; i++) {
      if (used.has(i)) continue;
      if (cells[i].length > 0) { NAME = i; break; }
    }
  }

  // Required: NAME, QUANTITY, UNIT, MAT_UNIT, FEE_UNIT, MAT_TOTAL, FEE_TOTAL
  if (NAME < 0 || QUANTITY < 0 || UNIT < 0 || MAT_UNIT < 0 || FEE_UNIT < 0 || MAT_TOTAL < 0 || FEE_TOTAL < 0) {
    return null;
  }

  return { SSZ, ITEM_NUM, NAME, QUANTITY, UNIT, MAT_UNIT, FEE_UNIT, MAT_TOTAL, FEE_TOTAL };
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

function isSummaryRow(row: unknown[], col: ColumnMap = COL_DEFAULT): boolean {
  const check = (text: string) => {
    const t = text.toLowerCase();
    return (
      /fejezet\s*[oö]sszesen/.test(t) ||
      /[oö]sszesen\s*:?/.test(t) ||
      /[oö]sszesen\s*\(huf\)/.test(t) ||
      /mind[oö]sszesen/.test(t) ||
      /^nett[oó]\b/.test(t) ||
      /^br[uú]tt[oó]\b/.test(t) ||
      /(^|[^a-záéíóöőúüű])[aá]fa(?![a-záéíóöőúüű])/.test(t) ||
      /total\b/.test(t)
    );
  };
  const nameText = String(row[col.NAME] ?? "");
  if (check(nameText)) return true;
  // Also check Sequence / Item-number column — some formats place summary text there
  if (col.SSZ >= 0) {
    const sszText = String(row[col.SSZ] ?? "");
    if (check(sszText)) return true;
  }
  if (col.ITEM_NUM !== null) {
    const itemText = String(row[col.ITEM_NUM] ?? "");
    if (check(itemText)) return true;
  }
  return false;
}

function isCategoryRow(row: unknown[], col: ColumnMap = COL_DEFAULT): boolean {
  const numericEmpty =
    isEmptyCell(row[col.QUANTITY]) &&
    isEmptyCell(row[col.MAT_UNIT]) &&
    isEmptyCell(row[col.FEE_UNIT]);
  if (!numericEmpty) return false;

  const sszVal = col.SSZ >= 0 ? row[col.SSZ] : "";
  const sszEmpty = isEmptyCell(sszVal);

  // Pattern 1: Category text in SSZ column with all numeric data empty (legacy standard layout)
  if (col.SSZ >= 0 && typeof sszVal === "string" && sszVal.trim().length > 0) {
    return true;
  }

  // Pattern 2: Category text in NAME column with SSZ empty and item-number column either empty
  // or absent — typical for layouts without a separate item-number column.
  const nameVal = row[col.NAME];
  if (typeof nameVal === "string" && nameVal.trim().length > 0 && sszEmpty) {
    if (col.ITEM_NUM === null) return true;
    if (isEmptyCell(row[col.ITEM_NUM])) return true;
  }

  // Pattern 3: Category text in Tételszám / Típus column with SSZ + NAME empty (standard layout)
  if (col.ITEM_NUM !== null) {
    const itemNum = row[col.ITEM_NUM];
    if (
      typeof itemNum === "string" &&
      itemNum.trim().length > 0 &&
      sszEmpty &&
      isEmptyCell(row[col.NAME])
    ) {
      return true;
    }
  }

  return false;
}

/** Extract the category name from a row detected as a category row */
function getCategoryName(row: unknown[], col: ColumnMap = COL_DEFAULT): string {
  if (col.SSZ >= 0) {
    const ssz = String(row[col.SSZ] ?? "").trim();
    if (ssz) return ssz;
  }
  if (col.ITEM_NUM !== null) {
    const itemNum = String(row[col.ITEM_NUM] ?? "").trim();
    if (itemNum) return itemNum;
  }
  return String(row[col.NAME] ?? "").trim();
}

function isDataRow(row: unknown[], col: ColumnMap = COL_DEFAULT): boolean {
  const name = row[col.NAME];
  if (typeof name !== "string" || name.trim().length === 0) return false;

  // Quantity must be a positive number (or numeric-text)
  const qty = toNumber(row[col.QUANTITY]);
  if (!(qty > 0)) return false;

  // If SSZ column exists, it should be numeric/positive when present — but accept missing too,
  // because some layouts have an SSZ column that's only filled for some rows.
  if (col.SSZ >= 0) {
    const ssz = row[col.SSZ];
    if (!isEmptyCell(ssz)) {
      const sszNum = typeof ssz === "number"
        ? ssz
        : (typeof ssz === "string" ? parseFloat(ssz.replace(/\s/g, "")) : NaN);
      // A row with non-numeric SSZ text and a summary keyword is a summary, not data
      if (isNaN(sszNum) && /[oö]ssz|nett[oó]|br[uú]tt[oó]|[aá]fa/.test(String(ssz).toLowerCase())) {
        return false;
      }
    } else if (col.ITEM_NUM === null) {
      // Layouts without an item-number column: an empty SSZ cell + qty>0 is unusual.
      // Don't reject outright (older files do this); fall through.
    }
  } else {
    // No SSZ column at all — qty > 0 + name non-empty is enough; we still want a unit.
    const unit = row[col.UNIT];
    if (typeof unit !== "string" || unit.trim().length === 0) return false;
  }

  return true;
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

/**
 * Returns true if a cell contains an explicit numeric value (including an explicit 0),
 * as opposed to being empty / null / blank string. Used to decide whether to trust
 * an Excel-stored total over a computed (qty × unitPrice) value — an explicit 0 in
 * a totals column typically means the row is intentionally excluded (e.g. "K"-marked
 * subcontractor items where material cost is manually zeroed out).
 */
function hasNumericValue(val: unknown): boolean {
  if (typeof val === "number") return !isNaN(val);
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed.length === 0) return false;
    const cleaned = trimmed.replace(/\s/g, "").replace(",", ".");
    return !isNaN(Number(cleaned));
  }
  return false;
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
    const readErrors: ParseIssue[] = [];
    const formulaErrors: ParseIssue[] = [];
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

      // Find the header row and detect column layout.
      // Scan up to the first 30 rows to allow for sheets with extensive metadata preambles.
      let headerRowIdx = -1;
      let col: ColumnMap = COL_DEFAULT;
      const maxScan = Math.min(data.length, 30);
      for (let i = 0; i < maxScan; i++) {
        const detected = detectColumnMap(data[i]);
        if (detected) {
          headerRowIdx = i;
          col = detected;
          break;
        }
      }

      // No recognizable header in this sheet — skip it
      if (headerRowIdx < 0) {
        skippedSheets.push(sheetName);
        continue;
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
          const computedMatTotal = quantity * matUnit;
          const computedFeeTotal = quantity * feeUnit;

          // Prefer the Excel-stored total when the cell explicitly contains a number
          // (including an explicit 0 — e.g. "K"-marked rows manually zeroed out).
          // Fall back to computed when the cell is empty / missing.
          const matTotalCell = row[col.MAT_TOTAL];
          const feeTotalCell = row[col.FEE_TOTAL];
          const matTotal = hasNumericValue(matTotalCell) ? toNumber(matTotalCell) : computedMatTotal;
          const feeTotal = hasNumericValue(feeTotalCell) ? toNumber(feeTotalCell) : computedFeeTotal;

          // Warn when the stored Excel total disagrees significantly with the computed value
          // AND the unit price is non-zero (zero-priced items legitimately have 0 totals).
          if (hasNumericValue(matTotalCell) && matUnit !== 0 && Math.abs(computedMatTotal - matTotal) > 1) {
            formulaErrors.push({
              sheet: sheetName,
              row: rowIdx + 1,
              message: `Anyag összeg eltérés: számított ${computedMatTotal} vs Excel ${matTotal} (Excel érték használva)`,
              rawData: row.slice(0, 9),
            });
          }
          if (hasNumericValue(feeTotalCell) && feeUnit !== 0 && Math.abs(computedFeeTotal - feeTotal) > 1) {
            formulaErrors.push({
              sheet: sheetName,
              row: rowIdx + 1,
              message: `Díj összeg eltérés: számított ${computedFeeTotal} vs Excel ${feeTotal} (Excel érték használva)`,
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
            sourceSheet: sheetName,
            sourceRow: rowIdx + 1,
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
          readErrors.push({
            sheet: sheetName,
            row: rowIdx + 1,
            message: "Nem felismerhető sor: nem tétel, nem kategória és nem összesítő sor — kihagyva",
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
      readErrors,
      formulaErrors,
      warnings: [...readErrors, ...formulaErrors],
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
