import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { Serialized } from "@langchain/core/load/serializable";
import type { BaseMessage } from "@langchain/core/messages";
import type { LLMResult } from "@langchain/core/outputs";

/**
 * Per-Mtok pricing (USD). Override via env so we can keep this in sync with
 * the selected OpenRouter model without code edits. Defaults match Claude Sonnet 4.5.
 */
const PRICING = {
  inputPerMtok: Number(process.env.AGENT_PRICE_INPUT_USD ?? 3),
  outputPerMtok: Number(process.env.AGENT_PRICE_OUTPUT_USD ?? 15),
  cacheReadPerMtok: Number(process.env.AGENT_PRICE_CACHE_READ_USD ?? 0.3),
  cacheWritePerMtok: Number(process.env.AGENT_PRICE_CACHE_WRITE_USD ?? 3.75),
} as const;

/** True when the trace should print to the server console. Default ON in dev. */
function traceEnabled(): boolean {
  const flag = process.env.AGENT_TRACE;
  if (flag === "1" || flag === "true") return true;
  if (flag === "0" || flag === "false") return false;
  return process.env.NODE_ENV !== "production";
}

interface UsageBreakdown {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

interface LlmCallRecord {
  name: string;
  startedAt: number;
  durationMs: number;
  usage: UsageBreakdown;
  costUsd: number;
}

interface ToolCallRecord {
  name: string;
  startedAt: number;
  durationMs: number;
  inputPreview: string;
  outputPreview: string;
  errored: boolean;
}

export interface AgentTraceSummary {
  label: string;
  totalDurationMs: number;
  llmCalls: LlmCallRecord[];
  toolCalls: ToolCallRecord[];
  totalUsage: UsageBreakdown;
  totalCostUsd: number;
}

function emptyUsage(): UsageBreakdown {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

function computeCost(usage: UsageBreakdown): number {
  const m = 1_000_000;
  return (
    (usage.inputTokens * PRICING.inputPerMtok) / m +
    (usage.outputTokens * PRICING.outputPerMtok) / m +
    (usage.cacheReadTokens * PRICING.cacheReadPerMtok) / m +
    (usage.cacheWriteTokens * PRICING.cacheWritePerMtok) / m
  );
}

function addUsage(target: UsageBreakdown, src: UsageBreakdown): void {
  target.inputTokens += src.inputTokens;
  target.outputTokens += src.outputTokens;
  target.cacheReadTokens += src.cacheReadTokens;
  target.cacheWriteTokens += src.cacheWriteTokens;
}

function shorten(value: unknown, max = 220): string {
  let text: string;
  if (typeof value === "string") text = value;
  else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  text = text.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…(+${text.length - max} chars)`;
}

function extractUsageFromLLMEnd(output: LLMResult): UsageBreakdown {
  const usage = emptyUsage();

  // Preferred: usage_metadata on the AIMessage in generations[0][0].message
  // (LangChain standardised shape across providers).
  const generations = output.generations as Array<
    Array<{ message?: { usage_metadata?: unknown } }>
  >;
  const meta = generations?.[0]?.[0]?.message?.usage_metadata as
    | {
        input_tokens?: number;
        output_tokens?: number;
        input_token_details?: { cache_read?: number; cache_creation?: number };
      }
    | undefined;

  if (meta) {
    usage.inputTokens = meta.input_tokens ?? 0;
    usage.outputTokens = meta.output_tokens ?? 0;
    usage.cacheReadTokens = meta.input_token_details?.cache_read ?? 0;
    usage.cacheWriteTokens = meta.input_token_details?.cache_creation ?? 0;
    return usage;
  }

  // Fallback: llmOutput token usage from OpenAI-compatible or provider-native shapes.
  const llmOut = output.llmOutput as
    | {
        tokenUsage?: {
          promptTokens?: number;
          completionTokens?: number;
        };
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          input_tokens?: number;
          output_tokens?: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        };
      }
    | undefined;
  const u = llmOut?.usage;
  const tokenUsage = llmOut?.tokenUsage;
  if (u || tokenUsage) {
    usage.inputTokens = u?.input_tokens ?? u?.prompt_tokens ?? tokenUsage?.promptTokens ?? 0;
    usage.outputTokens = u?.output_tokens ?? u?.completion_tokens ?? tokenUsage?.completionTokens ?? 0;
    usage.cacheReadTokens = u?.cache_read_input_tokens ?? 0;
    usage.cacheWriteTokens = u?.cache_creation_input_tokens ?? 0;
  }
  return usage;
}

function nameFromSerialized(serialized: Serialized | undefined, fallback: string): string {
  if (!serialized) return fallback;
  const id = (serialized as { id?: string[] }).id;
  if (Array.isArray(id) && id.length > 0) return id[id.length - 1];
  const name = (serialized as { name?: string }).name;
  return name ?? fallback;
}

function fmtTokens(usage: UsageBreakdown): string {
  const parts = [
    `in=${usage.inputTokens}`,
    `out=${usage.outputTokens}`,
  ];
  if (usage.cacheReadTokens) parts.push(`cacheR=${usage.cacheReadTokens}`);
  if (usage.cacheWriteTokens) parts.push(`cacheW=${usage.cacheWriteTokens}`);
  return parts.join(" ");
}

function fmtCost(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(3)}`;
  if (usd >= 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(5)}`;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * LangChain callback handler that prints a per-event trace and computes a
 * cumulative cost summary. Wire it via `callbacks: [handler]` on agent and
 * formatter `invoke()` calls.
 */
export class AgentTraceHandler extends BaseCallbackHandler {
  override name = "agent-trace";

  private readonly label: string;
  private readonly enabled: boolean;
  private readonly startedAt = Date.now();
  private readonly llmStartTimes = new Map<string, { name: string; startedAt: number }>();
  private readonly toolStartTimes = new Map<
    string,
    { name: string; input: string; startedAt: number }
  >();
  private readonly llmCalls: LlmCallRecord[] = [];
  private readonly toolCalls: ToolCallRecord[] = [];
  private readonly totalUsage = emptyUsage();

  constructor(label: string) {
    super();
    this.label = label;
    this.enabled = traceEnabled();
  }

  private log(line: string): void {
    if (!this.enabled) return;
    const elapsed = ((Date.now() - this.startedAt) / 1000).toFixed(2).padStart(6, " ");
    console.log(`[agent-trace ${this.label} +${elapsed}s] ${line}`);
  }

  override async handleChatModelStart(
    llm: Serialized,
    messages: BaseMessage[][],
    runId: string,
  ): Promise<void> {
    const name = nameFromSerialized(llm, "ChatModel");
    const msgCount = messages[0]?.length ?? 0;
    this.llmStartTimes.set(runId, { name, startedAt: Date.now() });
    this.log(`LLM ▶ ${name} (messages=${msgCount})`);
  }

  override async handleLLMStart(
    llm: Serialized,
    prompts: string[],
    runId: string,
  ): Promise<void> {
    const name = nameFromSerialized(llm, "LLM");
    this.llmStartTimes.set(runId, { name, startedAt: Date.now() });
    this.log(`LLM ▶ ${name} (prompts=${prompts.length})`);
  }

  override async handleLLMEnd(output: LLMResult, runId: string): Promise<void> {
    const start = this.llmStartTimes.get(runId);
    this.llmStartTimes.delete(runId);
    const usage = extractUsageFromLLMEnd(output);
    addUsage(this.totalUsage, usage);
    const cost = computeCost(usage);
    const durationMs = start ? Date.now() - start.startedAt : 0;
    const name = start?.name ?? "LLM";
    this.llmCalls.push({
      name,
      startedAt: start?.startedAt ?? Date.now(),
      durationMs,
      usage,
      costUsd: cost,
    });
    const cumulative = computeCost(this.totalUsage);
    this.log(
      `LLM ◀ ${name} ${fmtDuration(durationMs)} | ${fmtTokens(usage)} | ${fmtCost(cost)} | sum ${fmtCost(cumulative)}`,
    );
  }

  override async handleLLMError(err: unknown, runId: string): Promise<void> {
    const start = this.llmStartTimes.get(runId);
    this.llmStartTimes.delete(runId);
    const durationMs = start ? Date.now() - start.startedAt : 0;
    const message = err instanceof Error ? err.message : String(err);
    this.log(`LLM ✗ ${start?.name ?? "LLM"} ${fmtDuration(durationMs)} | ${shorten(message, 240)}`);
  }

  override async handleToolStart(
    tool: Serialized,
    input: string,
    runId: string,
  ): Promise<void> {
    const name = nameFromSerialized(tool, "tool");
    const preview = shorten(input);
    this.toolStartTimes.set(runId, { name, input: preview, startedAt: Date.now() });
    this.log(`TOOL ▶ ${name}(${preview})`);
  }

  override async handleToolEnd(output: unknown, runId: string): Promise<void> {
    const start = this.toolStartTimes.get(runId);
    this.toolStartTimes.delete(runId);
    const durationMs = start ? Date.now() - start.startedAt : 0;
    const name = start?.name ?? "tool";
    const outputText =
      typeof output === "string"
        ? output
        : typeof output === "object" && output !== null && "content" in output
          ? String((output as { content?: unknown }).content ?? "")
          : JSON.stringify(output);
    const preview = shorten(outputText, 240);
    this.toolCalls.push({
      name,
      startedAt: start?.startedAt ?? Date.now(),
      durationMs,
      inputPreview: start?.input ?? "",
      outputPreview: preview,
      errored: false,
    });
    this.log(`TOOL ◀ ${name} ${fmtDuration(durationMs)} | ${preview}`);
  }

  override async handleToolError(err: unknown, runId: string): Promise<void> {
    const start = this.toolStartTimes.get(runId);
    this.toolStartTimes.delete(runId);
    const durationMs = start ? Date.now() - start.startedAt : 0;
    const name = start?.name ?? "tool";
    const message = err instanceof Error ? err.message : String(err);
    this.toolCalls.push({
      name,
      startedAt: start?.startedAt ?? Date.now(),
      durationMs,
      inputPreview: start?.input ?? "",
      outputPreview: shorten(message, 240),
      errored: true,
    });
    this.log(`TOOL ✗ ${name} ${fmtDuration(durationMs)} | ${shorten(message, 240)}`);
  }

  /** Returns the aggregated trace summary. Idempotent. */
  summarize(): AgentTraceSummary {
    return {
      label: this.label,
      totalDurationMs: Date.now() - this.startedAt,
      llmCalls: [...this.llmCalls],
      toolCalls: [...this.toolCalls],
      totalUsage: { ...this.totalUsage },
      totalCostUsd: computeCost(this.totalUsage),
    };
  }

  /** Prints a one-block summary at the end of a turn. */
  logSummary(extra?: Record<string, unknown>): AgentTraceSummary {
    const summary = this.summarize();
    if (!this.enabled) return summary;

    const toolCounts: Record<string, number> = {};
    for (const tool of summary.toolCalls) {
      toolCounts[tool.name] = (toolCounts[tool.name] ?? 0) + 1;
    }
    const toolBreakdown = Object.entries(toolCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name}×${count}`)
      .join(", ");

    console.log(
      [
        `[agent-trace ${this.label}] SUMMARY`,
        `  duration:    ${fmtDuration(summary.totalDurationMs)}`,
        `  llm calls:   ${summary.llmCalls.length}`,
        `  tool calls:  ${summary.toolCalls.length}${toolBreakdown ? ` (${toolBreakdown})` : ""}`,
        `  tokens:      ${fmtTokens(summary.totalUsage)} (total=${
          summary.totalUsage.inputTokens + summary.totalUsage.outputTokens
        })`,
        `  cost:        ${fmtCost(summary.totalCostUsd)}`,
        extra ? `  context:     ${shorten(extra, 400)}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    );
    return summary;
  }
}

/** Convenience factory keeping construction signature explicit. */
export function createAgentTraceHandler(label: string): AgentTraceHandler {
  return new AgentTraceHandler(label);
}
