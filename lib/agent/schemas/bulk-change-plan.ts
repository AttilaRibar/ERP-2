import { z } from "zod";

/**
 * Whitelisted bulk-change plan produced by the bulk-change planner agent.
 *
 * Pure planning — never contains SQL. The resulting plan is reviewed by the
 * user and applied by the dedicated bulk-change executor.
 */

const FilterSchema = z
  .object({
    field: z
      .string()
      .min(1)
      .max(80)
      .describe("Field name from the runtime `availableFields` whitelist."),
    operator: z
      .enum([
        "eq",
        "neq",
        "contains",
        "gt",
        "gte",
        "lt",
        "lte",
        "is_null",
        "is_not_null",
      ])
      .describe("Comparison operator used to narrow the selection."),
    value: z
      .union([z.string(), z.number(), z.boolean(), z.null()])
      .describe("Comparison value; ignored for `is_null` / `is_not_null`."),
  })
  .describe("Single record-selection filter clause.");

const MutationSchema = z
  .object({
    field: z
      .string()
      .min(1)
      .max(80)
      .describe("Target field from the runtime `availableFields` whitelist."),
    operation: z
      .enum([
        "set",
        "increase_percent",
        "decrease_percent",
        "multiply",
        "append_text",
        "prepend_text",
      ])
      .describe(
        "Mutation operator. `increase_percent` / `decrease_percent` expect a numeric percentage value (e.g. `5` = 5%).",
      ),
    value: z
      .union([z.string(), z.number(), z.boolean(), z.null()])
      .describe("Operation parameter value."),
  })
  .describe("Single field mutation applied to every selected record.");

export const BulkChangePlanSchema = z
  .object({
    entityType: z
      .enum(["budget_item", "budget_section", "version", "budget"])
      .describe("Target entity kind. Pick the narrowest scope satisfying the request."),
    selectionSummary: z
      .string()
      .min(1)
      .max(2_000)
      .describe(
        "Short Hungarian sentence describing, in business terms, which records will be affected.",
      ),
    filters: z
      .array(FilterSchema)
      .describe("Conjunctive filter clauses identifying the affected records."),
    mutations: z
      .array(MutationSchema)
      .describe("Field mutations applied to every selected record."),
    exclusions: z
      .array(z.string())
      .default([])
      .describe("Record names or codes the user explicitly wants to keep out."),
    warnings: z
      .array(z.string())
      .default([])
      .describe("Hungarian warnings the reviewer should see before approving."),
    clarificationQuestion: z
      .string()
      .nullable()
      .default(null)
      .describe(
        "If the plan cannot be safely produced, a single focused Hungarian question; otherwise null.",
      ),
  })
  .describe("Whitelisted bulk-change plan awaiting user approval.");

export type BulkChangePlan = z.infer<typeof BulkChangePlanSchema>;
