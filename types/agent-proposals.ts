import { z } from "zod";

export const AgentProposalKindSchema = z.enum([
  "chat_action",
  "budget_import",
  "budget_bulk_edit",
  "item_bulk_edit",
  "report_spec",
  "comparison_spec",
]);

export const AgentProposalStatusSchema = z.enum([
  "draft",
  "approved",
  "executing",
  "executed",
  "rejected",
  "expired",
  "failed",
]);

export const AgentOperationTypeSchema = z.enum([
  "create",
  "update",
  "delete",
  "create_version",
  "create_report",
  "create_comparison",
]);

export const AgentOperationStatusSchema = z.enum([
  "pending",
  "approved",
  "applied",
  "skipped",
  "failed",
  "conflict",
]);

export const AgentWarningLevelSchema = z.enum(["none", "info", "warning", "critical"]);

export const JsonObjectSchema = z.record(z.string(), z.unknown());

export const AgentProposalOperationInputSchema = z.object({
  sortOrder: z.number().int().min(0).default(0),
  entityType: z.string().min(1).max(80),
  operationType: AgentOperationTypeSchema,
  entityId: z.string().min(1).max(120).nullable().default(null),
  beforeSnapshot: JsonObjectSchema.default({}),
  afterSnapshot: JsonObjectSchema.default({}),
  commandPayload: JsonObjectSchema.default({}),
  warningLevel: AgentWarningLevelSchema.default("none"),
  conflictReason: z.string().max(2_000).nullable().default(null),
});

export const CreateAgentProposalInputSchema = z.object({
  kind: AgentProposalKindSchema,
  title: z.string().min(1).max(240),
  summary: z.string().max(5_000).default(""),
  context: JsonObjectSchema.default({}),
  stats: JsonObjectSchema.default({}),
  warnings: z.array(JsonObjectSchema).default([]),
  requiredPermissions: z.array(z.string().min(1).max(120)).default([]),
  createdBy: z.string().min(1).max(240),
  sourceAgent: z.string().min(1).max(120),
  agentSessionId: z.string().min(1).max(240).nullable().default(null),
  expiresAt: z.date().optional(),
  operations: z.array(AgentProposalOperationInputSchema).max(10_000).default([]),
});

export type AgentProposalKind = z.infer<typeof AgentProposalKindSchema>;
export type AgentProposalStatus = z.infer<typeof AgentProposalStatusSchema>;
export type AgentOperationType = z.infer<typeof AgentOperationTypeSchema>;
export type AgentOperationStatus = z.infer<typeof AgentOperationStatusSchema>;
export type AgentWarningLevel = z.infer<typeof AgentWarningLevelSchema>;
export type AgentProposalOperationInput = z.infer<typeof AgentProposalOperationInputSchema>;
export type CreateAgentProposalInput = z.infer<typeof CreateAgentProposalInputSchema>;

export interface AgentProposalCreated {
  id: number;
  title: string;
  operationCount: number;
}
