import ExcelJS from "exceljs";
import { inArray, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { budgets, projects, versions } from "@/lib/db/schema";
import {
  compareMultipleVersions,
  type MultiComparisonResult,
  type MultiVersionEntry,
  type MultiVersionItemEntry,
  type MultiVersionItemPrice,
  type SectionTotals,
} from "@/server/actions/versions";

export interface MultiComparisonExcelInput {
  versionIds: number[];
  budgetId?: number;
  hiddenVersionIdxs?: number[];
  versionOrder?: number[];
}

export interface MultiComparisonWorkbookFile {
  fileName: string;
  buffer: Buffer;
}

interface BudgetExportContext {
  budgetId: number;
  budgetName: string;
  projectCode: string | null;
  projectName: string;
}

interface ExportVersionEntry {
  version: MultiVersionEntry;
  originalIdx: number;
}

interface ExportSectionRow {
  key: string;
  label: string;
  depth: number;
  order: number;
  perVersionTotals: (SectionTotals | null)[];
}

const MONEY_FORMAT = "#,##0.00";
const QUANTITY_FORMAT = "#,##0.####";
const HEADER_FILL = "FF1F2937";
const GROUP_FILL = "FF334155";
const BASE_FILL = "FFE2E8F0";
const SUBHEADER_FILL = "FFF8FAFC";
const MISSING_FILL = "FFF1F5F9";
const BORDER_COLOR = "FFCBD5E1";
const VENDOR_FILLS = ["FFDBEAFE", "FFFEF3C7", "FFD1FAE5", "FFEDE9FE", "FFFFE4E6", "FFCFFAFE"];

function sanitizeFilePart(value: string): string {
  return value
    .replace(/[\u0000-\u001f<>:\"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
}

function makeFileName(context: BudgetExportContext): string {
  const project = sanitizeFilePart(context.projectCode || context.projectName);
  const budget = sanitizeFilePart(context.budgetName);
  const baseName = [project, budget, "artukor"].filter(Boolean).join("_");
  return `${baseName || "artukor"}.xlsx`;
}

function displayVersionName(version: MultiVersionEntry): string {
  if (version.partnerName && version.partnerName !== version.versionName) {
    return `${version.partnerName} - ${version.versionName}`;
  }
  return version.partnerName ?? version.versionName;
}

function validateVersionIds(versionIds: number[]): number[] {
  const uniqueIds = Array.from(new Set(versionIds));
  if (uniqueIds.length !== versionIds.length) {
    throw new Error("Egy verzió csak egyszer szerepelhet az ártükör exportban");
  }
  if (uniqueIds.length < 2) {
    throw new Error("Legalább 2 verzió szükséges az ártükör exporthoz");
  }
  return uniqueIds;
}

function normalizeOrder(versionCount: number, requestedOrder?: number[]): number[] {
  const fallback = Array.from({ length: versionCount }, (_, index) => index);
  if (!requestedOrder || requestedOrder.length !== versionCount) return fallback;
  const requested = new Set(requestedOrder);
  const valid = requested.size === versionCount && requestedOrder.every((idx) => Number.isInteger(idx) && idx >= 0 && idx < versionCount);
  return valid ? requestedOrder : fallback;
}

function getExportEntries(result: MultiComparisonResult, input: MultiComparisonExcelInput): ExportVersionEntry[] {
  const hidden = new Set(input.hiddenVersionIdxs ?? []);
  const order = normalizeOrder(result.versions.length, input.versionOrder);
  const entries = order
    .map((originalIdx) => ({ version: result.versions[originalIdx], originalIdx }))
    .filter((entry): entry is ExportVersionEntry => Boolean(entry.version) && !hidden.has(entry.originalIdx));

  if (entries.length < 2) {
    throw new Error("Legalább 2 látható verzió szükséges az ártükör exporthoz");
  }

  return entries;
}

async function loadBudgetContext(versionIds: number[], expectedBudgetId?: number): Promise<BudgetExportContext> {
  const rows = await db
    .select({
      versionId: versions.id,
      budgetId: budgets.id,
      budgetName: budgets.name,
      projectCode: projects.projectCode,
      projectName: projects.name,
    })
    .from(versions)
    .innerJoin(budgets, eq(versions.budgetId, budgets.id))
    .innerJoin(projects, eq(budgets.projectId, projects.id))
    .where(inArray(versions.id, versionIds));

  if (rows.length !== versionIds.length) {
    throw new Error("Egy vagy több kiválasztott verzió nem található");
  }

  const budgetIds = new Set(rows.map((row) => row.budgetId));
  if (budgetIds.size !== 1) {
    throw new Error("Az ártükör export csak egy költségvetés verzióiból készíthető");
  }

  const context = rows[0];
  if (!context) {
    throw new Error("A költségvetés nem található");
  }
  if (expectedBudgetId !== undefined && context.budgetId !== expectedBudgetId) {
    throw new Error("A kiválasztott verziók nem a megadott költségvetéshez tartoznak");
  }

  return {
    budgetId: context.budgetId,
    budgetName: context.budgetName,
    projectCode: context.projectCode,
    projectName: context.projectName,
  };
}

function setTitle(worksheet: ExcelJS.Worksheet, title: string, context: BudgetExportContext, totalColumns: number): void {
  worksheet.mergeCells(1, 1, 1, totalColumns);
  worksheet.mergeCells(2, 1, 2, totalColumns);

  const titleCell = worksheet.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { bold: true, size: 16, color: { argb: "FF0F172A" } };
  titleCell.alignment = { vertical: "middle", horizontal: "left" };

  const contextCell = worksheet.getCell(2, 1);
  contextCell.value = `${context.projectCode ?? context.projectName} / ${context.budgetName}`;
  contextCell.font = { size: 10, color: { argb: "FF64748B" } };
}

function setCellBorder(cell: ExcelJS.Cell): void {
  cell.border = {
    top: { style: "thin", color: { argb: BORDER_COLOR } },
    left: { style: "thin", color: { argb: BORDER_COLOR } },
    bottom: { style: "thin", color: { argb: BORDER_COLOR } },
    right: { style: "thin", color: { argb: BORDER_COLOR } },
  };
}

function styleHeaderCell(cell: ExcelJS.Cell, fill: string, textColor = "FFFFFFFF"): void {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
  cell.font = { bold: true, color: { argb: textColor } };
  cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  setCellBorder(cell);
}

function styleDataRow(row: ExcelJS.Row, fromColumn: number, toColumn: number): void {
  for (let column = fromColumn; column <= toColumn; column++) {
    const cell = row.getCell(column);
    cell.alignment = { vertical: "top", horizontal: typeof cell.value === "number" ? "right" : "left", wrapText: true };
    setCellBorder(cell);
  }
}

function setNumber(cell: ExcelJS.Cell, value: number, format = MONEY_FORMAT): void {
  cell.value = Number(value.toFixed(4));
  cell.numFmt = format;
  cell.alignment = { vertical: "top", horizontal: "right" };
}

function setMissingCell(cell: ExcelJS.Cell): void {
  cell.value = null;
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: MISSING_FILL } };
  setCellBorder(cell);
}

function applyAutoWidth(worksheet: ExcelJS.Worksheet, totalColumns: number, maxWidth = 48): void {
  for (let columnIndex = 1; columnIndex <= totalColumns; columnIndex++) {
    const column = worksheet.getColumn(columnIndex);
    let width = 10;
    column.eachCell({ includeEmpty: false }, (cell) => {
      const text = cell.text || String(cell.value ?? "");
      width = Math.max(width, Math.min(maxWidth, text.length + 2));
    });
    column.width = width;
  }
}

function columnLetter(columnNumber: number): string {
  let dividend = columnNumber;
  let name = "";
  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    name = String.fromCharCode(65 + modulo) + name;
    dividend = Math.floor((dividend - modulo) / 26);
  }
  return name;
}

function worksheetRange(columnCount: number, rowNumber: number): string {
  return `A${rowNumber}:${columnLetter(columnCount)}${rowNumber}`;
}

function addMainSummarySheet(workbook: ExcelJS.Workbook, context: BudgetExportContext, entries: ExportVersionEntry[]): void {
  const worksheet = workbook.addWorksheet("Főösszesítő");
  const totalColumns = 5;
  setTitle(worksheet, "Ártükör főösszesítő", context, totalColumns);

  const headerRow = worksheet.getRow(4);
  ["Alvállalkozó", "Verzió", "Tételszám", "Anyag összesen", "Díj összesen"].forEach((label, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = label;
    styleHeaderCell(cell, HEADER_FILL);
  });
  headerRow.height = 24;

  entries.forEach(({ version }) => {
    const row = worksheet.addRow([
      version.partnerName ?? version.versionName,
      version.versionName,
      version.itemCount,
      version.totalMaterial,
      version.totalFee,
    ]);
    setNumber(row.getCell(4), version.totalMaterial);
    setNumber(row.getCell(5), version.totalFee);
    styleDataRow(row, 1, totalColumns);
  });

  const totalRow = worksheet.addRow([
    "Mindösszesen",
    "",
    entries.reduce((sum, entry) => sum + entry.version.itemCount, 0),
    entries.reduce((sum, entry) => sum + entry.version.totalMaterial, 0),
    entries.reduce((sum, entry) => sum + entry.version.totalFee, 0),
  ]);
  totalRow.font = { bold: true };
  [4, 5].forEach((column) => setNumber(totalRow.getCell(column), Number(totalRow.getCell(column).value ?? 0)));
  styleDataRow(totalRow, 1, totalColumns);

  worksheet.views = [{ state: "frozen", ySplit: 4 }];
  worksheet.autoFilter = worksheetRange(totalColumns, 4);
  applyAutoWidth(worksheet, totalColumns);
}

function sectionKey(path: string[]): string {
  return path.join(" / ").toLowerCase();
}

function collectSectionRows(entries: ExportVersionEntry[]): ExportSectionRow[] {
  const rows = new Map<string, ExportSectionRow>();
  let order = 0;

  const visit = (totals: SectionTotals[], displayIndex: number, path: string[], depth: number): void => {
    for (const total of totals) {
      const nextPath = [...path, total.sectionName];
      const key = sectionKey(nextPath);
      const existing = rows.get(key);
      if (existing) {
        existing.perVersionTotals[displayIndex] = total;
      } else {
        const perVersionTotals = entries.map(() => null) as (SectionTotals | null)[];
        perVersionTotals[displayIndex] = total;
        rows.set(key, {
          key,
          label: nextPath.join(" / "),
          depth,
          order: order++,
          perVersionTotals,
        });
      }
      visit(total.children, displayIndex, nextPath, depth + 1);
    }
  };

  entries.forEach((entry, displayIndex) => {
    visit(entry.version.sectionTotals, displayIndex, [], 0);
  });

  return Array.from(rows.values()).sort((left, right) => left.order - right.order);
}

function addGroupedHeaders(
  worksheet: ExcelJS.Worksheet,
  baseHeaders: string[],
  entries: ExportVersionEntry[],
  perVersionHeaders: string[],
): number {
  const groupRowNumber = 4;
  const subHeaderRowNumber = 5;
  const groupRow = worksheet.getRow(groupRowNumber);
  const subHeaderRow = worksheet.getRow(subHeaderRowNumber);
  const baseColumns = baseHeaders.length;
  const perVersionColumns = perVersionHeaders.length;

  worksheet.mergeCells(groupRowNumber, 1, groupRowNumber, baseColumns);
  const baseGroupCell = groupRow.getCell(1);
  baseGroupCell.value = "Alapadatok";
  styleHeaderCell(baseGroupCell, GROUP_FILL);

  baseHeaders.forEach((label, index) => {
    const cell = subHeaderRow.getCell(index + 1);
    cell.value = label;
    styleHeaderCell(cell, BASE_FILL, "FF0F172A");
  });

  entries.forEach((entry, entryIndex) => {
    const startColumn = baseColumns + entryIndex * perVersionColumns + 1;
    const endColumn = startColumn + perVersionColumns - 1;
    worksheet.mergeCells(groupRowNumber, startColumn, groupRowNumber, endColumn);
    const groupCell = groupRow.getCell(startColumn);
    groupCell.value = displayVersionName(entry.version);
    styleHeaderCell(groupCell, VENDOR_FILLS[entryIndex % VENDOR_FILLS.length], "FF0F172A");

    perVersionHeaders.forEach((label, headerIndex) => {
      const cell = subHeaderRow.getCell(startColumn + headerIndex);
      cell.value = label;
      styleHeaderCell(cell, SUBHEADER_FILL, "FF334155");
    });
  });

  groupRow.height = 26;
  subHeaderRow.height = 34;
  return baseColumns + entries.length * perVersionColumns;
}

function addCategorySummarySheet(workbook: ExcelJS.Workbook, context: BudgetExportContext, entries: ExportVersionEntry[]): void {
  const worksheet = workbook.addWorksheet("Kategória összesítő");
  const totalColumns = 2 + entries.length * 3;
  setTitle(worksheet, "Kategóriánkénti ártükör", context, totalColumns);
  addGroupedHeaders(worksheet, ["Kategória", "Szint"], entries, ["Tételszám", "Anyag összesen", "Díj összesen"]);

  const sectionRows = collectSectionRows(entries);
  for (const section of sectionRows) {
    const row = worksheet.addRow([section.label, section.depth + 1]);
    section.perVersionTotals.forEach((total, entryIndex) => {
      const startColumn = 3 + entryIndex * 3;
      if (!total) {
        for (let offset = 0; offset < 3; offset++) setMissingCell(row.getCell(startColumn + offset));
        return;
      }
      row.getCell(startColumn).value = total.itemCount;
      setNumber(row.getCell(startColumn + 1), total.materialTotal);
      setNumber(row.getCell(startColumn + 2), total.feeTotal);
    });
    row.getCell(1).alignment = { indent: section.depth, wrapText: true, vertical: "top" };
    styleDataRow(row, 1, totalColumns);
  }

  const totalRow = worksheet.addRow(["Mindösszesen", ""]);
  totalRow.font = { bold: true };
  entries.forEach((entry, entryIndex) => {
    const startColumn = 3 + entryIndex * 3;
    totalRow.getCell(startColumn).value = entry.version.itemCount;
    setNumber(totalRow.getCell(startColumn + 1), entry.version.totalMaterial);
    setNumber(totalRow.getCell(startColumn + 2), entry.version.totalFee);
  });
  styleDataRow(totalRow, 1, totalColumns);

  worksheet.views = [{ state: "frozen", ySplit: 5, xSplit: 2 }];
  worksheet.autoFilter = worksheetRange(totalColumns, 5);
  applyAutoWidth(worksheet, totalColumns);
}

function itemPriceForEntry(item: MultiVersionItemEntry, originalIdx: number): MultiVersionItemPrice | null {
  return item.perVersion[originalIdx] ?? null;
}

function addItemComparisonSheet(
  workbook: ExcelJS.Workbook,
  context: BudgetExportContext,
  entries: ExportVersionEntry[],
  items: MultiVersionItemEntry[],
): void {
  const worksheet = workbook.addWorksheet("Tétel összehasonlítás");
  const totalColumns = 4 + entries.length * 5;
  setTitle(worksheet, "Tételenkénti ártükör", context, totalColumns);
  addGroupedHeaders(
    worksheet,
    ["Kategória", "Tételszám", "Tétel", "Me."],
    entries,
    ["Mennyiség", "Anyag egységár", "Díj egységár", "Anyag összesen", "Díj összesen"],
  );

  for (const item of items) {
    const row = worksheet.addRow([item.sectionName ?? "", item.itemNumber, item.name, item.unit]);
    entries.forEach((entry, entryIndex) => {
      const price = itemPriceForEntry(item, entry.originalIdx);
      const startColumn = 5 + entryIndex * 5;
      if (!price) {
        for (let offset = 0; offset < 5; offset++) setMissingCell(row.getCell(startColumn + offset));
        return;
      }
      setNumber(row.getCell(startColumn), price.quantity, QUANTITY_FORMAT);
      setNumber(row.getCell(startColumn + 1), price.materialUnitPrice);
      setNumber(row.getCell(startColumn + 2), price.feeUnitPrice);
      setNumber(row.getCell(startColumn + 3), price.materialTotal);
      setNumber(row.getCell(startColumn + 4), price.feeTotal);
    });
    styleDataRow(row, 1, totalColumns);
  }

  worksheet.views = [{ state: "frozen", ySplit: 5, xSplit: 4 }];
  worksheet.autoFilter = worksheetRange(totalColumns, 5);
  applyAutoWidth(worksheet, totalColumns, 56);
}

/** Builds the three-sheet Excel price mirror for a multi-version comparison. */
export async function createMultiComparisonWorkbook(input: MultiComparisonExcelInput): Promise<MultiComparisonWorkbookFile> {
  const versionIds = validateVersionIds(input.versionIds);
  const [context, comparison] = await Promise.all([
    loadBudgetContext(versionIds, input.budgetId),
    compareMultipleVersions(versionIds),
  ]);
  const entries = getExportEntries(comparison, input);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ERP2";
  workbook.created = new Date();
  workbook.modified = new Date();

  addMainSummarySheet(workbook, context, entries);
  addCategorySummarySheet(workbook, context, entries);
  addItemComparisonSheet(workbook, context, entries, comparison.items);

  const output = await workbook.xlsx.writeBuffer();
  return {
    fileName: makeFileName(context),
    buffer: Buffer.from(output as ArrayBuffer),
  };
}