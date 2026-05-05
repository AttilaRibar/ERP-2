import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import type { DynamicStructuredTool } from "@langchain/core/tools";

type ExcelMcpTransport = "stdio" | "http";

interface ExcelMcpConfig {
  transport: ExcelMcpTransport;
  command?: string;
  args?: string[];
  url?: string;
}

let activeClient: MultiServerMCPClient | null = null;
let toolsPromise: Promise<Map<string, DynamicStructuredTool>> | null = null;

function parseArgs(value: string | undefined): string[] {
  if (!value) return ["excel-mcp-server", "stdio"];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
  } catch {
    // Fall through to simple whitespace splitting for .env ergonomics.
  }
  return value.split(/\s+/).filter(Boolean);
}

function getExcelMcpConfig(): ExcelMcpConfig {
  const url = process.env.EXCEL_MCP_URL?.trim();
  if (url) {
    return {
      transport: "http",
      url,
    };
  }

  return {
    transport: "stdio",
    command: process.env.EXCEL_MCP_COMMAND?.trim() || "uvx",
    args: parseArgs(process.env.EXCEL_MCP_ARGS),
  };
}

function getExcelMcpTimeoutMs(): number {
  return Number(process.env.EXCEL_MCP_TIMEOUT_MS ?? 60_000);
}

function createExcelMcpClient(): MultiServerMCPClient {
  const config = getExcelMcpConfig();
  const defaultToolTimeout = getExcelMcpTimeoutMs();

  if (config.transport === "http") {
    if (!config.url) throw new Error("EXCEL_MCP_URL is required for streamable HTTP mode");
    return new MultiServerMCPClient({
      excel: {
        transport: "http",
        url: config.url,
        defaultToolTimeout,
      },
    });
  }

  return new MultiServerMCPClient({
    excel: {
      transport: "stdio",
      command: config.command ?? "uvx",
      args: config.args ?? ["excel-mcp-server", "stdio"],
      stderr: "ignore",
      defaultToolTimeout,
    },
  });
}

async function getExcelMcpToolMap(): Promise<Map<string, DynamicStructuredTool>> {
  if (!toolsPromise) {
    const client = createExcelMcpClient();
    activeClient = client;
    toolsPromise = client
      .getTools("excel")
      .then((tools) => new Map(tools.map((mcpTool) => [mcpTool.name, mcpTool])))
      .catch(async (error: unknown) => {
        if (activeClient === client) activeClient = null;
        await client.close().catch(() => undefined);
        throw error;
      });
  }
  return toolsPromise;
}

async function resetExcelMcpClient(): Promise<void> {
  const client = activeClient;
  activeClient = null;
  toolsPromise = null;
  await client?.close().catch(() => undefined);
}

function stringifyContent(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => stringifyContent(item)).filter(Boolean).join("\n");
  }
  if (typeof value !== "object") return JSON.stringify(value);

  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  if (typeof record.content === "string" || Array.isArray(record.content)) {
    return stringifyContent(record.content);
  }
  if (typeof record.uri === "string") return record.uri;
  return JSON.stringify(value);
}

function stringifyToolOutput(output: unknown): string {
  if (Array.isArray(output) && output.length === 2) {
    return stringifyContent(output[0]).trim();
  }
  return stringifyContent(output).trim();
}

/** Calls an Excel MCP tool and returns its text payload. */
export async function callExcelMcpTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  try {
    const toolMap = await getExcelMcpToolMap();
    const mcpTool = toolMap.get(name);
    if (!mcpTool) throw new Error(`Excel MCP tool ${name} is not available`);
    const result = await mcpTool.invoke(args, { timeout: getExcelMcpTimeoutMs() });
    return stringifyToolOutput(result);
  } catch (error) {
    await resetExcelMcpClient();
    const message = error instanceof Error ? error.message : "Unknown Excel MCP error";
    throw new Error(`Excel MCP tool ${name} failed: ${message}`);
  }
}

/** Useful for diagnostics and startup checks. */
export async function listExcelMcpTools(): Promise<string[]> {
  const toolMap = await getExcelMcpToolMap();
  return [...toolMap.keys()].sort();
}