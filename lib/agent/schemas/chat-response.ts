import { z } from "zod";

/**
 * Strict envelope for ERP chat agent responses.
 *
 * Produced by LangGraph's `responseFormat` stage: the ReAct agent first
 * answers in free-form Hungarian and may call tools; once the loop ends, a
 * dedicated structured-output call reshapes everything into this schema.
 */

const LinkedContentSchema = z
  .object({
    entityType: z
      .string()
      .min(1)
      .describe(
        'Entity kind referenced in the answer (e.g. "project", "budget", "version", "partner", "quote").',
      ),
    entityId: z
      .number()
      .int()
      .positive()
      .describe("Positive integer database ID of the referenced entity."),
  })
  .describe("Entity the user should be able to open from the AI answer.");

const ProposedActionSchema = z
  .object({
    actionType: z
      .enum(["create", "modify", "delete"])
      .describe("Business operation kind the user is being asked to approve."),
    entityType: z
      .string()
      .min(1)
      .describe(
        'Entity kind targeted by the action (e.g. "partner", "project", "quote", "budget", "agent_proposal").',
      ),
    entityId: z
      .number()
      .int()
      .positive()
      .nullable()
      .describe("Existing entity ID for modify/delete; null for create."),
    payload: z
      .record(z.string(), z.unknown())
      .default({})
      .describe("Action payload that will be passed to the executor after approval."),
    description: z
      .string()
      .optional()
      .describe("Optional Hungarian description shown in the approval UI."),
  })
  .describe("UI-renderable proposed action awaiting user approval.");

const OutputAttachmentSchema = z
  .object({
    attachmentId: z.string().min(1).describe("Workbook-session ID; resolves to /api/ai/files/{id}."),
    name: z.string().min(1).describe("File name shown to the user (.xlsx)."),
    size: z.number().int().nonnegative().describe("Serialized byte size."),
    mediaType: z
      .string()
      .min(1)
      .describe("MIME type (xlsx => application/vnd.openxmlformats-officedocument.spreadsheetml.sheet)."),
  })
  .describe("Downloadable file the agent produced this turn (e.g. an edited Excel).");

export const AiJsonResponseSchema = z
  .object({
    answer: z
      .string()
      .describe(
        "User-visible Hungarian answer in Markdown. Must NOT contain JSON, schema fragments or fenced code blocks describing the response itself.",
      ),
    linkedContents: z
      .array(LinkedContentSchema)
      .default([])
      .describe("Entities referenced in the answer; empty array if none."),
    proposedActions: z
      .array(ProposedActionSchema)
      .default([])
      .describe("Actions awaiting approval; empty array if none."),
    outputAttachments: z
      .array(OutputAttachmentSchema)
      .default([])
      .describe(
        "Files the agent saved for download via excel_save_as_attachment. Empty array if none.",
      ),
  })
  .describe("Strict envelope for ERP chat agent responses.");

export type AiJsonResponse = z.infer<typeof AiJsonResponseSchema>;
