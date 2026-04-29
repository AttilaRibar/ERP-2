import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createDraftAgentProposal } from "@/lib/agent/proposals";
import type { AgentToolContext } from "@/lib/agent/types";
import { requirePermission } from "@/lib/auth/permissions";

// ---------------------------------------------------------------------------
// Tool argument schema
// ---------------------------------------------------------------------------

const OperationSchema = z
  .object({
    entityType: z
      .enum(["partner", "project", "quote", "budget"])
      .describe("Target business entity kind."),
    actionType: z
      .enum(["create", "modify", "delete"])
      .describe("Operation kind to perform on the entity."),
    entityId: z
      .number()
      .int()
      .positive()
      .nullable()
      .default(null)
      .describe("Existing entity ID for modify/delete; null for create."),
    payload: z
      .record(z.string(), z.unknown())
      .default({})
      .describe(
        "Operation payload, structured to match the entity's create/update API shape.",
      ),
    description: z
      .string()
      .max(1_000)
      .default("")
      .describe("Optional Hungarian description shown in the approval UI."),
  })
  .describe("Single operation queued inside the proposal.");

const EntityActionSchema = z.object({
  title: z
    .string()
    .min(1)
    .max(240)
    .describe("Short Hungarian title of the proposal shown to the reviewer."),
  summary: z
    .string()
    .max(3_000)
    .default("")
    .describe("Hungarian summary explaining intent and impact of the proposal."),
  operations: z
    .array(OperationSchema)
    .min(1)
    .max(25)
    .describe("Ordered list of 1–25 operations the proposal will execute on approval."),
});

// ---------------------------------------------------------------------------
// Permission mapping
// ---------------------------------------------------------------------------

const WRITE_PERMISSION_BY_ENTITY: Record<string, string> = {
  partner: "partners:write",
  project: "projects:write",
  quote: "quotes:write",
  budget: "budgets:write",
};

function toOperationType(actionType: "create" | "modify" | "delete") {
  if (actionType === "modify") return "update" as const;
  return actionType;
}

// ---------------------------------------------------------------------------
// Proposal tool factory
// ---------------------------------------------------------------------------

/**
 * Builds the proposal-creation tool set. The agent has no direct write
 * capability — it can only enqueue a draft proposal that the user explicitly
 * approves and that is then executed under the user's session.
 */
export function createProposalTools(context: AgentToolContext) {
  return [
    tool(
      async ({ title, summary, operations }) => {
        const requiredPermissions = Array.from(
          new Set([
            "agent-proposals:execute",
            ...operations.map(
              (operation) => WRITE_PERMISSION_BY_ENTITY[operation.entityType],
            ),
          ]),
        );

        await requirePermission("agent-proposals:create");
        for (const permission of requiredPermissions) {
          await requirePermission(permission);
        }

        const proposal = await createDraftAgentProposal({
          kind: "chat_action",
          title,
          summary,
          context: { sessionId: context.sessionId },
          stats: { operationCount: operations.length },
          warnings: [],
          requiredPermissions,
          createdBy: context.userId,
          sourceAgent: "erp-chat-agent",
          agentSessionId: context.sessionId,
          operations: operations.map((operation, index) => ({
            sortOrder: index,
            entityType: operation.entityType,
            operationType: toOperationType(operation.actionType),
            entityId: operation.entityId === null ? null : String(operation.entityId),
            beforeSnapshot: {},
            afterSnapshot: operation.payload,
            commandPayload: { description: operation.description },
            warningLevel: "none",
            conflictReason: null,
          })),
        });

        return JSON.stringify({
          proposal,
          approvalAction: {
            actionType: "modify",
            entityType: "agent_proposal",
            entityId: proposal.id,
            payload: { proposalId: proposal.id },
            description: `Jóváhagyás után lefut: ${proposal.title}`,
          },
        });
      },
      {
        name: "erp_create_approval_proposal",
        description:
          "Create a DRAFT approval proposal for create / modify / delete operations on partners, projects, quotes or budgets. The proposal is not executed by the agent — it is queued and runs only after explicit user approval, on behalf of the user. Always use this tool for any mutation request.",
        schema: EntityActionSchema,
      },
    ),
  ];
}
