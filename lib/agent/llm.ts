import { ChatOpenAI } from "@langchain/openai";
import {
  createOpenRouterLangSmithMetadata,
  ensureLangSmithTracingConfigured,
} from "@/lib/agent/langsmith";

export const DEFAULT_OPENROUTER_MODEL =
  process.env.OPENROUTER_MODEL;

const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL;

interface OpenRouterModelOptions {
  temperature?: number;
  maxTokens?: number;
}

function buildOpenRouterHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const siteUrl = process.env.OPENROUTER_SITE_URL;
  const appName = process.env.OPENROUTER_APP_NAME;

  if (siteUrl) headers["HTTP-Referer"] = siteUrl;
  if (appName) headers["X-Title"] = appName;

  return headers;
}

/** Creates a server-side OpenRouter chat model for ERP agents via LangChain. */
export function createOpenRouterModel(options: OpenRouterModelOptions = {}) {
  ensureLangSmithTracingConfigured();

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY environment variable");
  }

  return new ChatOpenAI({
    apiKey,
    model: DEFAULT_OPENROUTER_MODEL,
    temperature: options.temperature ?? 0.1,
    maxTokens: options.maxTokens ?? 4000,
    streaming: false,
    streamUsage: false,
    metadata: createOpenRouterLangSmithMetadata(DEFAULT_OPENROUTER_MODEL),
    configuration: {
      baseURL: OPENROUTER_BASE_URL,
      defaultHeaders: buildOpenRouterHeaders(),
    },
  });
}
