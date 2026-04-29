import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createAnthropicModel } from "@/lib/agent/llm";
import { IMPORT_AGENT_SYSTEM_PROMPT } from "@/lib/agent/prompts/import-agent.prompt";
import {
  ImportMappingPlanSchema,
  type ImportMappingPlan,
} from "@/lib/agent/schemas/import-plan";

// Re-export so existing server-action consumers keep their import path.
export type { ImportMappingPlan } from "@/lib/agent/schemas/import-plan";
export { ImportMappingPlanSchema } from "@/lib/agent/schemas/import-plan";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PlanImportInput {
  instruction: string;
  fileName: string;
  sheetNames: string[];
  headers: string[];
  sampleRows: Record<string, unknown>[];
}

const SAMPLE_ROW_LIMIT = 20;
const MAX_TOKENS = 2_000;

function buildUserMessage(input: PlanImportInput): string {
  return [
    `User instruction (Hungarian): ${input.instruction}`,
    `File name: ${input.fileName}`,
    `Sheet names: ${input.sheetNames.join(", ") || "(none)"}`,
    `Detected columns: ${input.headers.join(" | ") || "(none)"}`,
    `Sample rows (first ${SAMPLE_ROW_LIMIT}, JSON):`,
    JSON.stringify(input.sampleRows.slice(0, SAMPLE_ROW_LIMIT)),
    "",
    "Produce the import mapping plan now.",
  ].join("\n");
}

/**
 * Plans an Excel-to-ERP import. Pure planning: never writes to the database
 * and never emits SQL. The returned plan is reviewed and executed by the user
 * via the dedicated import workflow.
 *
 * Implementation: single LangChain structured-output call. No ReAct loop is
 * needed because the planner does not use tools.
 */
export async function planAgenticImport(
  input: PlanImportInput,
): Promise<ImportMappingPlan> {
  const model = createAnthropicModel({ temperature: 0, maxTokens: MAX_TOKENS });
  const structured = model.withStructuredOutput<ImportMappingPlan>(
    ImportMappingPlanSchema,
    { name: "ImportMappingPlan" },
  );

  const result = await structured.invoke([
    new SystemMessage(IMPORT_AGENT_SYSTEM_PROMPT),
    new HumanMessage(buildUserMessage(input)),
  ]);

  return ImportMappingPlanSchema.parse(result);
}
