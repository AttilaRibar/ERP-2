import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { agentProposalOperations, agentProposals, agentRuns } from "@/lib/db/schema";
import {
  CreateAgentProposalInputSchema,
  type AgentProposalCreated,
  type CreateAgentProposalInput,
} from "@/types/agent-proposals";
import { eq } from "drizzle-orm";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function hashProposal(input: CreateAgentProposalInput): string {
  return createHash("sha256").update(stableStringify(input)).digest("hex");
}

/** Stores an agent proposal as a draft. It does not mutate business data. */
export async function createDraftAgentProposal(
  rawInput: CreateAgentProposalInput,
): Promise<AgentProposalCreated> {
  const input = CreateAgentProposalInputSchema.parse(rawInput);
  const expiresAt = input.expiresAt ?? new Date(Date.now() + 30 * 60 * 1_000);
  const proposalHash = hashProposal({ ...input, expiresAt });

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(agentProposals)
      .values({
        kind: input.kind,
        title: input.title,
        summary: input.summary,
        context: input.context,
        stats: input.stats,
        warnings: input.warnings,
        requiredPermissions: input.requiredPermissions,
        createdBy: input.createdBy,
        sourceAgent: input.sourceAgent,
        agentSessionId: input.agentSessionId,
        proposalHash,
        expiresAt,
      })
      .returning({ id: agentProposals.id, title: agentProposals.title });

    if (!created) {
      throw new Error("Nem sikerült létrehozni az agent javaslatot");
    }

    if (input.operations.length > 0) {
      await tx.insert(agentProposalOperations).values(
        input.operations.map((operation, index) => ({
          proposalId: created.id,
          sortOrder: operation.sortOrder || index,
          entityType: operation.entityType,
          operationType: operation.operationType,
          entityId: operation.entityId,
          beforeSnapshot: operation.beforeSnapshot,
          afterSnapshot: operation.afterSnapshot,
          commandPayload: operation.commandPayload,
          warningLevel: operation.warningLevel,
          conflictReason: operation.conflictReason,
        })),
      );
    }

    return {
      id: created.id,
      title: created.title,
      operationCount: input.operations.length,
    };
  });
}

/** Records a LangChain/LangGraph run for audit and troubleshooting. */
export async function startAgentRun(input: {
  userId: string;
  sessionId: string;
  agentName: string;
  model: string;
  inputSummary: string;
}): Promise<number> {
  const [row] = await db
    .insert(agentRuns)
    .values({
      userId: input.userId,
      sessionId: input.sessionId,
      agentName: input.agentName,
      model: input.model,
      inputSummary: input.inputSummary.slice(0, 1_000),
    })
    .returning({ id: agentRuns.id });

  if (!row) throw new Error("Nem sikerült agent futást naplózni");
  return row.id;
}

/** Marks an agent run as completed or failed. */
export async function finishAgentRun(
  id: number,
  result: { status: "succeeded" | "failed"; outputSummary?: string; errorMessage?: string },
): Promise<void> {
  await db
    .update(agentRuns)
    .set({
      status: result.status,
      outputSummary: result.outputSummary?.slice(0, 1_000) ?? "",
      errorMessage: result.errorMessage?.slice(0, 2_000) ?? null,
      finishedAt: new Date(),
    })
    .where(eq(agentRuns.id, id));
}
