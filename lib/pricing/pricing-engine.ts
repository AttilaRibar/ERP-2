import ExcelJS from "exceljs";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { budgets, partners, projects, versions } from "@/lib/db/schema";
import type {
  PricedWorkbookFile,
  PricingAnalysisResult,
  PricingAnalysisRow,
  PricingBudgetOption,
  PricingMatch,
  PricingProjectOption,
  PricingSelection,
  PricingVersionOption,
  PricingVersionType,
} from "@/types/pricing";

const PREVIEW_LIMIT = 300;
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
const LOW_CONFIDENCE_THRESHOLD = 72;
const MIN_MATCH_SCORE = 58;

const PricingSelectionSchema = z.object({
  projectId: z.coerce.number().int().positive("Projekt kiválasztása kötelező"),
  budgetId: z.coerce.number().int().positive("Költségvetés kiválasztása kötelező"),
  versionId: z.coerce.number().int().positive("Verzió kiválasztása kötelező"),
});

interface ColumnMap {
  sequence: number;
  itemNumber: number | null;
  name: number;
  quantity: number;
  unit: number;
  materialUnit: number;
  feeUnit: number;
  materialTotal: number;
  feeTotal: number;
}

interface PriceableExcelRow {
  rowId: string;
  sheetName: string;
  rowNumber: number;
  itemNumber: string;
  name: string;
  quantity: number;
  unit: string;
  materialUnitPrice: number;
  feeUnitPrice: number;
  columns: ColumnMap;
}

interface ParsedWorkbookRows {
  rows: PriceableExcelRow[];
  warnings: string[];
}

interface PricingSourceContext {
  projectId: number;
  projectCode: string | null;
  projectName: string;
  budgetId: number;
  budgetName: string;
  versionId: number;
  versionName: string;
  versionType: PricingVersionType;
  partnerName: string | null;
}

interface PricingSourceItem {
  itemCode: string;
  itemNumber: string;
  normalizedItemNumber: string;
  name: string;
  normalizedName: string;
  nameTokens: Set<string>;
  quantity: number;
  unit: string;
  normalizedUnit: string;
  materialUnitPrice: number;
  feeUnitPrice: number;
}

interface MatchedPricingRow {
  row: PriceableExcelRow;
  match: PricingMatch | null;
}

type ExcelLoadInput = Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0];

function toExcelLoadInput(buffer: Buffer): ExcelLoadInput {
  return buffer as unknown as ExcelLoadInput;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCode(value: string): string {
  return normalizeText(value).replace(/\s/g, "");
}

function tokenize(value: string): Set<string> {
  return new Set(normalizeText(value).split(" ").filter((token) => token.length > 1));
}

function textSimilarity(left: string, right: string, rightTokens: Set<string>): number {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
    return 0.82;
  }

  const leftTokens = tokenize(normalizedLeft);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared++;
  }

  const unionSize = new Set([...leftTokens, ...rightTokens]).size;
  const jaccard = unionSize > 0 ? shared / unionSize : 0;
  const containment = shared / Math.min(leftTokens.size, rightTokens.size);
  return Math.max(jaccard, containment * 0.86);
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const cleaned = value.replace(/\s/g, "").replace(",", ".");
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function isEmptyCell(value: unknown): boolean {
  return value === "" || value === undefined || value === null || value === 0;
}

function cellValueToPrimitive(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value;
  if (typeof value !== "object") return value;

  if ("result" in value) {
    return cellValueToPrimitive(value.result as ExcelJS.CellValue);
  }
  if ("text" in value && typeof value.text === "string") {
    return value.text;
  }
  if ("richText" in value && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text).join("");
  }
  return String(value);
}

function rowToArray(row: ExcelJS.Row): unknown[] {
  const limit = Math.max(row.cellCount, row.actualCellCount, 16);
  const values: unknown[] = [];
  for (let index = 1; index <= limit; index++) {
    values.push(cellValueToPrimitive(row.getCell(index).value));
  }
  return values;
}

function normalizedHeader(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function detectColumnMap(row: unknown[]): ColumnMap | null {
  if (!row || row.length < 5) return null;
  const cells = row.map(normalizedHeader);
  if (cells.filter((cell) => cell.length > 0).length < 4) return null;

  let sequence = -1;
  let itemNumber: number | null = null;
  let name = -1;
  let quantity = -1;
  let unit = -1;
  let materialUnit = -1;
  let feeUnit = -1;
  let materialTotal = -1;
  let feeTotal = -1;

  for (let index = 0; index < cells.length; index++) {
    const cell = cells[index];
    if (!cell) continue;

    const isMaterial = /anyag/.test(cell);
    const isFee = /(d[ií]j|munkad[ií]j|b[eé]r)/.test(cell);
    const isTotal = /[oö]ssz/.test(cell);
    const isUnitPrice = /(egys[eé]g[aá]r|egys[eé]g\s*[aá]r|egys[.\s]|^egys[eé]g$|^egys[eé]g[aá]r$)/.test(cell);

    if (materialTotal < 0 && isMaterial && isTotal) {
      materialTotal = index;
      continue;
    }
    if (feeTotal < 0 && isFee && isTotal) {
      feeTotal = index;
      continue;
    }
    if (materialUnit < 0 && isMaterial && (isUnitPrice || /anyag\s*egys|egys[.\s]*anyag/.test(cell)) && !isTotal) {
      materialUnit = index;
      continue;
    }
    if (feeUnit < 0 && isFee && (isUnitPrice || /(d[ií]j|munkad[ií]j)\s*egys|egys[.\s]*(d[ií]j|munkad[ií]j)/.test(cell)) && !isTotal) {
      feeUnit = index;
      continue;
    }
    if (sequence < 0 && /^(ssz\.?|sorsz[aá]m|s\.sz\.?|#|t[eé]tel)$/.test(cell)) {
      sequence = index;
      continue;
    }
    if (itemNumber === null && /^(t[eé]telsz[aá]m|t[eé]tel\s*sz[aá]ma|t[ií]pus|cikksz[aá]m|cikk\s*sz[aá]m|term[eé]k\s*k[oó]d|k[oó]d|cikk|sku)$/.test(cell)) {
      itemNumber = index;
      continue;
    }
    if (quantity < 0 && /^(menny\.?|mennyis[eé]g|m\.|db|darab|qty|quantity)$/.test(cell)) {
      quantity = index;
      continue;
    }
    if (unit < 0 && /^(egys[eé]g|m\.?\s*e\.?|m[eé]rt[eé]kegys[eé]g|unit|me)$/.test(cell)) {
      unit = index;
      continue;
    }
    if (name < 0 && /(t[eé]tel\s*sz[oö]veg|megnevez[eé]s|le[ií]r[aá]s|t[eé]tel\s*neve|description|name|munkanem)/.test(cell)) {
      name = index;
    }
  }

  if (name < 0) {
    const used = new Set([sequence, itemNumber ?? -1, quantity, unit, materialUnit, feeUnit, materialTotal, feeTotal]);
    for (let index = 0; index < cells.length; index++) {
      if (!used.has(index) && cells[index].length > 0) {
        name = index;
        break;
      }
    }
  }

  if (name < 0 || quantity < 0 || unit < 0 || materialUnit < 0 || feeUnit < 0 || materialTotal < 0 || feeTotal < 0) {
    return null;
  }

  return { sequence, itemNumber, name, quantity, unit, materialUnit, feeUnit, materialTotal, feeTotal };
}

function isSummaryRow(row: unknown[], columns: ColumnMap): boolean {
  const hasSummaryText = (value: unknown): boolean => {
    const text = String(value ?? "").toLowerCase();
    return (
      /fejezet\s*[oö]sszesen/.test(text) ||
      /[oö]sszesen\s*:/.test(text) ||
      /mind[oö]sszesen/.test(text) ||
      /^nett[oó]\b/.test(text) ||
      /^br[uú]tt[oó]\b/.test(text) ||
      /(^|[^a-záéíóöőúüű])[aá]fa(?![a-záéíóöőúüű])/.test(text) ||
      /total\b/.test(text)
    );
  };

  if (hasSummaryText(row[columns.name])) return true;
  if (columns.sequence >= 0 && hasSummaryText(row[columns.sequence])) return true;
  if (columns.itemNumber !== null && hasSummaryText(row[columns.itemNumber])) return true;
  return false;
}

function isCategoryRow(row: unknown[], columns: ColumnMap): boolean {
  const numericEmpty =
    isEmptyCell(row[columns.quantity]) &&
    isEmptyCell(row[columns.materialUnit]) &&
    isEmptyCell(row[columns.feeUnit]);
  if (!numericEmpty) return false;

  const sequenceValue = columns.sequence >= 0 ? row[columns.sequence] : "";
  const sequenceEmpty = isEmptyCell(sequenceValue);
  if (columns.sequence >= 0 && typeof sequenceValue === "string" && sequenceValue.trim().length > 0) return true;

  const nameValue = row[columns.name];
  if (typeof nameValue === "string" && nameValue.trim().length > 0 && sequenceEmpty) {
    return columns.itemNumber === null || isEmptyCell(row[columns.itemNumber]);
  }

  if (columns.itemNumber !== null) {
    const itemNumberValue = row[columns.itemNumber];
    return (
      typeof itemNumberValue === "string" &&
      itemNumberValue.trim().length > 0 &&
      sequenceEmpty &&
      isEmptyCell(row[columns.name])
    );
  }

  return false;
}

function isDataRow(row: unknown[], columns: ColumnMap): boolean {
  const name = row[columns.name];
  if (typeof name !== "string" || name.trim().length === 0) return false;
  if (!(toNumber(row[columns.quantity]) > 0)) return false;

  if (columns.sequence >= 0) {
    const sequenceValue = row[columns.sequence];
    if (!isEmptyCell(sequenceValue)) {
      const sequenceNumber = typeof sequenceValue === "number"
        ? sequenceValue
        : typeof sequenceValue === "string"
          ? parseFloat(sequenceValue.replace(/\s/g, ""))
          : NaN;
      if (Number.isNaN(sequenceNumber) && /[oö]ssz|nett[oó]|br[uú]tt[oó]|[aá]fa/.test(String(sequenceValue).toLowerCase())) {
        return false;
      }
    }
  } else {
    const unit = row[columns.unit];
    if (typeof unit !== "string" || unit.trim().length === 0) return false;
  }

  return true;
}

function shouldSkipSheet(name: string): boolean {
  return [
    /z[aá]rad[eé]k/i,
    /fejezet\s*[oö]sszesít/i,
    /[oö]sszesít[oő]/i,
    /^munkanem\s*[oö]sszesít/i,
    /summary/i,
    /cover/i,
  ].some((pattern) => pattern.test(name));
}

async function loadWorkbook(buffer: ArrayBuffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(toExcelLoadInput(Buffer.from(buffer)));
  return workbook;
}

function extractPriceableRows(workbook: ExcelJS.Workbook): ParsedWorkbookRows {
  const rows: PriceableExcelRow[] = [];
  const warnings: string[] = [];

  for (const worksheet of workbook.worksheets) {
    if (shouldSkipSheet(worksheet.name)) continue;

    let headerRowNumber = -1;
    let columns: ColumnMap | null = null;
    const scanLimit = Math.min(worksheet.rowCount, 30);

    for (let rowNumber = 1; rowNumber <= scanLimit; rowNumber++) {
      const detected = detectColumnMap(rowToArray(worksheet.getRow(rowNumber)));
      if (detected) {
        headerRowNumber = rowNumber;
        columns = detected;
        break;
      }
    }

    if (!columns) {
      warnings.push(`Nem található árazható fejléc: ${worksheet.name}`);
      continue;
    }

    for (let rowNumber = headerRowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber++) {
      const rowValues = rowToArray(worksheet.getRow(rowNumber));
      if (detectColumnMap(rowValues)) continue;
      if (isSummaryRow(rowValues, columns)) continue;
      if (isCategoryRow(rowValues, columns)) continue;
      if (!isDataRow(rowValues, columns)) continue;

      rows.push({
        rowId: `${worksheet.name}:${rowNumber}`,
        sheetName: worksheet.name,
        rowNumber,
        itemNumber: columns.itemNumber !== null ? String(rowValues[columns.itemNumber] ?? "").trim() : "",
        name: String(rowValues[columns.name] ?? "").trim(),
        quantity: toNumber(rowValues[columns.quantity]),
        unit: String(rowValues[columns.unit] ?? "").trim(),
        materialUnitPrice: toNumber(rowValues[columns.materialUnit]),
        feeUnitPrice: toNumber(rowValues[columns.feeUnit]),
        columns,
      });
    }
  }

  return { rows, warnings };
}

function scoreCandidate(row: PriceableExcelRow, candidate: PricingSourceItem): { score: number; reason: string } {
  const rowCode = normalizeCode(row.itemNumber);
  let score = 0;
  let reason = "Megnevezés";

  if (rowCode && candidate.normalizedItemNumber) {
    if (rowCode === candidate.normalizedItemNumber) {
      score = 92;
      reason = "Tételszám";
    } else if (rowCode.includes(candidate.normalizedItemNumber) || candidate.normalizedItemNumber.includes(rowCode)) {
      score = 72;
      reason = "Részleges tételszám";
    }
  }

  const nameScore = textSimilarity(row.name, candidate.name, candidate.nameTokens);
  if (score > 0) {
    score += nameScore * 6;
  } else {
    score = nameScore * 86;
  }

  const rowUnit = normalizeText(row.unit);
  if (rowUnit && candidate.normalizedUnit) {
    score += rowUnit === candidate.normalizedUnit ? 4 : -6;
  }

  if (candidate.materialUnitPrice > 0 || candidate.feeUnitPrice > 0) {
    score += 2;
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), reason };
}

function matchRows(rows: PriceableExcelRow[], sourceItems: PricingSourceItem[]): MatchedPricingRow[] {
  const byItemNumber = new Map<string, PricingSourceItem[]>();
  for (const item of sourceItems) {
    if (!item.normalizedItemNumber) continue;
    const list = byItemNumber.get(item.normalizedItemNumber) ?? [];
    list.push(item);
    byItemNumber.set(item.normalizedItemNumber, list);
  }

  return rows.map((row) => {
    const rowCode = normalizeCode(row.itemNumber);
    const directCandidates = rowCode ? byItemNumber.get(rowCode) : undefined;
    const candidates = directCandidates && directCandidates.length > 0 ? directCandidates : sourceItems;

    let best: { item: PricingSourceItem; score: number; reason: string } | null = null;
    for (const candidate of candidates) {
      const scored = scoreCandidate(row, candidate);
      if (!best || scored.score > best.score) {
        best = { item: candidate, score: scored.score, reason: scored.reason };
      }
    }

    if (!best || best.score < MIN_MATCH_SCORE) {
      return { row, match: null };
    }

    return {
      row,
      match: {
        sourceItemCode: best.item.itemCode,
        sourceItemNumber: best.item.itemNumber,
        sourceName: best.item.name,
        sourceUnit: best.item.unit,
        materialUnitPrice: best.item.materialUnitPrice,
        feeUnitPrice: best.item.feeUnitPrice,
        score: best.score,
        reason: best.reason,
      },
    };
  });
}

function toAnalysisRow(row: MatchedPricingRow): PricingAnalysisRow {
  const materialTotal = row.match ? row.row.quantity * row.match.materialUnitPrice : 0;
  const feeTotal = row.match ? row.row.quantity * row.match.feeUnitPrice : 0;
  return {
    rowId: row.row.rowId,
    sheetName: row.row.sheetName,
    rowNumber: row.row.rowNumber,
    itemNumber: row.row.itemNumber,
    name: row.row.name,
    quantity: row.row.quantity,
    unit: row.row.unit,
    materialTotal,
    feeTotal,
    match: row.match,
  };
}

function buildAnalysis(
  fileName: string,
  context: PricingSourceContext,
  matchedRows: MatchedPricingRow[],
  warnings: string[],
): PricingAnalysisResult {
  const allRows = matchedRows.map(toAnalysisRow);
  const matchedCount = allRows.filter((row) => row.match).length;
  const pricedCount = allRows.filter((row) => row.match && (row.match.materialUnitPrice > 0 || row.match.feeUnitPrice > 0)).length;
  const lowConfidenceRows = allRows.filter((row) => row.match && row.match.score < LOW_CONFIDENCE_THRESHOLD).length;
  const materialTotal = allRows.reduce((sum, row) => sum + row.materialTotal, 0);
  const feeTotal = allRows.reduce((sum, row) => sum + row.feeTotal, 0);

  return {
    summary: {
      fileName,
      sourceProjectName: context.projectName,
      sourceProjectCode: context.projectCode,
      sourceBudgetName: context.budgetName,
      sourceVersionName: context.versionName,
      sourceVersionType: context.versionType,
      sourcePartnerName: context.partnerName,
      totalRows: allRows.length,
      matchedRows: matchedCount,
      pricedRows: pricedCount,
      lowConfidenceRows,
      unmatchedRows: allRows.length - matchedCount,
      materialTotal,
      feeTotal,
    },
    rows: allRows.slice(0, PREVIEW_LIMIT),
    warnings,
    previewLimit: PREVIEW_LIMIT,
  };
}

function setNumberCell(cell: ExcelJS.Cell, value: number): void {
  cell.value = Number(value.toFixed(2));
  cell.numFmt = "#,##0.00";
}

function fillWorkbook(workbook: ExcelJS.Workbook, matchedRows: MatchedPricingRow[]): void {
  for (const matchedRow of matchedRows) {
    if (!matchedRow.match) continue;
    const worksheet = workbook.getWorksheet(matchedRow.row.sheetName);
    if (!worksheet) continue;

    const excelRow = worksheet.getRow(matchedRow.row.rowNumber);
    const materialTotal = matchedRow.row.quantity * matchedRow.match.materialUnitPrice;
    const feeTotal = matchedRow.row.quantity * matchedRow.match.feeUnitPrice;

    setNumberCell(excelRow.getCell(matchedRow.row.columns.materialUnit + 1), matchedRow.match.materialUnitPrice);
    setNumberCell(excelRow.getCell(matchedRow.row.columns.feeUnit + 1), matchedRow.match.feeUnitPrice);
    setNumberCell(excelRow.getCell(matchedRow.row.columns.materialTotal + 1), materialTotal);
    setNumberCell(excelRow.getCell(matchedRow.row.columns.feeTotal + 1), feeTotal);
    excelRow.commit();
  }
}

function ensureOutputFileName(fileName: string): string {
  const baseName = fileName.replace(/\.(xlsx|xlsm)$/i, "").replace(/[\u0000-\u001f<>:\"/\\|?*]/g, "_").trim();
  return `${baseName || "arazott_koltsegvetes"}_arazott.xlsx`;
}

function readPricingFormData(formData: FormData): { selection: PricingSelection; file: File } {
  const parsed = PricingSelectionSchema.safeParse({
    projectId: formData.get("projectId"),
    budgetId: formData.get("budgetId"),
    versionId: formData.get("versionId"),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Érvénytelen árazási beállítások");
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Nincs kiválasztott Excel fájl");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("A fájl mérete nem lehet nagyobb 30 MB-nál");
  }
  if (!/\.(xlsx|xlsm)$/i.test(file.name)) {
    throw new Error("Árazáshoz .xlsx vagy .xlsm fájl szükséges");
  }

  return { selection: parsed.data, file };
}

async function loadSourceContext(selection: PricingSelection): Promise<PricingSourceContext> {
  const [row] = await db
    .select({
      projectId: projects.id,
      projectCode: projects.projectCode,
      projectName: projects.name,
      budgetId: budgets.id,
      budgetName: budgets.name,
      versionId: versions.id,
      versionName: versions.versionName,
      versionType: versions.versionType,
      partnerName: partners.name,
    })
    .from(versions)
    .innerJoin(budgets, eq(versions.budgetId, budgets.id))
    .innerJoin(projects, eq(budgets.projectId, projects.id))
    .leftJoin(partners, eq(versions.partnerId, partners.id))
    .where(
      and(
        eq(projects.id, selection.projectId),
        eq(budgets.id, selection.budgetId),
        eq(versions.id, selection.versionId),
      ),
    );

  if (!row) {
    throw new Error("A kiválasztott projekt/költségvetés/verzió nem található");
  }

  return {
    ...row,
    versionType: (row.versionType ?? "offer") as PricingVersionType,
  };
}

async function loadSourceItems(versionId: number): Promise<PricingSourceItem[]> {
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
        bi.item_code,
        bi.item_number,
        bi.name,
        bi.quantity,
        bi.unit,
        bi.material_unit_price,
        bi.fee_unit_price,
        bi.is_deleted,
        ROW_NUMBER() OVER (PARTITION BY bi.item_code ORDER BY a.depth ASC) AS rn
      FROM budget_items bi
      JOIN ancestors a ON bi.version_id = a.id
    )
    SELECT item_code, item_number, name, quantity, unit, material_unit_price, fee_unit_price
    FROM ranked_items
    WHERE rn = 1 AND NOT is_deleted
    ORDER BY item_number, name
  `);

  const rows = result as unknown as Record<string, unknown>[];
  return rows.map((row) => {
    const itemNumber = String(row.item_number ?? "");
    const name = String(row.name ?? "");
    const unit = String(row.unit ?? "");
    return {
      itemCode: String(row.item_code),
      itemNumber,
      normalizedItemNumber: normalizeCode(itemNumber),
      name,
      normalizedName: normalizeText(name),
      nameTokens: tokenize(name),
      quantity: Number(row.quantity),
      unit,
      normalizedUnit: normalizeText(unit),
      materialUnitPrice: Number(row.material_unit_price),
      feeUnitPrice: Number(row.fee_unit_price),
    };
  });
}

async function analyzeWorkbookBuffer(input: {
  selection: PricingSelection;
  fileName: string;
  buffer: ArrayBuffer;
}): Promise<{ workbook: ExcelJS.Workbook; matchedRows: MatchedPricingRow[]; analysis: PricingAnalysisResult }> {
  const [context, sourceItems, workbook] = await Promise.all([
    loadSourceContext(input.selection),
    loadSourceItems(input.selection.versionId),
    loadWorkbook(input.buffer),
  ]);

  const parsed = extractPriceableRows(workbook);
  const warnings = [...parsed.warnings];
  if (sourceItems.length === 0) {
    warnings.push("A kiválasztott verzióban nincs árazási forrástétel");
  }

  const matchedRows = matchRows(parsed.rows, sourceItems);
  const analysis = buildAnalysis(input.fileName, context, matchedRows, warnings);
  return { workbook, matchedRows, analysis };
}

/** Returns active projects available as pricing source roots. */
export async function listPricingProjects(): Promise<PricingProjectOption[]> {
  return db
    .select({ id: projects.id, projectCode: projects.projectCode, name: projects.name })
    .from(projects)
    .where(eq(projects.status, "active"))
    .orderBy(projects.name);
}

/** Returns budgets belonging to a selected project. */
export async function listPricingBudgetsForProject(projectId: number): Promise<PricingBudgetOption[]> {
  return db
    .select({ id: budgets.id, projectId: budgets.projectId, name: budgets.name })
    .from(budgets)
    .where(eq(budgets.projectId, projectId))
    .orderBy(budgets.name);
}

/** Returns versions belonging to a selected budget. */
export async function listPricingVersionsForBudget(budgetId: number): Promise<PricingVersionOption[]> {
  const rows = await db
    .select({
      id: versions.id,
      budgetId: versions.budgetId,
      versionName: versions.versionName,
      versionType: versions.versionType,
      partnerName: partners.name,
      createdAt: versions.createdAt,
    })
    .from(versions)
    .leftJoin(partners, eq(versions.partnerId, partners.id))
    .where(eq(versions.budgetId, budgetId))
    .orderBy(versions.createdAt);

  return rows.map((row) => ({
    ...row,
    versionType: (row.versionType ?? "offer") as PricingVersionType,
  }));
}

/** Analyzes an uploaded workbook and returns a match preview without mutating data. */
export async function analyzePricingWorkbookFormData(formData: FormData): Promise<PricingAnalysisResult> {
  const { selection, file } = readPricingFormData(formData);
  const buffer = await file.arrayBuffer();
  const { analysis } = await analyzeWorkbookBuffer({ selection, fileName: file.name, buffer });
  return analysis;
}

/** Prices an uploaded workbook and returns the generated .xlsx file bytes. */
export async function createPricedWorkbookFormData(formData: FormData): Promise<PricedWorkbookFile> {
  const { selection, file } = readPricingFormData(formData);
  const buffer = await file.arrayBuffer();
  const { workbook, matchedRows, analysis } = await analyzeWorkbookBuffer({ selection, fileName: file.name, buffer });
  fillWorkbook(workbook, matchedRows);
  const output = await workbook.xlsx.writeBuffer();

  return {
    fileName: ensureOutputFileName(file.name),
    buffer: Buffer.from(output as ArrayBuffer),
    analysis,
  };
}