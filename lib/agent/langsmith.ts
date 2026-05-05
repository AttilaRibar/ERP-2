import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { RunnableConfig } from "@langchain/core/runnables";

export const DEFAULT_LANGSMITH_ENDPOINT = "https://api.smith.langchain.com";

const TRUE_VALUES = new Set(["true", "1", "yes", "on"]);
const FALSE_VALUES = new Set(["false", "0", "no", "off", ""]);

interface LangSmithRunConfigInput {
  runName: string;
  agentName: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  callbacks?: BaseCallbackHandler[];
  configurable?: RunnableConfig["configurable"];
  maxConcurrency?: RunnableConfig["maxConcurrency"];
  recursionLimit?: RunnableConfig["recursionLimit"];
  runId?: RunnableConfig["runId"];
  signal?: RunnableConfig["signal"];
  timeout?: RunnableConfig["timeout"];
}

export interface LangSmithEnvironmentStatus {
  enabled: boolean;
  endpoint: string;
  project?: string;
  missing: string[];
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function normalizeLangSmithTracingEnv(): void {
  const rawValue = process.env.LANGSMITH_TRACING;
  if (rawValue === undefined) return;

  const value = rawValue.trim().toLowerCase();
  if (TRUE_VALUES.has(value)) {
    process.env.LANGSMITH_TRACING = "true";
    return;
  }

  if (FALSE_VALUES.has(value)) {
    process.env.LANGSMITH_TRACING = "false";
  }
}

function compactMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== undefined && value !== null),
  );
}

function uniqueTags(tags: string[]): string[] {
  return Array.from(new Set(tags.filter((tag) => tag.trim().length > 0)));
}

/** Returns the effective LangSmith tracing environment used by LangChain.js. */
export function getLangSmithEnvironmentStatus(): LangSmithEnvironmentStatus {
  normalizeLangSmithTracingEnv();

  const enabled = process.env.LANGSMITH_TRACING === "true";
  const apiKey = readEnv("LANGSMITH_API_KEY");
  const project = readEnv("LANGSMITH_PROJECT");
  const endpoint = readEnv("LANGSMITH_ENDPOINT") ?? DEFAULT_LANGSMITH_ENDPOINT;

  return {
    enabled,
    endpoint,
    project,
    missing: enabled && !apiKey ? ["LANGSMITH_API_KEY"] : [],
  };
}

/** Fails fast when tracing is enabled but LangSmith cannot receive traces. */
export function ensureLangSmithTracingConfigured(): void {
  const status = getLangSmithEnvironmentStatus();
  if (!status.enabled || status.missing.length === 0) return;

  throw new Error(
    `LANGSMITH_TRACING is enabled, but missing required environment variable: ${status.missing.join(", ")}`,
  );
}

/**
 * Builds a RunnableConfig with stable LangSmith run names, tags and metadata.
 * LangChain.js adds the LangSmith tracer automatically when LANGSMITH_TRACING=true.
 */
export function createLangSmithRunConfig({
  runName,
  agentName,
  tags = [],
  metadata = {},
  callbacks = [],
  configurable,
  maxConcurrency,
  recursionLimit,
  runId,
  signal,
  timeout,
}: LangSmithRunConfigInput): RunnableConfig {
  ensureLangSmithTracingConfigured();

  const status = getLangSmithEnvironmentStatus();
  const environment = process.env.NODE_ENV ?? "development";

  return {
    runName,
    configurable,
    maxConcurrency,
    recursionLimit,
    runId,
    signal,
    timeout,
    callbacks: callbacks.length > 0 ? callbacks : undefined,
    tags: uniqueTags(["erp2", "langchain", agentName, environment, ...tags]),
    metadata: compactMetadata({
      app: "erp2",
      runtime: "nextjs-node",
      agent: agentName,
      environment,
      langsmith_tracing: status.enabled,
      langsmith_endpoint: status.endpoint,
      langsmith_project: status.project ?? "default",
      ...metadata,
    }),
  };
}

/** Metadata that makes OpenRouter-backed ChatOpenAI runs readable in LangSmith. */
export function createOpenRouterLangSmithMetadata(
  model: string | undefined,
): Record<string, unknown> {
  return compactMetadata({
    provider: "openrouter",
    ls_provider: "openrouter",
    ls_model_name: model,
    ls_model_type: "chat",
  });
}