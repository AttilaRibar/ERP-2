import * as XLSX from "xlsx";
import type { AgentFileAttachment } from "@/lib/agent/types";
import type { AiChatAttachment } from "@/types/ai-chat";
import { registerInputWorkbook } from "@/lib/agent/excel/workbook-session";

export interface IncomingAgentFileAttachment {
  name: string;
  mediaType: string;
  size: number;
  base64: string;
}

const MAX_EXTRACTED_CHARS = 18_000;
const MAX_PREVIEW_SHEETS = 4;
const MAX_PREVIEW_ROWS_PER_SHEET = 8;
const MAX_PREVIEW_COLS_PER_SHEET = 12;

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "";
}

function truncateText(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_EXTRACTED_CHARS) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, MAX_EXTRACTED_CHARS)}\n\n[... a fájlkivonat hossza miatt rövidítve ...]`,
    truncated: true,
  };
}

function isTextLike(file: IncomingAgentFileAttachment): boolean {
  const extension = extensionOf(file.name);
  return (
    file.mediaType.startsWith("text/") ||
    ["csv", "json", "md", "txt", "log", "xml", "yaml", "yml"].includes(extension)
  );
}

function isSpreadsheet(file: IncomingAgentFileAttachment): boolean {
  const extension = extensionOf(file.name);
  return (
    ["xls", "xlsx", "xlsm", "csv"].includes(extension) ||
    file.mediaType.includes("spreadsheet") ||
    file.mediaType.includes("excel")
  );
}

function isXlsxNative(file: IncomingAgentFileAttachment): boolean {
  const extension = extensionOf(file.name);
  return extension === "xlsx" || extension === "xlsm";
}

function isPdf(file: IncomingAgentFileAttachment): boolean {
  return file.mediaType === "application/pdf" || extensionOf(file.name) === "pdf";
}

/** Anthropic accepts PDFs up to ~32 MB / 100 pages as native document blocks. */
const MAX_NATIVE_PDF_BYTES = 32 * 1024 * 1024;

function extractText(buffer: Buffer): string {
  return buffer.toString("utf8").replace(/\u0000/g, "").trim();
}

function previewCell(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * Builds a *slim* summary of a spreadsheet for the LLM prompt.
 *
 * Token-budget rules:
 * - Only the first 4 sheets, 8 rows × 12 columns each.
 * - The agent should call the `excel_*` tools for anything beyond the preview.
 * - Sheet name + dimensions are always included so the agent can plan reads.
 */
function buildSpreadsheetSummary(buffer: Buffer, fileName: string): string {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const lines: string[] = [
    `Excel munkafüzet: ${fileName}`,
    `Munkalapok (${workbook.SheetNames.length}): ${workbook.SheetNames.join(", ")}`,
    "Az alábbi minta kizárólag tájékoztató jellegű — a részletes olvasáshoz hívd az excel_read_range eszközt.",
  ];

  for (const sheetName of workbook.SheetNames.slice(0, MAX_PREVIEW_SHEETS)) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const ref = sheet["!ref"];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      blankrows: false,
    }) as unknown[][];

    const nonEmptyRows = rows.filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""));
    const sampleRows = nonEmptyRows
      .slice(0, MAX_PREVIEW_ROWS_PER_SHEET)
      .map((row) => row.slice(0, MAX_PREVIEW_COLS_PER_SHEET).map(previewCell));

    lines.push("");
    lines.push(`Munkalap: ${sheetName} (használt tartomány: ${ref ?? "ismeretlen"}, ~${nonEmptyRows.length} adatsor)`);
    lines.push("Első sorok JSON-ként (max 8 sor × 12 oszlop):");
    lines.push(JSON.stringify(sampleRows));
  }

  if (workbook.SheetNames.length > MAX_PREVIEW_SHEETS) {
    lines.push("");
    lines.push(
      `[${workbook.SheetNames.length - MAX_PREVIEW_SHEETS} további munkalap nem került a kivonatba — használd az excel_inspect eszközt.]`,
    );
  }

  return lines.join("\n");
}

export interface ProcessAttachmentsOptions {
  userId: string;
  sessionId: string;
}

/**
 * Processes incoming attachments for an agent turn:
 * - Native `.xlsx` / `.xlsm`: registered into the workbook-session store and
 *   reachable via the `excel_*` tools by `workbookId`. The prompt only sees
 *   a slim preview to save tokens.
 * - Legacy `.xls` / `.csv`: parsed as a text preview only (not editable
 *   through the Excel tool surface — agent should ask the user to re-export
 *   as xlsx).
 * - Text-like files: extracted as before.
 */
export async function processAgentFileAttachments(
  files: IncomingAgentFileAttachment[],
  options: ProcessAttachmentsOptions,
): Promise<AgentFileAttachment[]> {
  const results: AgentFileAttachment[] = [];

  for (const file of files) {
    const buffer = Buffer.from(file.base64, "base64");

    try {
      if (isPdf(file)) {
        if (buffer.byteLength > MAX_NATIVE_PDF_BYTES) {
          results.push({
            name: file.name,
            mediaType: "application/pdf",
            size: file.size,
            extractionStatus: "failed",
            error: "A PDF mérete meghaladja a natív feldolgozás limitjét (32 MB).",
          });
          continue;
        }
        results.push({
          name: file.name,
          mediaType: "application/pdf",
          size: file.size,
          // base64 megőrzése a natív Claude document content-blockhoz
          base64: file.base64,
          extractionStatus: "processed",
          summary:
            "PDF dokumentum natív formában csatolva — Claude közvetlenül olvassa a tartalmát (szöveg + képek).",
        });
        continue;
      }

      if (isXlsxNative(file)) {
        const stored = await registerInputWorkbook({
          userId: options.userId,
          sessionId: options.sessionId,
          name: file.name,
          buffer,
        });

        const summary = buildSpreadsheetSummary(buffer, file.name);
        const truncated = truncateText(summary);
        results.push({
          name: file.name,
          mediaType: file.mediaType,
          size: file.size,
          extractionStatus: truncated.truncated ? "truncated" : "processed",
          extractedText: truncated.text,
          summary: `Szerkeszthető Excel — workbookId=${stored.id}`,
          workbookId: stored.id,
        });
        continue;
      }

      if (isSpreadsheet(file)) {
        const summary = buildSpreadsheetSummary(buffer, file.name);
        const truncated = truncateText(summary);
        results.push({
          name: file.name,
          mediaType: file.mediaType,
          size: file.size,
          extractionStatus: truncated.truncated ? "truncated" : "processed",
          extractedText: truncated.text,
          summary:
            "Csak olvasható kivonat. Szerkesztéshez kérd a felhasználót, hogy mentse el .xlsx formátumban.",
        });
        continue;
      }

      if (isTextLike(file)) {
        const truncated = truncateText(extractText(buffer));
        results.push({
          name: file.name,
          mediaType: file.mediaType,
          size: file.size,
          extractionStatus: truncated.truncated ? "truncated" : "processed",
          extractedText: truncated.text,
          summary: truncated.truncated
            ? "A fájl feldolgozva, a kivonat rövidítve lett."
            : "A fájl feldolgozva.",
        });
        continue;
      }

      results.push({
        name: file.name,
        mediaType: file.mediaType,
        size: file.size,
        extractionStatus: "unsupported",
        summary: "A fájltípusból jelenleg nem készült szöveges kivonat.",
      });
    } catch (error) {
      results.push({
        name: file.name,
        mediaType: file.mediaType,
        size: file.size,
        extractionStatus: "failed",
        error: error instanceof Error ? error.message : "Ismeretlen fájlfeldolgozási hiba",
      });
    }
  }

  return results;
}

export function toStoredAttachment(file: AgentFileAttachment): AiChatAttachment {
  return {
    name: file.name,
    size: file.size ?? 0,
    type: file.mediaType,
    extractionStatus: file.extractionStatus,
    extractedText: file.extractedText,
    summary: file.summary,
    error: file.error,
  };
}

export function toAgentAttachment(file: AiChatAttachment): AgentFileAttachment {
  return {
    name: file.name,
    mediaType: file.type,
    size: file.size,
    extractionStatus: file.extractionStatus,
    extractedText: file.extractedText,
    summary: file.summary,
    error: file.error,
  };
}
