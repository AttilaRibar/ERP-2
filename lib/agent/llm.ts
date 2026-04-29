import { ChatAnthropic } from "@langchain/anthropic";

export const DEFAULT_ANTHROPIC_MODEL =
  process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5-20250929";

interface AnthropicModelOptions {
  temperature?: number;
  maxTokens?: number;
}

/** Creates a server-side Anthropic chat model for ERP agents. */
export function createAnthropicModel(options: AnthropicModelOptions = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY environment variable");
  }

  return new ChatAnthropic({
    apiKey,
    model: DEFAULT_ANTHROPIC_MODEL,
    temperature: options.temperature ?? 0.1,
    maxTokens: options.maxTokens ?? 4_000,
    streaming: false,
  });
}
