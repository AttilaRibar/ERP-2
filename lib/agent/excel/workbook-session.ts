/**
 * In-memory workbook session store for the AI agent's Excel toolset.
 *
 * Goals:
 * - Avoid re-parsing/re-serializing the workbook on every tool call.
 * - Avoid dumping huge spreadsheet content into the LLM context: the agent
 *   references workbooks by short opaque IDs and reads only the ranges it
 *   needs through dedicated tools.
 * - Scope strictly to `(userId, sessionId)` so a user can never reach another
 *   user's workbook. Entries expire automatically.
 *
 * NOTE: This is process-local memory. In a multi-instance deployment each
 * server instance keeps its own cache; that is acceptable because the cache
 * is rebuilt from the message history on demand and download URLs target the
 * same instance the agent ran on (sticky via session ID + Cognito).
 */
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";

export type WorkbookKind = "input" | "output";

export interface StoredWorkbook {
  /** Stable opaque ID exposed to the agent and the download endpoint. */
  id: string;
  /** Owning user (Cognito sub). */
  userId: string;
  /** Owning chat session. */
  sessionId: string;
  /** Display file name (with .xlsx extension). */
  name: string;
  /** Loaded ExcelJS workbook. Mutated in-place by tools. */
  workbook: ExcelJS.Workbook;
  /** Whether this is an originally uploaded file or an agent-produced result. */
  kind: WorkbookKind;
  /** Optional reference to the parent (input) workbook ID for outputs. */
  derivedFrom?: string;
  /** Created timestamp (ms). */
  createdAt: number;
  /** Last access timestamp (ms) for TTL eviction. */
  lastAccessAt: number;
}

const TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_PER_SESSION = 20;
const MAX_TOTAL = 200;

const store = new Map<string, StoredWorkbook>();

type ExcelLoadInput = Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0];

function toExcelLoadInput(buffer: Buffer | ArrayBuffer): ExcelLoadInput {
  return buffer as unknown as ExcelLoadInput;
}

function sweep(): void {
  const now = Date.now();
  for (const [id, wb] of store) {
    if (now - wb.lastAccessAt > TTL_MS) store.delete(id);
  }
  // Hard cap: drop oldest if exceeded.
  if (store.size > MAX_TOTAL) {
    const entries = [...store.entries()].sort(
      (a, b) => a[1].lastAccessAt - b[1].lastAccessAt,
    );
    for (const [id] of entries.slice(0, store.size - MAX_TOTAL)) {
      store.delete(id);
    }
  }
}

function enforceSessionCap(userId: string, sessionId: string): void {
  const owned = [...store.values()]
    .filter((w) => w.userId === userId && w.sessionId === sessionId)
    .sort((a, b) => a.lastAccessAt - b.lastAccessAt);
  while (owned.length > MAX_PER_SESSION) {
    const victim = owned.shift();
    if (victim) store.delete(victim.id);
  }
}

function ensureXlsxName(name: string): string {
  const base = name.replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_").trim();
  if (/\.xlsx$/i.test(base)) return base;
  if (/\.(xls|xlsm|csv)$/i.test(base)) {
    return base.replace(/\.(xls|xlsm|csv)$/i, ".xlsx");
  }
  return `${base || "munkafuzet"}.xlsx`;
}

/** Loads an uploaded buffer into the session and returns its store ID. */
export async function registerInputWorkbook(input: {
  userId: string;
  sessionId: string;
  name: string;
  buffer: Buffer;
}): Promise<StoredWorkbook> {
  sweep();
  const workbook = new ExcelJS.Workbook();
  // ExcelJS reads .xlsx (Office Open XML). For .xls/.csv fallback handled above.
  await workbook.xlsx.load(toExcelLoadInput(input.buffer));

  const id = randomUUID();
  const now = Date.now();
  const stored: StoredWorkbook = {
    id,
    userId: input.userId,
    sessionId: input.sessionId,
    name: ensureXlsxName(input.name),
    workbook,
    kind: "input",
    createdAt: now,
    lastAccessAt: now,
  };
  store.set(id, stored);
  enforceSessionCap(input.userId, input.sessionId);
  return stored;
}

/** Creates a brand-new empty workbook in the session. */
export function registerEmptyWorkbook(input: {
  userId: string;
  sessionId: string;
  name: string;
}): StoredWorkbook {
  sweep();
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Sheet1");

  const id = randomUUID();
  const now = Date.now();
  const stored: StoredWorkbook = {
    id,
    userId: input.userId,
    sessionId: input.sessionId,
    name: ensureXlsxName(input.name),
    workbook,
    kind: "output",
    createdAt: now,
    lastAccessAt: now,
  };
  store.set(id, stored);
  enforceSessionCap(input.userId, input.sessionId);
  return stored;
}

/** Clones an existing workbook (deep copy via xlsx round-trip). */
export async function cloneWorkbook(input: {
  userId: string;
  sessionId: string;
  sourceId: string;
  name: string;
  kind?: WorkbookKind;
}): Promise<StoredWorkbook> {
  const source = requireWorkbook({
    userId: input.userId,
    sessionId: input.sessionId,
    workbookId: input.sourceId,
  });
  const buffer = await source.workbook.xlsx.writeBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(toExcelLoadInput(buffer));

  const id = randomUUID();
  const now = Date.now();
  const stored: StoredWorkbook = {
    id,
    userId: input.userId,
    sessionId: input.sessionId,
    name: ensureXlsxName(input.name),
    workbook,
    kind: input.kind ?? "output",
    derivedFrom: source.id,
    createdAt: now,
    lastAccessAt: now,
  };
  store.set(id, stored);
  enforceSessionCap(input.userId, input.sessionId);
  return stored;
}

/** Looks up a workbook owned by the given user/session. */
export function getWorkbook(input: {
  userId: string;
  sessionId: string;
  workbookId: string;
}): StoredWorkbook | null {
  const wb = store.get(input.workbookId);
  if (!wb) return null;
  if (wb.userId !== input.userId || wb.sessionId !== input.sessionId) return null;
  if (Date.now() - wb.lastAccessAt > TTL_MS) {
    store.delete(input.workbookId);
    return null;
  }
  wb.lastAccessAt = Date.now();
  return wb;
}

/** Strict variant — throws a descriptive error if missing. */
export function requireWorkbook(input: {
  userId: string;
  sessionId: string;
  workbookId: string;
}): StoredWorkbook {
  const wb = getWorkbook(input);
  if (!wb) {
    throw new Error(
      `Workbook ${input.workbookId} not found in this session (it may have expired or never existed).`,
    );
  }
  return wb;
}

/** Looks up by ID alone — used by the download endpoint after RBAC check. */
export function getWorkbookForDownload(input: {
  userId: string;
  workbookId: string;
}): StoredWorkbook | null {
  const wb = store.get(input.workbookId);
  if (!wb) return null;
  if (wb.userId !== input.userId) return null;
  if (Date.now() - wb.lastAccessAt > TTL_MS) {
    store.delete(input.workbookId);
    return null;
  }
  wb.lastAccessAt = Date.now();
  return wb;
}

/** Lists workbooks visible to a session (input + output). */
export function listSessionWorkbooks(input: {
  userId: string;
  sessionId: string;
}): StoredWorkbook[] {
  sweep();
  return [...store.values()].filter(
    (w) => w.userId === input.userId && w.sessionId === input.sessionId,
  );
}

/** Renames a stored workbook (does not touch the workbook content). */
export function renameWorkbook(input: {
  userId: string;
  sessionId: string;
  workbookId: string;
  name: string;
}): StoredWorkbook {
  const wb = requireWorkbook(input);
  wb.name = ensureXlsxName(input.name);
  return wb;
}

/** Drops a workbook from the cache (e.g. session close, manual cleanup). */
export function deleteWorkbook(input: {
  userId: string;
  sessionId: string;
  workbookId: string;
}): boolean {
  const wb = getWorkbook(input);
  if (!wb) return false;
  store.delete(input.workbookId);
  return true;
}

/** Serializes a workbook to xlsx bytes for download or persistence. */
export async function serializeWorkbook(stored: StoredWorkbook): Promise<Buffer> {
  const buffer = await stored.workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}
