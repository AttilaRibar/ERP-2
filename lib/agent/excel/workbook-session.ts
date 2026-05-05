import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { callExcelMcpTool } from "@/lib/agent/excel/mcp-client";

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
  /** Absolute local path used by the Next.js process for upload/download. */
  filePath: string;
  /** Path sent to the Excel MCP server. Absolute for stdio, relative for HTTP. */
  mcpFilePath: string;
  /** Whether this is an originally uploaded file or an agent-produced result. */
  kind: WorkbookKind;
  /** Optional reference to the parent (input) workbook ID for outputs. */
  derivedFrom?: string;
  /** Created timestamp (ms). */
  createdAt: number;
  /** Last access timestamp (ms) for TTL eviction. */
  lastAccessAt: number;
}

const TTL_MS = 30 * 60 * 1000;
const MAX_PER_SESSION = 20;
const MAX_TOTAL = 200;

const store = new Map<string, StoredWorkbook>();

function getExcelFilesRoot(): string {
  return path.resolve(process.env.EXCEL_MCP_FILES_DIR ?? path.join(process.cwd(), ".tmp", "agent-excel"));
}

function usesRelativeMcpPaths(): boolean {
  return Boolean(process.env.EXCEL_MCP_URL?.trim());
}

function sanitizePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "unknown";
}

function ensureXlsxName(name: string): string {
  const base = name.replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_").trim();
  if (/\.xlsx$/i.test(base)) return base;
  if (/\.(xls|xlsm|csv)$/i.test(base)) {
    return base.replace(/\.(xls|xlsm|csv)$/i, ".xlsx");
  }
  return `${base || "munkafuzet"}.xlsx`;
}

function createWorkbookPaths(input: {
  userId: string;
  sessionId: string;
  workbookId: string;
  name: string;
}): { filePath: string; mcpFilePath: string } {
  const root = getExcelFilesRoot();
  const relativePath = path.join(
    "sessions",
    sanitizePathPart(input.userId),
    sanitizePathPart(input.sessionId),
    `${input.workbookId}-${ensureXlsxName(input.name)}`,
  );
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });

  return {
    filePath,
    mcpFilePath: usesRelativeMcpPaths() ? relativePath.split(path.sep).join("/") : filePath,
  };
}

function deleteWorkbookFile(workbook: StoredWorkbook): void {
  try {
    if (existsSync(workbook.filePath)) rmSync(workbook.filePath, { force: true });
  } catch {
    // Best-effort cleanup only; stale temp files are safe to overwrite by UUID.
  }
}

function sweep(): void {
  const now = Date.now();
  for (const [id, workbook] of store) {
    if (now - workbook.lastAccessAt > TTL_MS) {
      deleteWorkbookFile(workbook);
      store.delete(id);
    }
  }
  if (store.size > MAX_TOTAL) {
    const entries = [...store.entries()].sort(
      (left, right) => left[1].lastAccessAt - right[1].lastAccessAt,
    );
    for (const [id, workbook] of entries.slice(0, store.size - MAX_TOTAL)) {
      deleteWorkbookFile(workbook);
      store.delete(id);
    }
  }
}

function enforceSessionCap(userId: string, sessionId: string): void {
  const owned = [...store.values()]
    .filter((workbook) => workbook.userId === userId && workbook.sessionId === sessionId)
    .sort((left, right) => left.lastAccessAt - right.lastAccessAt);
  while (owned.length > MAX_PER_SESSION) {
    const victim = owned.shift();
    if (victim) {
      deleteWorkbookFile(victim);
      store.delete(victim.id);
    }
  }
}

function createStoredWorkbook(input: {
  userId: string;
  sessionId: string;
  name: string;
  kind: WorkbookKind;
  derivedFrom?: string;
}): StoredWorkbook {
  sweep();
  const id = randomUUID();
  const name = ensureXlsxName(input.name);
  const paths = createWorkbookPaths({
    userId: input.userId,
    sessionId: input.sessionId,
    workbookId: id,
    name,
  });
  const now = Date.now();
  const stored: StoredWorkbook = {
    id,
    userId: input.userId,
    sessionId: input.sessionId,
    name,
    filePath: paths.filePath,
    mcpFilePath: paths.mcpFilePath,
    kind: input.kind,
    derivedFrom: input.derivedFrom,
    createdAt: now,
    lastAccessAt: now,
  };
  store.set(id, stored);
  enforceSessionCap(input.userId, input.sessionId);
  return stored;
}

/** Writes an uploaded workbook into the session file store. */
export async function registerInputWorkbook(input: {
  userId: string;
  sessionId: string;
  name: string;
  buffer: Buffer;
}): Promise<StoredWorkbook> {
  const stored = createStoredWorkbook({
    userId: input.userId,
    sessionId: input.sessionId,
    name: input.name,
    kind: "input",
  });
  await writeFile(stored.filePath, input.buffer);
  return stored;
}

/** Creates a brand-new empty workbook through the Excel MCP server. */
export async function registerEmptyWorkbook(input: {
  userId: string;
  sessionId: string;
  name: string;
}): Promise<StoredWorkbook> {
  const stored = createStoredWorkbook({
    userId: input.userId,
    sessionId: input.sessionId,
    name: input.name,
    kind: "output",
  });
  try {
    await callExcelMcpTool("create_workbook", { filepath: stored.mcpFilePath });
  } catch (error) {
    deleteWorkbookFile(stored);
    store.delete(stored.id);
    throw error;
  }
  return stored;
}

/** Clones an existing workbook file into a new session output. */
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
  const stored = createStoredWorkbook({
    userId: input.userId,
    sessionId: input.sessionId,
    name: input.name,
    kind: input.kind ?? "output",
    derivedFrom: source.id,
  });
  await copyFile(source.filePath, stored.filePath);
  return stored;
}

/** Looks up a workbook owned by the given user/session. */
export function getWorkbook(input: {
  userId: string;
  sessionId: string;
  workbookId: string;
}): StoredWorkbook | null {
  const workbook = store.get(input.workbookId);
  if (!workbook) return null;
  if (workbook.userId !== input.userId || workbook.sessionId !== input.sessionId) return null;
  if (Date.now() - workbook.lastAccessAt > TTL_MS) {
    deleteWorkbookFile(workbook);
    store.delete(input.workbookId);
    return null;
  }
  workbook.lastAccessAt = Date.now();
  return workbook;
}

/** Strict variant that throws a descriptive error if missing. */
export function requireWorkbook(input: {
  userId: string;
  sessionId: string;
  workbookId: string;
}): StoredWorkbook {
  const workbook = getWorkbook(input);
  if (!workbook) {
    throw new Error(
      `Workbook ${input.workbookId} not found in this session (it may have expired or never existed).`,
    );
  }
  return workbook;
}

/** Looks up by ID alone; used by the download endpoint after RBAC check. */
export function getWorkbookForDownload(input: {
  userId: string;
  workbookId: string;
}): StoredWorkbook | null {
  const workbook = store.get(input.workbookId);
  if (!workbook) return null;
  if (workbook.userId !== input.userId) return null;
  if (Date.now() - workbook.lastAccessAt > TTL_MS) {
    deleteWorkbookFile(workbook);
    store.delete(input.workbookId);
    return null;
  }
  workbook.lastAccessAt = Date.now();
  return workbook;
}

/** Lists workbooks visible to a session (input + output). */
export function listSessionWorkbooks(input: {
  userId: string;
  sessionId: string;
}): StoredWorkbook[] {
  sweep();
  return [...store.values()].filter(
    (workbook) => workbook.userId === input.userId && workbook.sessionId === input.sessionId,
  );
}

/** Renames a stored workbook display name. */
export function renameWorkbook(input: {
  userId: string;
  sessionId: string;
  workbookId: string;
  name: string;
}): StoredWorkbook {
  const workbook = requireWorkbook(input);
  workbook.name = ensureXlsxName(input.name);
  return workbook;
}

/** Drops a workbook from the cache and removes its backing temp file. */
export function deleteWorkbook(input: {
  userId: string;
  sessionId: string;
  workbookId: string;
}): boolean {
  const workbook = getWorkbook(input);
  if (!workbook) return false;
  deleteWorkbookFile(workbook);
  store.delete(input.workbookId);
  return true;
}

/** Reads workbook bytes for download or persistence. */
export async function serializeWorkbook(stored: StoredWorkbook): Promise<Buffer> {
  return readFile(stored.filePath);
}

/** Returns current backing file size in bytes. */
export function getWorkbookFileSize(stored: StoredWorkbook): number {
  return statSync(stored.filePath).size;
}