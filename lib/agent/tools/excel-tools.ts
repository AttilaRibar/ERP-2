/**
 * LangChain tools that let the chat agent inspect and edit Excel workbooks
 * referenced by short opaque IDs (`workbookId`).
 *
 * Token-efficiency rules baked into every tool:
 * - Tools NEVER return an entire workbook in a single response.
 * - Read tools cap row/column counts and report when truncation kicks in.
 * - The single big mutation tool (`excel_apply_operations`) batches many
 *   atomic ops in one call, so the agent uses 1 tool call per logical edit
 *   batch instead of N.
 * - The agent learns the workbook ID from the attachment block; it never
 *   sees raw Excel bytes.
 */
import ExcelJS from "exceljs";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/permissions";
import type { AgentToolContext } from "@/lib/agent/types";
import {
  cloneWorkbook,
  getWorkbook,
  listSessionWorkbooks,
  registerEmptyWorkbook,
  requireWorkbook,
  type StoredWorkbook,
} from "@/lib/agent/excel/workbook-session";

// ---------------------------------------------------------------------------
// Hard caps (token-budget guardrails)
// ---------------------------------------------------------------------------

const MAX_RANGE_CELLS = 2_000;
const MAX_FIND_MATCHES = 100;
const MAX_OPERATIONS_PER_CALL = 500;
const DEFAULT_RANGE_PREVIEW_ROWS = 50;
const DEFAULT_RANGE_PREVIEW_COLS = 20;

// ---------------------------------------------------------------------------
// Cell value helpers
// ---------------------------------------------------------------------------

type SerialCellValue =
  | string
  | number
  | boolean
  | null
  | { formula: string; result?: string | number | boolean | null }
  | { hyperlink: string; text?: string }
  | { richText: string }
  | { error: string }
  | { date: string };

function serializeCellValue(value: ExcelJS.CellValue): SerialCellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) return { date: value.toISOString() };
  if (typeof value === "object") {
    const v = value as unknown as Record<string, unknown>;
    if (typeof v.formula === "string") {
      const res = v.result;
      const safeResult =
        res === null ||
        typeof res === "string" ||
        typeof res === "number" ||
        typeof res === "boolean"
          ? (res as string | number | boolean | null)
          : res instanceof Date
            ? res.toISOString()
            : null;
      return { formula: v.formula, result: safeResult };
    }
    if (typeof v.hyperlink === "string") {
      return { hyperlink: v.hyperlink, text: typeof v.text === "string" ? v.text : undefined };
    }
    if (Array.isArray(v.richText)) {
      const parts = v.richText as Array<{ text?: string }>;
      return { richText: parts.map((p) => p.text ?? "").join("") };
    }
    if (typeof v.error === "string") return { error: v.error };
    if (typeof v.text === "string") return v.text;
  }
  try {
    return String(value);
  } catch {
    return null;
  }
}

function parseInputValue(value: unknown): ExcelJS.CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (typeof v.formula === "string") {
      return { formula: v.formula, result: undefined } as unknown as ExcelJS.CellValue;
    }
    if (typeof v.hyperlink === "string") {
      return {
        hyperlink: v.hyperlink,
        text: typeof v.text === "string" ? v.text : v.hyperlink,
      } as unknown as ExcelJS.CellValue;
    }
    if (typeof v.date === "string") {
      const d = new Date(v.date);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return null;
}

function getSheet(stored: StoredWorkbook, name: string): ExcelJS.Worksheet {
  const ws = stored.workbook.getWorksheet(name);
  if (!ws) throw new Error(`Sheet "${name}" not found in workbook ${stored.id}.`);
  return ws;
}

interface RangeBox {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

function parseA1Range(range: string): RangeBox {
  const trimmed = range.trim().toUpperCase();
  const single = /^([A-Z]+)(\d+)$/.exec(trimmed);
  if (single) {
    const col = colLettersToIndex(single[1]);
    const row = Number(single[2]);
    return { startRow: row, startCol: col, endRow: row, endCol: col };
  }
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(trimmed);
  if (!m) throw new Error(`Invalid A1 range: "${range}". Expected e.g. "A1:D10".`);
  const startCol = colLettersToIndex(m[1]);
  const startRow = Number(m[2]);
  const endCol = colLettersToIndex(m[3]);
  const endRow = Number(m[4]);
  return {
    startRow: Math.min(startRow, endRow),
    endRow: Math.max(startRow, endRow),
    startCol: Math.min(startCol, endCol),
    endCol: Math.max(startCol, endCol),
  };
}

function colLettersToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function colIndexToLetters(index: number): string {
  let n = index;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s || "A";
}

function clampRangeBox(box: RangeBox, maxRow: number, maxCol: number): RangeBox {
  return {
    startRow: Math.max(1, Math.min(box.startRow, maxRow || 1)),
    endRow: Math.max(1, Math.min(box.endRow, maxRow || 1)),
    startCol: Math.max(1, Math.min(box.startCol, maxCol || 1)),
    endCol: Math.max(1, Math.min(box.endCol, maxCol || 1)),
  };
}

function describeUsedRange(ws: ExcelJS.Worksheet): {
  rowCount: number;
  columnCount: number;
} {
  return { rowCount: ws.rowCount, columnCount: ws.columnCount };
}

function summariseWorkbook(stored: StoredWorkbook) {
  const sheets = stored.workbook.worksheets.map((ws) => ({
    name: ws.name,
    rowCount: ws.rowCount,
    columnCount: ws.columnCount,
    state: ws.state,
    mergedRanges: Array.isArray(ws.model?.merges) ? ws.model.merges.length : 0,
  }));
  return {
    workbookId: stored.id,
    name: stored.name,
    kind: stored.kind,
    sheets,
    namedRanges: Object.keys(stored.workbook.definedNames?.model ?? {}),
  };
}

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

const StyleSchema = z
  .object({
    numberFormat: z.string().optional(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    fontSize: z.number().int().positive().max(96).optional(),
    fontColor: z
      .string()
      .regex(/^#?[0-9a-fA-F]{6}$/)
      .optional(),
    fillColor: z
      .string()
      .regex(/^#?[0-9a-fA-F]{6}$/)
      .optional(),
    horizontalAlignment: z.enum(["left", "center", "right", "fill", "justify"]).optional(),
    verticalAlignment: z.enum(["top", "middle", "bottom"]).optional(),
    wrapText: z.boolean().optional(),
    border: z
      .object({
        top: z.boolean().optional(),
        bottom: z.boolean().optional(),
        left: z.boolean().optional(),
        right: z.boolean().optional(),
        all: z.boolean().optional(),
        style: z.enum(["thin", "medium", "thick", "dashed", "dotted"]).default("thin").optional(),
        color: z
          .string()
          .regex(/^#?[0-9a-fA-F]{6}$/)
          .optional(),
      })
      .optional(),
  })
  .strict();
type CellStyle = z.infer<typeof StyleSchema>;

function normalizeColor(value?: string): string | undefined {
  if (!value) return undefined;
  const hex = value.startsWith("#") ? value.slice(1) : value;
  return `FF${hex.toUpperCase()}`;
}

function applyStyleToCell(cell: ExcelJS.Cell, style: CellStyle): void {
  if (style.numberFormat !== undefined) cell.numFmt = style.numberFormat;

  const fontPatch: Partial<ExcelJS.Font> = {};
  if (style.bold !== undefined) fontPatch.bold = style.bold;
  if (style.italic !== undefined) fontPatch.italic = style.italic;
  if (style.underline !== undefined) fontPatch.underline = style.underline;
  if (style.fontSize !== undefined) fontPatch.size = style.fontSize;
  if (style.fontColor) fontPatch.color = { argb: normalizeColor(style.fontColor)! };
  if (Object.keys(fontPatch).length > 0) cell.font = { ...cell.font, ...fontPatch };

  if (style.fillColor) {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: normalizeColor(style.fillColor)! },
    };
  }

  const alignmentPatch: Partial<ExcelJS.Alignment> = {};
  if (style.horizontalAlignment) alignmentPatch.horizontal = style.horizontalAlignment;
  if (style.verticalAlignment) {
    const map: Record<string, "top" | "middle" | "bottom"> = {
      top: "top",
      middle: "middle",
      bottom: "bottom",
    };
    alignmentPatch.vertical = map[style.verticalAlignment];
  }
  if (style.wrapText !== undefined) alignmentPatch.wrapText = style.wrapText;
  if (Object.keys(alignmentPatch).length > 0) {
    cell.alignment = { ...cell.alignment, ...alignmentPatch };
  }

  if (style.border) {
    const styleName = style.border.style ?? "thin";
    const colorArgb = normalizeColor(style.border.color);
    const borderSide: Partial<ExcelJS.Border> = {
      style: styleName as ExcelJS.BorderStyle,
      ...(colorArgb ? { color: { argb: colorArgb } } : {}),
    };
    const all = style.border.all === true;
    const next: Partial<ExcelJS.Borders> = { ...cell.border };
    if (all || style.border.top) next.top = borderSide as ExcelJS.Border;
    if (all || style.border.bottom) next.bottom = borderSide as ExcelJS.Border;
    if (all || style.border.left) next.left = borderSide as ExcelJS.Border;
    if (all || style.border.right) next.right = borderSide as ExcelJS.Border;
    cell.border = next as ExcelJS.Borders;
  }
}

// ---------------------------------------------------------------------------
// Operation schema (one big batched mutation tool)
// ---------------------------------------------------------------------------

const InputCellSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.object({ formula: z.string().min(1).max(2_000) }).strict(),
  z.object({ date: z.string().min(1) }).strict(),
  z
    .object({
      hyperlink: z.string().min(1).max(2_000),
      text: z.string().max(255).optional(),
    })
    .strict(),
]);

const OperationSchema = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("setCell"),
      sheet: z.string().min(1),
      address: z.string().min(2),
      value: InputCellSchema,
      style: StyleSchema.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("setRange"),
      sheet: z.string().min(1),
      startAddress: z.string().min(2),
      values: z.array(z.array(InputCellSchema)).min(1).max(2_000),
      style: StyleSchema.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("appendRow"),
      sheet: z.string().min(1),
      values: z.array(InputCellSchema).min(1).max(200),
    })
    .strict(),
  z
    .object({
      op: z.literal("appendRows"),
      sheet: z.string().min(1),
      rows: z.array(z.array(InputCellSchema).min(1).max(200)).min(1).max(2_000),
    })
    .strict(),
  z
    .object({
      op: z.literal("insertRow"),
      sheet: z.string().min(1),
      at: z.number().int().positive(),
      values: z.array(InputCellSchema).max(200).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("insertColumn"),
      sheet: z.string().min(1),
      at: z.number().int().positive(),
      values: z.array(InputCellSchema).max(2_000).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("deleteRows"),
      sheet: z.string().min(1),
      start: z.number().int().positive(),
      count: z.number().int().positive().max(10_000).default(1),
    })
    .strict(),
  z
    .object({
      op: z.literal("deleteColumns"),
      sheet: z.string().min(1),
      start: z.number().int().positive(),
      count: z.number().int().positive().max(1_000).default(1),
    })
    .strict(),
  z
    .object({
      op: z.literal("clearRange"),
      sheet: z.string().min(1),
      range: z.string().min(2),
    })
    .strict(),
  z
    .object({
      op: z.literal("copyRange"),
      sheet: z.string().min(1),
      sourceRange: z.string().min(2),
      destinationStart: z.string().min(2),
      destinationSheet: z.string().min(1).optional(),
      includeStyles: z.boolean().default(true),
    })
    .strict(),
  z
    .object({
      op: z.literal("setFormula"),
      sheet: z.string().min(1),
      address: z.string().min(2),
      formula: z.string().min(1).max(2_000),
    })
    .strict(),
  z
    .object({
      op: z.literal("fillFormula"),
      sheet: z.string().min(1),
      range: z.string().min(2),
      formula: z.string().min(1).max(2_000),
    })
    .strict(),
  z
    .object({
      op: z.literal("mergeCells"),
      sheet: z.string().min(1),
      range: z.string().min(2),
    })
    .strict(),
  z
    .object({
      op: z.literal("unmergeCells"),
      sheet: z.string().min(1),
      range: z.string().min(2),
    })
    .strict(),
  z
    .object({
      op: z.literal("setColumnWidth"),
      sheet: z.string().min(1),
      column: z.union([z.number().int().positive(), z.string().min(1).max(3)]),
      width: z.number().positive().max(255),
    })
    .strict(),
  z
    .object({
      op: z.literal("setRowHeight"),
      sheet: z.string().min(1),
      row: z.number().int().positive(),
      height: z.number().positive().max(409),
    })
    .strict(),
  z
    .object({
      op: z.literal("setStyleRange"),
      sheet: z.string().min(1),
      range: z.string().min(2),
      style: StyleSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("addSheet"),
      name: z.string().min(1).max(31),
      copyFrom: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("renameSheet"),
      sheet: z.string().min(1),
      newName: z.string().min(1).max(31),
    })
    .strict(),
  z
    .object({
      op: z.literal("deleteSheet"),
      sheet: z.string().min(1),
    })
    .strict(),
  z
    .object({
      op: z.literal("duplicateSheet"),
      sheet: z.string().min(1),
      newName: z.string().min(1).max(31),
    })
    .strict(),
  z
    .object({
      op: z.literal("setAutoFilter"),
      sheet: z.string().min(1),
      range: z.string().min(2),
    })
    .strict(),
  z
    .object({
      op: z.literal("freezePanes"),
      sheet: z.string().min(1),
      rows: z.number().int().min(0).max(1_048_576).default(0),
      columns: z.number().int().min(0).max(16_384).default(0),
    })
    .strict(),
  z
    .object({
      op: z.literal("addNamedRange"),
      name: z.string().min(1).max(255),
      sheet: z.string().min(1),
      range: z.string().min(2),
    })
    .strict(),
  z
    .object({
      op: z.literal("findAndReplace"),
      sheet: z.string().min(1).optional(),
      find: z.string().min(1),
      replace: z.string(),
      matchCase: z.boolean().default(false),
      regex: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      op: z.literal("sortRange"),
      sheet: z.string().min(1),
      range: z.string().min(2),
      column: z.number().int().positive(),
      direction: z.enum(["asc", "desc"]).default("asc"),
      hasHeader: z.boolean().default(false),
    })
    .strict(),
]);
type Operation = z.infer<typeof OperationSchema>;

// ---------------------------------------------------------------------------
// Operation executor
// ---------------------------------------------------------------------------

interface OpResult {
  index: number;
  op: string;
  ok: boolean;
  message?: string;
  cellsAffected?: number;
}

function setCellValue(cell: ExcelJS.Cell, value: z.infer<typeof InputCellSchema>): void {
  cell.value = parseInputValue(value);
}

function applyStyleToRange(ws: ExcelJS.Worksheet, range: RangeBox, style: CellStyle): number {
  let count = 0;
  for (let r = range.startRow; r <= range.endRow; r++) {
    for (let c = range.startCol; c <= range.endCol; c++) {
      applyStyleToCell(ws.getRow(r).getCell(c), style);
      count++;
    }
  }
  return count;
}

async function executeOperations(
  stored: StoredWorkbook,
  operations: Operation[],
): Promise<OpResult[]> {
  const results: OpResult[] = [];
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    try {
      const cellsAffected = await executeOne(stored, op);
      results.push({ index: i, op: op.op, ok: true, cellsAffected });
    } catch (err) {
      results.push({
        index: i,
        op: op.op,
        ok: false,
        message: err instanceof Error ? err.message : "Unknown operation error",
      });
    }
  }
  return results;
}

async function executeOne(stored: StoredWorkbook, op: Operation): Promise<number> {
  switch (op.op) {
    case "setCell": {
      const ws = getSheet(stored, op.sheet);
      const cell = ws.getCell(op.address);
      setCellValue(cell, op.value);
      if (op.style) applyStyleToCell(cell, op.style);
      return 1;
    }
    case "setRange": {
      const ws = getSheet(stored, op.sheet);
      const start = parseA1Range(op.startAddress);
      let count = 0;
      for (let r = 0; r < op.values.length; r++) {
        const row = op.values[r];
        for (let c = 0; c < row.length; c++) {
          const cell = ws.getRow(start.startRow + r).getCell(start.startCol + c);
          setCellValue(cell, row[c]);
          if (op.style) applyStyleToCell(cell, op.style);
          count++;
        }
      }
      return count;
    }
    case "appendRow": {
      const ws = getSheet(stored, op.sheet);
      ws.addRow(op.values.map(parseInputValue));
      return op.values.length;
    }
    case "appendRows": {
      const ws = getSheet(stored, op.sheet);
      for (const row of op.rows) ws.addRow(row.map(parseInputValue));
      return op.rows.reduce((sum, row) => sum + row.length, 0);
    }
    case "insertRow": {
      const ws = getSheet(stored, op.sheet);
      ws.insertRow(op.at, (op.values ?? []).map(parseInputValue));
      return op.values?.length ?? 0;
    }
    case "insertColumn": {
      const ws = getSheet(stored, op.sheet);
      ws.spliceColumns(op.at, 0, (op.values ?? []).map(parseInputValue));
      return op.values?.length ?? 0;
    }
    case "deleteRows": {
      const ws = getSheet(stored, op.sheet);
      ws.spliceRows(op.start, op.count);
      return op.count;
    }
    case "deleteColumns": {
      const ws = getSheet(stored, op.sheet);
      ws.spliceColumns(op.start, op.count);
      return op.count;
    }
    case "clearRange": {
      const ws = getSheet(stored, op.sheet);
      const box = parseA1Range(op.range);
      let count = 0;
      for (let r = box.startRow; r <= box.endRow; r++) {
        for (let c = box.startCol; c <= box.endCol; c++) {
          ws.getRow(r).getCell(c).value = null;
          count++;
        }
      }
      return count;
    }
    case "copyRange": {
      const sourceWs = getSheet(stored, op.sheet);
      const destWs = op.destinationSheet ? getSheet(stored, op.destinationSheet) : sourceWs;
      const src = parseA1Range(op.sourceRange);
      const dst = parseA1Range(op.destinationStart);
      let count = 0;
      for (let r = 0; r <= src.endRow - src.startRow; r++) {
        for (let c = 0; c <= src.endCol - src.startCol; c++) {
          const srcCell = sourceWs.getRow(src.startRow + r).getCell(src.startCol + c);
          const dstCell = destWs.getRow(dst.startRow + r).getCell(dst.startCol + c);
          dstCell.value = srcCell.value;
          if (op.includeStyles) {
            dstCell.style = JSON.parse(JSON.stringify(srcCell.style));
          }
          count++;
        }
      }
      return count;
    }
    case "setFormula": {
      const ws = getSheet(stored, op.sheet);
      ws.getCell(op.address).value = { formula: op.formula } as ExcelJS.CellFormulaValue;
      return 1;
    }
    case "fillFormula": {
      const ws = getSheet(stored, op.sheet);
      const box = parseA1Range(op.range);
      let count = 0;
      for (let r = box.startRow; r <= box.endRow; r++) {
        for (let c = box.startCol; c <= box.endCol; c++) {
          ws.getRow(r).getCell(c).value = { formula: op.formula } as ExcelJS.CellFormulaValue;
          count++;
        }
      }
      return count;
    }
    case "mergeCells": {
      const ws = getSheet(stored, op.sheet);
      ws.mergeCells(op.range);
      return 1;
    }
    case "unmergeCells": {
      const ws = getSheet(stored, op.sheet);
      ws.unMergeCells(op.range);
      return 1;
    }
    case "setColumnWidth": {
      const ws = getSheet(stored, op.sheet);
      const colIndex = typeof op.column === "number" ? op.column : colLettersToIndex(op.column.toUpperCase());
      ws.getColumn(colIndex).width = op.width;
      return 1;
    }
    case "setRowHeight": {
      const ws = getSheet(stored, op.sheet);
      ws.getRow(op.row).height = op.height;
      return 1;
    }
    case "setStyleRange": {
      const ws = getSheet(stored, op.sheet);
      const box = parseA1Range(op.range);
      return applyStyleToRange(ws, box, op.style);
    }
    case "addSheet": {
      if (op.copyFrom) {
        const src = getSheet(stored, op.copyFrom);
        const cloned = stored.workbook.addWorksheet(op.name);
        src.eachRow({ includeEmpty: false }, (row, rowNumber) => {
          const target = cloned.getRow(rowNumber);
          row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
            const t = target.getCell(colNumber);
            t.value = cell.value;
            t.style = JSON.parse(JSON.stringify(cell.style));
          });
        });
        return 1;
      }
      stored.workbook.addWorksheet(op.name);
      return 1;
    }
    case "renameSheet": {
      const ws = getSheet(stored, op.sheet);
      ws.name = op.newName;
      return 1;
    }
    case "deleteSheet": {
      const ws = getSheet(stored, op.sheet);
      stored.workbook.removeWorksheet(ws.id);
      return 1;
    }
    case "duplicateSheet": {
      const src = getSheet(stored, op.sheet);
      const dst = stored.workbook.addWorksheet(op.newName);
      src.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        const target = dst.getRow(rowNumber);
        row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
          const t = target.getCell(colNumber);
          t.value = cell.value;
          t.style = JSON.parse(JSON.stringify(cell.style));
        });
      });
      return 1;
    }
    case "setAutoFilter": {
      const ws = getSheet(stored, op.sheet);
      ws.autoFilter = op.range;
      return 1;
    }
    case "freezePanes": {
      const ws = getSheet(stored, op.sheet);
      ws.views = [{ state: "frozen", xSplit: op.columns, ySplit: op.rows }];
      return 1;
    }
    case "addNamedRange": {
      const ws = getSheet(stored, op.sheet);
      const box = parseA1Range(op.range);
      const ref = `${ws.name}!${colIndexToLetters(box.startCol)}${box.startRow}:${colIndexToLetters(box.endCol)}${box.endRow}`;
      stored.workbook.definedNames.add(ref, op.name);
      return 1;
    }
    case "findAndReplace": {
      const sheets = op.sheet ? [getSheet(stored, op.sheet)] : stored.workbook.worksheets;
      const flags = op.matchCase ? "g" : "gi";
      const pattern = op.regex
        ? new RegExp(op.find, flags)
        : new RegExp(op.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
      let count = 0;
      for (const ws of sheets) {
        ws.eachRow({ includeEmpty: false }, (row) => {
          row.eachCell({ includeEmpty: false }, (cell) => {
            const v = cell.value;
            if (typeof v === "string" && pattern.test(v)) {
              cell.value = v.replace(pattern, op.replace);
              count++;
              pattern.lastIndex = 0;
            }
          });
        });
      }
      return count;
    }
    case "sortRange": {
      const ws = getSheet(stored, op.sheet);
      const box = parseA1Range(op.range);
      const headerRow = op.hasHeader ? box.startRow : null;
      const dataStart = op.hasHeader ? box.startRow + 1 : box.startRow;
      const rows: ExcelJS.CellValue[][] = [];
      for (let r = dataStart; r <= box.endRow; r++) {
        const row: ExcelJS.CellValue[] = [];
        for (let c = box.startCol; c <= box.endCol; c++) {
          row.push(ws.getRow(r).getCell(c).value);
        }
        rows.push(row);
      }
      const sortColIdx = op.column - 1;
      rows.sort((a, b) => {
        const av = a[sortColIdx];
        const bv = b[sortColIdx];
        const an = typeof av === "number" ? av : Number(av);
        const bn = typeof bv === "number" ? bv : Number(bv);
        if (!Number.isNaN(an) && !Number.isNaN(bn)) {
          return op.direction === "asc" ? an - bn : bn - an;
        }
        const as = String(av ?? "");
        const bs = String(bv ?? "");
        return op.direction === "asc" ? as.localeCompare(bs) : bs.localeCompare(as);
      });
      for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < rows[r].length; c++) {
          ws.getRow(dataStart + r).getCell(box.startCol + c).value = rows[r][c];
        }
      }
      void headerRow; // header row stays in place
      return rows.length;
    }
  }
}

// ---------------------------------------------------------------------------
// Tool argument schemas
// ---------------------------------------------------------------------------

const WorkbookIdSchema = z.string().uuid();

const ListWorkbooksSchema = z.object({}).strict();

const InspectSchema = z
  .object({
    workbookId: WorkbookIdSchema,
  })
  .strict();

const ReadRangeSchema = z
  .object({
    workbookId: WorkbookIdSchema,
    sheet: z.string().min(1),
    range: z
      .string()
      .min(2)
      .optional()
      .describe(
        'A1 range, e.g. "A1:D20". Omit to auto-pick a preview window of the used range.',
      ),
    includeFormulas: z.boolean().default(false),
    maxRows: z.number().int().positive().max(500).default(DEFAULT_RANGE_PREVIEW_ROWS),
    maxCols: z.number().int().positive().max(200).default(DEFAULT_RANGE_PREVIEW_COLS),
  })
  .strict();

const FindSchema = z
  .object({
    workbookId: WorkbookIdSchema,
    query: z.string().min(1).max(500),
    sheet: z.string().min(1).optional(),
    matchCase: z.boolean().default(false),
    regex: z.boolean().default(false),
    maxMatches: z.number().int().positive().max(MAX_FIND_MATCHES).default(50),
  })
  .strict();

const ApplyOperationsSchema = z
  .object({
    workbookId: WorkbookIdSchema,
    operations: z.array(OperationSchema).min(1).max(MAX_OPERATIONS_PER_CALL),
    inPlace: z
      .boolean()
      .default(false)
      .describe(
        "If true, edits the workbook directly. If false (default), clones first so the original input file stays intact.",
      ),
    newName: z
      .string()
      .min(1)
      .max(120)
      .optional()
      .describe("Optional new file name when cloning. Defaults to '<original>-edited.xlsx'."),
  })
  .strict();

const CreateWorkbookSchema = z
  .object({
    name: z.string().min(1).max(120),
  })
  .strict();

const SaveAttachmentSchema = z
  .object({
    workbookId: WorkbookIdSchema,
    fileName: z.string().min(1).max(120).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Public attachment payload (returned to the agent + post-processor)
// ---------------------------------------------------------------------------

export interface ExcelOutputAttachment {
  attachmentId: string;
  name: string;
  size: number;
  mediaType: string;
  workbookKind: "input" | "output";
  derivedFrom?: string;
}

async function buildOutputAttachment(stored: StoredWorkbook): Promise<ExcelOutputAttachment> {
  const buf = await stored.workbook.xlsx.writeBuffer();
  return {
    attachmentId: stored.id,
    name: stored.name,
    size: (buf as ArrayBuffer).byteLength,
    mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    workbookKind: stored.kind,
    derivedFrom: stored.derivedFrom,
  };
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

/**
 * Builds the agent's Excel toolbelt. All tools are scoped to the calling
 * user + chat session, so cross-user access is impossible.
 *
 * The factory also exposes a `collectOutputAttachments` accessor: the chat
 * agent calls it after the ReAct loop to serialize newly-saved workbooks
 * into the response envelope (so the UI can render download buttons).
 */
export function createExcelTools(context: AgentToolContext) {
  if (!context.userId || !context.sessionId) {
    throw new Error("Missing agent tool runtime context");
  }
  const userId = context.userId;
  const sessionId = context.sessionId;

  /** IDs the agent has explicitly marked as user-visible outputs this turn. */
  const savedOutputIds = new Set<string>();

  const tools = [
    tool(
      async () => {
        await requirePermission("ai-chat:write");
        const list = listSessionWorkbooks({ userId, sessionId }).map(summariseWorkbook);
        return JSON.stringify({ workbooks: list });
      },
      {
        name: "excel_list_workbooks",
        description:
          "Lists every Excel workbook currently available in this chat session (uploaded inputs + agent-produced outputs). Use this to recover workbook IDs if the user references a previously-attached file.",
        schema: ListWorkbooksSchema,
      },
    ),

    tool(
      async ({ workbookId }) => {
        await requirePermission("ai-chat:write");
        const stored = requireWorkbook({ userId, sessionId, workbookId });
        return JSON.stringify(summariseWorkbook(stored));
      },
      {
        name: "excel_inspect",
        description:
          "Returns workbook metadata: sheet names, dimensions, named ranges. ALWAYS call this first before reading cells — it is cheap and lets you target only the sheet the user cares about.",
        schema: InspectSchema,
      },
    ),

    tool(
      async ({ workbookId, sheet, range, includeFormulas, maxRows, maxCols }) => {
        await requirePermission("ai-chat:write");
        const stored = requireWorkbook({ userId, sessionId, workbookId });
        const ws = getSheet(stored, sheet);
        const used = describeUsedRange(ws);
        let box: RangeBox;
        if (range) {
          box = clampRangeBox(parseA1Range(range), used.rowCount, used.columnCount);
        } else {
          box = {
            startRow: 1,
            startCol: 1,
            endRow: Math.min(maxRows, used.rowCount || 1),
            endCol: Math.min(maxCols, used.columnCount || 1),
          };
        }
        const totalCells = (box.endRow - box.startRow + 1) * (box.endCol - box.startCol + 1);
        if (totalCells > MAX_RANGE_CELLS) {
          // shrink to fit the cell budget
          const ratio = Math.sqrt(MAX_RANGE_CELLS / totalCells);
          const newRows = Math.max(1, Math.floor((box.endRow - box.startRow + 1) * ratio));
          const newCols = Math.max(1, Math.floor((box.endCol - box.startCol + 1) * ratio));
          box.endRow = box.startRow + newRows - 1;
          box.endCol = box.startCol + newCols - 1;
        }

        const rows: SerialCellValue[][] = [];
        for (let r = box.startRow; r <= box.endRow; r++) {
          const row: SerialCellValue[] = [];
          for (let c = box.startCol; c <= box.endCol; c++) {
            const cell = ws.getRow(r).getCell(c);
            if (includeFormulas && cell.formula) {
              row.push({
                formula: cell.formula,
                result:
                  typeof cell.result === "string" ||
                  typeof cell.result === "number" ||
                  typeof cell.result === "boolean"
                    ? cell.result
                    : null,
              });
            } else {
              row.push(serializeCellValue(cell.value));
            }
          }
          rows.push(row);
        }

        return JSON.stringify({
          sheet,
          rangeRead: `${colIndexToLetters(box.startCol)}${box.startRow}:${colIndexToLetters(box.endCol)}${box.endRow}`,
          usedRange: used,
          truncated: totalCells > MAX_RANGE_CELLS,
          rows,
        });
      },
      {
        name: "excel_read_range",
        description:
          'Reads cells from a workbook. Provide an explicit A1 range like "A1:D20" whenever possible — omitting it returns only a small preview window. Set includeFormulas=true to inspect formulas instead of computed values.',
        schema: ReadRangeSchema,
      },
    ),

    tool(
      async ({ workbookId, query, sheet, matchCase, regex, maxMatches }) => {
        await requirePermission("ai-chat:write");
        const stored = requireWorkbook({ userId, sessionId, workbookId });
        const sheets = sheet ? [getSheet(stored, sheet)] : stored.workbook.worksheets;
        const flags = matchCase ? "" : "i";
        const pattern = regex
          ? new RegExp(query, flags)
          : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
        const matches: { sheet: string; address: string; value: SerialCellValue }[] = [];
        for (const ws of sheets) {
          ws.eachRow({ includeEmpty: false }, (row) => {
            row.eachCell({ includeEmpty: false }, (cell) => {
              if (matches.length >= maxMatches) return;
              const text =
                typeof cell.value === "string"
                  ? cell.value
                  : typeof cell.value === "number" || typeof cell.value === "boolean"
                    ? String(cell.value)
                    : "";
              if (text && pattern.test(text)) {
                matches.push({
                  sheet: ws.name,
                  address: cell.address,
                  value: serializeCellValue(cell.value),
                });
              }
            });
          });
          if (matches.length >= maxMatches) break;
        }
        return JSON.stringify({
          totalMatches: matches.length,
          truncated: matches.length >= maxMatches,
          matches,
        });
      },
      {
        name: "excel_find",
        description:
          "Finds cells whose value matches a substring or regex. Returns at most 50 hits by default. Use this to locate a header row before reading or editing a range.",
        schema: FindSchema,
      },
    ),

    tool(
      async ({ name }) => {
        await requirePermission("ai-chat:write");
        const stored = registerEmptyWorkbook({ userId, sessionId, name });
        return JSON.stringify({
          workbookId: stored.id,
          name: stored.name,
          sheets: ["Sheet1"],
        });
      },
      {
        name: "excel_create_workbook",
        description:
          "Creates a brand-new empty workbook (single 'Sheet1') in this session. Use this when the user asks to build an Excel from scratch. Returns the workbookId for subsequent edits.",
        schema: CreateWorkbookSchema,
      },
    ),

    tool(
      async ({ workbookId, operations, inPlace, newName }) => {
        await requirePermission("ai-chat:write");
        const source = requireWorkbook({ userId, sessionId, workbookId });
        const target = inPlace
          ? source
          : await cloneWorkbook({
              userId,
              sessionId,
              sourceId: source.id,
              name: newName ?? deriveEditedName(source.name),
              kind: "output",
            });

        const results = await executeOperations(target, operations);
        const failed = results.filter((r) => !r.ok);
        return JSON.stringify({
          workbookId: target.id,
          name: target.name,
          inPlace,
          totalOperations: operations.length,
          succeeded: results.length - failed.length,
          failed: failed.length,
          results,
          summary: summariseWorkbook(target),
          notice:
            failed.length === 0
              ? "All operations applied successfully. Call excel_save_as_attachment to make this workbook downloadable for the user."
              : "Some operations failed; inspect the `results` array. Fix or skip them, then call excel_save_as_attachment.",
        });
      },
      {
        name: "excel_apply_operations",
        description: [
          "Applies a batch of structured edit operations to a workbook in a single call (much cheaper than many individual tool calls).",
          "Supported `op` kinds:",
          "- setCell, setRange, appendRow, appendRows, insertRow, insertColumn, deleteRows, deleteColumns, clearRange, copyRange",
          "- setFormula, fillFormula, mergeCells, unmergeCells, setColumnWidth, setRowHeight",
          "- setStyleRange (numberFormat, bold, italic, underline, fontSize/Color, fillColor, alignment, wrapText, border)",
          "- addSheet, renameSheet, deleteSheet, duplicateSheet",
          "- setAutoFilter, freezePanes, addNamedRange, findAndReplace, sortRange",
          "By default the original workbook is cloned and edits land in a new output workbook (set inPlace=true to mutate in place).",
        ].join("\n"),
        schema: ApplyOperationsSchema,
      },
    ),

    tool(
      async ({ workbookId, fileName }) => {
        await requirePermission("ai-chat:write");
        const stored = requireWorkbook({ userId, sessionId, workbookId });
        if (fileName) stored.name = ensureValidFileName(fileName);
        const attachment = await buildOutputAttachment(stored);
        savedOutputIds.add(stored.id);
        return JSON.stringify({
          attachment,
          notice:
            "Saved. The user can now download this workbook from the chat. Mention the file name in your final answer.",
        });
      },
      {
        name: "excel_save_as_attachment",
        description:
          "Marks a workbook (input or freshly edited) as a downloadable result for the user. ALWAYS call this once you finish editing — otherwise the user has no way to download the file. Returns the final attachment metadata.",
        schema: SaveAttachmentSchema,
      },
    ),
  ];

  /**
   * Collects all workbooks the agent flagged for download this turn and
   * serializes them. Used by the chat agent to populate
   * `outputAttachments` on the response envelope.
   */
  async function collectOutputAttachments(): Promise<ExcelOutputAttachment[]> {
    const attachments: ExcelOutputAttachment[] = [];
    for (const id of savedOutputIds) {
      const stored = getWorkbook({ userId, sessionId, workbookId: id });
      if (stored) attachments.push(await buildOutputAttachment(stored));
    }
    return attachments;
  }

  return { tools, collectOutputAttachments };
}

function deriveEditedName(name: string): string {
  const base = name.replace(/\.xlsx$/i, "");
  return `${base}-edited.xlsx`;
}

function ensureValidFileName(name: string): string {
  const safe = name.replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_").trim();
  return /\.xlsx$/i.test(safe) ? safe : `${safe}.xlsx`;
}
