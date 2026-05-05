/**
 * LangChain tools that let the chat agent inspect and edit Excel workbooks
 * through the external `haris-musa/excel-mcp-server` MCP server.
 *
 * The LLM-facing API intentionally keeps the existing `excel_*` tool names so
 * the chat prompt and UI download flow stay stable. Internally, workbook bytes
 * live in per-session temp `.xlsx` files and every read/write operation is
 * delegated to MCP tools instead of mutating an ExcelJS workbook in-process.
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/permissions";
import type { AgentToolContext } from "@/lib/agent/types";
import { callExcelMcpTool } from "@/lib/agent/excel/mcp-client";
import {
  cloneWorkbook,
  getWorkbook,
  getWorkbookFileSize,
  listSessionWorkbooks,
  registerEmptyWorkbook,
  requireWorkbook,
  type StoredWorkbook,
} from "@/lib/agent/excel/workbook-session";

const MAX_FIND_MATCHES = 100;
const MAX_OPERATIONS_PER_CALL = 500;
const DEFAULT_RANGE_PREVIEW_ROWS = 50;
const DEFAULT_RANGE_PREVIEW_COLS = 20;

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

type InputCellValue = z.infer<typeof InputCellSchema>;

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
  z.object({ op: z.literal("clearRange"), sheet: z.string().min(1), range: z.string().min(2) }).strict(),
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
  z.object({ op: z.literal("mergeCells"), sheet: z.string().min(1), range: z.string().min(2) }).strict(),
  z.object({ op: z.literal("unmergeCells"), sheet: z.string().min(1), range: z.string().min(2) }).strict(),
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
  z.object({ op: z.literal("setStyleRange"), sheet: z.string().min(1), range: z.string().min(2), style: StyleSchema }).strict(),
  z.object({ op: z.literal("addSheet"), name: z.string().min(1).max(31), copyFrom: z.string().min(1).optional() }).strict(),
  z.object({ op: z.literal("renameSheet"), sheet: z.string().min(1), newName: z.string().min(1).max(31) }).strict(),
  z.object({ op: z.literal("deleteSheet"), sheet: z.string().min(1) }).strict(),
  z.object({ op: z.literal("duplicateSheet"), sheet: z.string().min(1), newName: z.string().min(1).max(31) }).strict(),
  z.object({ op: z.literal("setAutoFilter"), sheet: z.string().min(1), range: z.string().min(2) }).strict(),
  z
    .object({
      op: z.literal("freezePanes"),
      sheet: z.string().min(1),
      rows: z.number().int().min(0).max(1_048_576).default(0),
      columns: z.number().int().min(0).max(16_384).default(0),
    })
    .strict(),
  z.object({ op: z.literal("addNamedRange"), name: z.string().min(1).max(255), sheet: z.string().min(1), range: z.string().min(2) }).strict(),
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

const WorkbookIdSchema = z.string().uuid();
const ListWorkbooksSchema = z.object({}).strict();
const InspectSchema = z.object({ workbookId: WorkbookIdSchema }).strict();

const ReadRangeSchema = z
  .object({
    workbookId: WorkbookIdSchema,
    sheet: z.string().min(1),
    range: z.string().min(2).optional().describe('A1 range, e.g. "A1:D20".'),
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
    inPlace: z.boolean().default(false),
    newName: z.string().min(1).max(120).optional(),
  })
  .strict();

const CreateWorkbookSchema = z.object({ name: z.string().min(1).max(120) }).strict();
const SaveAttachmentSchema = z
  .object({ workbookId: WorkbookIdSchema, fileName: z.string().min(1).max(120).optional() })
  .strict();

export interface ExcelOutputAttachment {
  attachmentId: string;
  name: string;
  size: number;
  mediaType: string;
  workbookKind: "input" | "output";
  derivedFrom?: string;
}

interface RangeBox {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

interface OpResult {
  index: number;
  op: string;
  ok: boolean;
  message?: string;
  cellsAffected?: number;
}

interface McpReadCell {
  address: string;
  value: unknown;
  row: number;
  column: number;
}

interface McpReadResult {
  range?: string;
  sheet_name?: string;
  cells?: McpReadCell[];
}

function colLettersToIndex(letters: string): number {
  let index = 0;
  for (const character of letters) index = index * 26 + (character.charCodeAt(0) - 64);
  return index;
}

function colIndexToLetters(index: number): string {
  let cursor = index;
  let letters = "";
  while (cursor > 0) {
    const remainder = (cursor - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    cursor = Math.floor((cursor - 1) / 26);
  }
  return letters || "A";
}

function parseA1Range(range: string): RangeBox {
  const trimmed = range.trim().toUpperCase();
  const single = /^([A-Z]+)(\d+)$/.exec(trimmed);
  if (single) {
    const column = colLettersToIndex(single[1]);
    const row = Number(single[2]);
    return { startRow: row, startCol: column, endRow: row, endCol: column };
  }
  const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(trimmed);
  if (!match) throw new Error(`Invalid A1 range: "${range}". Expected e.g. "A1:D10".`);
  const startCol = colLettersToIndex(match[1]);
  const startRow = Number(match[2]);
  const endCol = colLettersToIndex(match[3]);
  const endRow = Number(match[4]);
  return {
    startRow: Math.min(startRow, endRow),
    endRow: Math.max(startRow, endRow),
    startCol: Math.min(startCol, endCol),
    endCol: Math.max(startCol, endCol),
  };
}

function formatRange(box: RangeBox): string {
  return `${colIndexToLetters(box.startCol)}${box.startRow}:${colIndexToLetters(box.endCol)}${box.endRow}`;
}

function splitRange(range: string): { startCell: string; endCell: string } {
  const box = parseA1Range(range);
  return {
    startCell: `${colIndexToLetters(box.startCol)}${box.startRow}`,
    endCell: `${colIndexToLetters(box.endCol)}${box.endRow}`,
  };
}

function rangeFromStartAndSize(startAddress: string, rowCount: number, columnCount: number): string {
  const start = parseA1Range(startAddress);
  return formatRange({
    startRow: start.startRow,
    startCol: start.startCol,
    endRow: start.startRow + Math.max(1, rowCount) - 1,
    endCol: start.startCol + Math.max(1, columnCount) - 1,
  });
}

function normalizeFormula(formula: string): string {
  return formula.trim().startsWith("=") ? formula.trim() : `=${formula.trim()}`;
}

function normalizeValue(value: InputCellValue): string | number | boolean | null {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if ("formula" in value) return normalizeFormula(value.formula);
  if ("date" in value) return value.date;
  if ("hyperlink" in value) return value.text ?? value.hyperlink;
  return null;
}

function containsFormula(value: InputCellValue): value is { formula: string } {
  return typeof value === "object" && value !== null && "formula" in value;
}

function styleToMcpArgs(style: CellStyle): Record<string, unknown> {
  return {
    bold: style.bold ?? false,
    italic: style.italic ?? false,
    underline: style.underline ?? false,
    font_size: style.fontSize,
    font_color: style.fontColor,
    bg_color: style.fillColor,
    border_style: style.border?.all ? (style.border.style ?? "thin") : undefined,
    border_color: style.border?.color,
    number_format: style.numberFormat,
    alignment: style.horizontalAlignment,
    wrap_text: style.wrapText ?? false,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertMcpSuccess(toolName: string, text: string): string {
  if (/^\s*error:/i.test(text)) throw new Error(`${toolName}: ${text}`);
  return text;
}

async function workbookTool(
  stored: StoredWorkbook,
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<string> {
  const text = await callExcelMcpTool(toolName, { filepath: stored.mcpFilePath, ...args });
  return assertMcpSuccess(toolName, text);
}

async function applyStyle(stored: StoredWorkbook, sheet: string, range: string, style: CellStyle): Promise<void> {
  const rangeParts = splitRange(range);
  await workbookTool(stored, "format_range", {
    sheet_name: sheet,
    start_cell: rangeParts.startCell,
    end_cell: rangeParts.endCell,
    ...styleToMcpArgs(style),
  });
}

async function writeData(
  stored: StoredWorkbook,
  sheet: string,
  data: Array<Array<string | number | boolean | null>>,
  startCell: string,
): Promise<string> {
  return workbookTool(stored, "write_data_to_excel", {
    sheet_name: sheet,
    data,
    start_cell: startCell,
  });
}

function parseReadResult(text: string): McpReadResult {
  if (/no data found/i.test(text)) return { cells: [] };
  try {
    return JSON.parse(text) as McpReadResult;
  } catch {
    return { cells: [] };
  }
}

function cellsToRows(result: McpReadResult): unknown[][] {
  const cells = result.cells ?? [];
  if (cells.length === 0) return [];
  const minRow = Math.min(...cells.map((cell) => cell.row));
  const maxRow = Math.max(...cells.map((cell) => cell.row));
  const minCol = Math.min(...cells.map((cell) => cell.column));
  const maxCol = Math.max(...cells.map((cell) => cell.column));
  const rows: unknown[][] = [];
  const cellMap = new Map(cells.map((cell) => [`${cell.row}:${cell.column}`, cell.value]));
  for (let rowNumber = minRow; rowNumber <= maxRow; rowNumber++) {
    const row: unknown[] = [];
    for (let columnNumber = minCol; columnNumber <= maxCol; columnNumber++) {
      row.push(cellMap.get(`${rowNumber}:${columnNumber}`) ?? null);
    }
    rows.push(row);
  }
  return rows;
}

async function readRangeFromMcp(
  stored: StoredWorkbook,
  sheet: string,
  range?: string,
  maxRows = DEFAULT_RANGE_PREVIEW_ROWS,
  maxCols = DEFAULT_RANGE_PREVIEW_COLS,
): Promise<McpReadResult> {
  const effectiveRange = range ?? `A1:${colIndexToLetters(maxCols)}${maxRows}`;
  const rangeParts = splitRange(effectiveRange);
  const text = await workbookTool(stored, "read_data_from_excel", {
    sheet_name: sheet,
    start_cell: rangeParts.startCell,
    end_cell: rangeParts.endCell,
    preview_only: false,
  });
  return parseReadResult(text);
}

async function readSheetFromMcp(stored: StoredWorkbook, sheet: string): Promise<McpReadResult> {
  const text = await workbookTool(stored, "read_data_from_excel", {
    sheet_name: sheet,
    start_cell: "A1",
    preview_only: false,
  });
  return parseReadResult(text);
}

async function findAppendRow(stored: StoredWorkbook, sheet: string): Promise<number> {
  const result = await readSheetFromMcp(stored, sheet);
  const cells = result.cells ?? [];
  if (cells.length === 0) return 1;
  return Math.max(...cells.map((cell) => cell.row)) + 1;
}

function parseSheetNames(metadata: string): string[] {
  return [...metadata.matchAll(/['"]name['"]:\s*['"]([^'"]+)['"]/g)]
    .map((match) => match[1])
    .filter(Boolean);
}

async function summariseWorkbook(stored: StoredWorkbook): Promise<Record<string, unknown>> {
  const metadataText = await workbookTool(stored, "get_workbook_metadata", { include_ranges: true });
  return {
    workbookId: stored.id,
    name: stored.name,
    kind: stored.kind,
    derivedFrom: stored.derivedFrom,
    metadata: metadataText,
  };
}

async function executeOperations(stored: StoredWorkbook, operations: Operation[]): Promise<OpResult[]> {
  const results: OpResult[] = [];
  for (let index = 0; index < operations.length; index++) {
    const operation = operations[index];
    try {
      const cellsAffected = await executeOne(stored, operation);
      results.push({ index, op: operation.op, ok: true, cellsAffected });
    } catch (error) {
      results.push({
        index,
        op: operation.op,
        ok: false,
        message: error instanceof Error ? error.message : "Unknown operation error",
      });
    }
  }
  return results;
}

async function executeOne(stored: StoredWorkbook, operation: Operation): Promise<number> {
  switch (operation.op) {
    case "setCell": {
      if (containsFormula(operation.value)) {
        await workbookTool(stored, "apply_formula", {
          sheet_name: operation.sheet,
          cell: operation.address,
          formula: normalizeFormula(operation.value.formula),
        });
      } else {
        await writeData(stored, operation.sheet, [[normalizeValue(operation.value)]], operation.address);
      }
      if (operation.style) await applyStyle(stored, operation.sheet, operation.address, operation.style);
      return 1;
    }
    case "setRange": {
      const normalized = operation.values.map((row) => row.map(normalizeValue));
      await writeData(stored, operation.sheet, normalized, operation.startAddress);
      for (let rowIndex = 0; rowIndex < operation.values.length; rowIndex++) {
        const row = operation.values[rowIndex];
        for (let columnIndex = 0; columnIndex < row.length; columnIndex++) {
          const value = row[columnIndex];
          if (containsFormula(value)) {
            const start = parseA1Range(operation.startAddress);
            const address = `${colIndexToLetters(start.startCol + columnIndex)}${start.startRow + rowIndex}`;
            await workbookTool(stored, "apply_formula", {
              sheet_name: operation.sheet,
              cell: address,
              formula: normalizeFormula(value.formula),
            });
          }
        }
      }
      if (operation.style) {
        const maxColumns = Math.max(...operation.values.map((row) => row.length));
        await applyStyle(
          stored,
          operation.sheet,
          rangeFromStartAndSize(operation.startAddress, operation.values.length, maxColumns),
          operation.style,
        );
      }
      return operation.values.reduce((sum, row) => sum + row.length, 0);
    }
    case "appendRow": {
      const rowNumber = await findAppendRow(stored, operation.sheet);
      await writeData(stored, operation.sheet, [operation.values.map(normalizeValue)], `A${rowNumber}`);
      return operation.values.length;
    }
    case "appendRows": {
      const rowNumber = await findAppendRow(stored, operation.sheet);
      await writeData(stored, operation.sheet, operation.rows.map((row) => row.map(normalizeValue)), `A${rowNumber}`);
      return operation.rows.reduce((sum, row) => sum + row.length, 0);
    }
    case "insertRow": {
      await workbookTool(stored, "insert_rows", {
        sheet_name: operation.sheet,
        start_row: operation.at,
        count: 1,
      });
      if (operation.values?.length) {
        await writeData(stored, operation.sheet, [operation.values.map(normalizeValue)], `A${operation.at}`);
      }
      return operation.values?.length ?? 0;
    }
    case "insertColumn": {
      await workbookTool(stored, "insert_columns", {
        sheet_name: operation.sheet,
        start_col: operation.at,
        count: 1,
      });
      if (operation.values?.length) {
        const data = operation.values.map((value) => [normalizeValue(value)]);
        await writeData(stored, operation.sheet, data, `${colIndexToLetters(operation.at)}1`);
      }
      return operation.values?.length ?? 0;
    }
    case "deleteRows": {
      await workbookTool(stored, "delete_sheet_rows", {
        sheet_name: operation.sheet,
        start_row: operation.start,
        count: operation.count,
      });
      return operation.count;
    }
    case "deleteColumns": {
      await workbookTool(stored, "delete_sheet_columns", {
        sheet_name: operation.sheet,
        start_col: operation.start,
        count: operation.count,
      });
      return operation.count;
    }
    case "clearRange": {
      const box = parseA1Range(operation.range);
      const data = Array.from({ length: box.endRow - box.startRow + 1 }, () =>
        Array.from({ length: box.endCol - box.startCol + 1 }, () => null),
      );
      await writeData(stored, operation.sheet, data, `${colIndexToLetters(box.startCol)}${box.startRow}`);
      return data.reduce((sum, row) => sum + row.length, 0);
    }
    case "copyRange": {
      const source = splitRange(operation.sourceRange);
      await workbookTool(stored, "copy_range", {
        sheet_name: operation.sheet,
        source_start: source.startCell,
        source_end: source.endCell,
        target_start: splitRange(operation.destinationStart).startCell,
        target_sheet: operation.destinationSheet ?? operation.sheet,
      });
      return 1;
    }
    case "setFormula": {
      await workbookTool(stored, "apply_formula", {
        sheet_name: operation.sheet,
        cell: operation.address,
        formula: normalizeFormula(operation.formula),
      });
      return 1;
    }
    case "fillFormula": {
      const box = parseA1Range(operation.range);
      let applied = 0;
      for (let rowNumber = box.startRow; rowNumber <= box.endRow; rowNumber++) {
        for (let columnNumber = box.startCol; columnNumber <= box.endCol; columnNumber++) {
          await workbookTool(stored, "apply_formula", {
            sheet_name: operation.sheet,
            cell: `${colIndexToLetters(columnNumber)}${rowNumber}`,
            formula: normalizeFormula(operation.formula),
          });
          applied++;
        }
      }
      return applied;
    }
    case "mergeCells": {
      const range = splitRange(operation.range);
      await workbookTool(stored, "merge_cells", {
        sheet_name: operation.sheet,
        start_cell: range.startCell,
        end_cell: range.endCell,
      });
      return 1;
    }
    case "unmergeCells": {
      const range = splitRange(operation.range);
      await workbookTool(stored, "unmerge_cells", {
        sheet_name: operation.sheet,
        start_cell: range.startCell,
        end_cell: range.endCell,
      });
      return 1;
    }
    case "setStyleRange": {
      await applyStyle(stored, operation.sheet, operation.range, operation.style);
      return 1;
    }
    case "addSheet": {
      if (operation.copyFrom) {
        await workbookTool(stored, "copy_worksheet", {
          source_sheet: operation.copyFrom,
          target_sheet: operation.name,
        });
      } else {
        await workbookTool(stored, "create_worksheet", { sheet_name: operation.name });
      }
      return 1;
    }
    case "renameSheet": {
      await workbookTool(stored, "rename_worksheet", {
        old_name: operation.sheet,
        new_name: operation.newName,
      });
      return 1;
    }
    case "deleteSheet": {
      await workbookTool(stored, "delete_worksheet", { sheet_name: operation.sheet });
      return 1;
    }
    case "duplicateSheet": {
      await workbookTool(stored, "copy_worksheet", {
        source_sheet: operation.sheet,
        target_sheet: operation.newName,
      });
      return 1;
    }
    case "setColumnWidth":
    case "setRowHeight":
    case "setAutoFilter":
    case "freezePanes":
    case "addNamedRange":
    case "findAndReplace":
    case "sortRange":
      throw new Error(`The Excel MCP server wrapper does not support ${operation.op} yet.`);
  }
}

async function buildOutputAttachment(stored: StoredWorkbook): Promise<ExcelOutputAttachment> {
  return {
    attachmentId: stored.id,
    name: stored.name,
    size: getWorkbookFileSize(stored),
    mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    workbookKind: stored.kind,
    derivedFrom: stored.derivedFrom,
  };
}

function deriveEditedName(name: string): string {
  const base = name.replace(/\.xlsx$/i, "");
  return `${base}-edited.xlsx`;
}

function ensureValidFileName(name: string): string {
  const safe = name.replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_").trim();
  return /\.xlsx$/i.test(safe) ? safe : `${safe}.xlsx`;
}

/** Builds the agent's Excel toolbelt, scoped to the calling user + chat session. */
export function createExcelTools(context: AgentToolContext) {
  if (!context.userId || !context.sessionId) {
    throw new Error("Missing agent tool runtime context");
  }
  const userId = context.userId;
  const sessionId = context.sessionId;
  const savedOutputIds = new Set<string>();

  const tools = [
    tool(
      async () => {
        await requirePermission("ai-chat:write");
        const workbooks = await Promise.all(
          listSessionWorkbooks({ userId, sessionId }).map((workbook) => summariseWorkbook(workbook)),
        );
        return JSON.stringify({ workbooks });
      },
      {
        name: "excel_list_workbooks",
        description:
          "Lists every Excel workbook currently available in this chat session (uploaded inputs + agent-produced outputs).",
        schema: ListWorkbooksSchema,
      },
    ),
    tool(
      async ({ workbookId }) => {
        await requirePermission("ai-chat:write");
        const stored = requireWorkbook({ userId, sessionId, workbookId });
        return JSON.stringify(await summariseWorkbook(stored));
      },
      {
        name: "excel_inspect",
        description:
          "Returns workbook metadata from the Excel MCP server: sheet names, dimensions and ranges. Call this before reading cells.",
        schema: InspectSchema,
      },
    ),
    tool(
      async ({ workbookId, sheet, range, includeFormulas, maxRows, maxCols }) => {
        await requirePermission("ai-chat:write");
        const stored = requireWorkbook({ userId, sessionId, workbookId });
        const result = await readRangeFromMcp(stored, sheet, range, maxRows, maxCols);
        return JSON.stringify({
          sheet,
          rangeRead: result.range ?? range ?? `A1:${colIndexToLetters(maxCols)}${maxRows}`,
          includeFormulas,
          rows: cellsToRows(result),
          rawCellCount: result.cells?.length ?? 0,
          provider: "excel-mcp-server",
        });
      },
      {
        name: "excel_read_range",
        description:
          "Reads cells through the Excel MCP server. Provide an explicit A1 range like A1:D20 whenever possible.",
        schema: ReadRangeSchema,
      },
    ),
    tool(
      async ({ workbookId, query, sheet, matchCase, regex, maxMatches }) => {
        await requirePermission("ai-chat:write");
        const stored = requireWorkbook({ userId, sessionId, workbookId });
        const targetSheets = sheet
          ? [sheet]
          : parseSheetNames(String((await summariseWorkbook(stored)).metadata ?? ""));
        const safeSheets = targetSheets.length > 0 ? targetSheets : [sheet ?? "Sheet1"];
        const flags = matchCase ? "" : "i";
        const pattern = regex ? new RegExp(query, flags) : new RegExp(escapeRegExp(query), flags);
        const matches: Array<{ sheet: string; address: string; value: unknown }> = [];
        for (const sheetName of safeSheets) {
          const result = await readSheetFromMcp(stored, sheetName);
          for (const cell of result.cells ?? []) {
            if (matches.length >= maxMatches) break;
            const valueText = String(cell.value ?? "");
            if (valueText && pattern.test(valueText)) {
              matches.push({ sheet: sheetName, address: cell.address, value: cell.value });
              pattern.lastIndex = 0;
            }
          }
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
          "Finds cells whose value matches a substring or regex by reading workbook data through the Excel MCP server.",
        schema: FindSchema,
      },
    ),
    tool(
      async ({ name }) => {
        await requirePermission("ai-chat:write");
        const stored = await registerEmptyWorkbook({ userId, sessionId, name });
        return JSON.stringify({ workbookId: stored.id, name: stored.name, provider: "excel-mcp-server" });
      },
      {
        name: "excel_create_workbook",
        description:
          "Creates a brand-new empty workbook through the Excel MCP server. Returns the workbookId for subsequent edits.",
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
        const failed = results.filter((result) => !result.ok);
        return JSON.stringify({
          workbookId: target.id,
          name: target.name,
          inPlace,
          provider: "excel-mcp-server",
          totalOperations: operations.length,
          succeeded: results.length - failed.length,
          failed: failed.length,
          results,
          summary: await summariseWorkbook(target),
          notice:
            failed.length === 0
              ? "All operations applied successfully through Excel MCP. Call excel_save_as_attachment to make this workbook downloadable for the user."
              : "Some operations failed; inspect the results array, adjust the batch, then call excel_save_as_attachment when done.",
        });
      },
      {
        name: "excel_apply_operations",
        description: [
          "Applies a batch of structured edit operations to a workbook through the Excel MCP server.",
          "Supported by the MCP wrapper: setCell, setRange, appendRow(s), insert/delete rows/columns, clearRange, copyRange, formulas, merge/unmerge, style range, add/rename/delete/duplicate sheet.",
          "Some legacy ExcelJS-only operations return a per-operation failure until the upstream MCP server supports them.",
          "By default the original workbook is cloned and edits land in a new output workbook; set inPlace=true only when intentional.",
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
          notice: "Saved. The user can now download this workbook from the chat.",
        });
      },
      {
        name: "excel_save_as_attachment",
        description:
          "Marks a workbook as a downloadable result for the user. Always call this once you finish editing.",
        schema: SaveAttachmentSchema,
      },
    ),
  ];

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