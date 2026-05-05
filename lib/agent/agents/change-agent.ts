import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createLangSmithRunConfig } from "@/lib/agent/langsmith";
import { createOpenRouterModel } from "@/lib/agent/llm";
import { CHANGE_AGENT_SYSTEM_PROMPT } from "@/lib/agent/prompts/change-agent.prompt";
import {
  BulkChangePlanSchema,
  type BulkChangePlan,
} from "@/lib/agent/schemas/bulk-change-plan";

// Re-export so existing server-action consumers keep their import path.
export type { BulkChangePlan } from "@/lib/agent/schemas/bulk-change-plan";
export { BulkChangePlanSchema } from "@/lib/agent/schemas/bulk-change-plan";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PlanBulkChangeInput {
  instruction: string;
  scope: Record<string, unknown>;
  availableFields: string[];
}

const MAX_TOKENS = 2_000;
const AGENT_NAME = "erp-bulk-change-planner";

function buildUserMessage(input: PlanBulkChangeInput): string {
  return [
    `User instruction (Hungarian): ${input.instruction}`,
    `Scope (JSON): ${JSON.stringify(input.scope)}`,
    `Allowed fields (whitelist): ${input.availableFields.join(", ") || "(none)"}`,
    "",
    "Produce the bulk-change plan now.",
  ].join("\n");
}

/**
 * Converts a natural-language bulk edit request into a whitelisted change plan.
 * Pure planning: never writes to the database and never emits SQL.
 *
 * Implementation: single LangChain structured-output call. No ReAct loop is
 * needed because the planner does not use tools.
 */
export async function planBulkChange(
  input: PlanBulkChangeInput,
): Promise<BulkChangePlan> {
  const model = createOpenRouterModel({ temperature: 0, maxTokens: MAX_TOKENS });
  const structured = model.withStructuredOutput<BulkChangePlan>(
    BulkChangePlanSchema,
    { name: "BulkChangePlan" },
  );

  const result = await structured.invoke(
    [
      new SystemMessage(CHANGE_AGENT_SYSTEM_PROMPT),
      new HumanMessage(buildUserMessage(input)),
    ],
    createLangSmithRunConfig({
      runName: "erp-bulk-change-planner.change-plan",
      agentName: AGENT_NAME,
      tags: ["bulk-change", "structured-output"],
      metadata: {
        workflow: "bulk-change-plan",
        field_count: input.availableFields.length,
        scope_keys: Object.keys(input.scope),
      },
    }),
  );

  return BulkChangePlanSchema.parse(result);
}
