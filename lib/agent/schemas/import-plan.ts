import { z } from "zod";

/**
 * Whitelisted Excel-to-ERP import plan produced by the import-planner agent.
 *
 * Pure planning — never contains SQL or executable mutations. The resulting
 * plan is reviewed by the user and executed by the dedicated import workflow.
 */

const TargetSchema = z
  .object({
    projectId: z
      .number()
      .int()
      .positive()
      .nullable()
      .describe("Project DB ID supplied by the user, or null if unknown."),
    budgetId: z
      .number()
      .int()
      .positive()
      .nullable()
      .describe("Budget DB ID supplied by the user, or null if unknown."),
    parentVersionId: z
      .number()
      .int()
      .positive()
      .nullable()
      .describe(
        "Parent version DB ID this import will branch from, or null for a fresh root version.",
      ),
    versionName: z
      .string()
      .min(1)
      .max(160)
      .describe("Hungarian display name for the new version produced by the import."),
  })
  .describe("Resolved target coordinates for the import.");

const ColumnMappingSchema = z
  .object({
    sourceColumn: z
      .string()
      .min(1)
      .describe("Original Excel column header verbatim."),
    targetField: z
      .string()
      .min(1)
      .describe(
        "Target ERP field in lower_snake_case (e.g. `item_code`, `quantity`, `unit_price_huf`).",
      ),
    confidence: z
      .number()
      .min(0)
      .max(1)
      .describe(
        "Mapping confidence in [0,1]. Use 1.0 only for unambiguous matches; <0.6 means guess.",
      ),
    note: z
      .string()
      .default("")
      .describe("Optional Hungarian rationale or caveat for the reviewer."),
  })
  .describe("Single Excel column → ERP field mapping.");

const TransformationSchema = z
  .object({
    field: z
      .string()
      .min(1)
      .describe("Target ERP field the transformation applies to."),
    operation: z
      .string()
      .min(1)
      .describe(
        "Lower_snake_case operation name (e.g. `parse_decimal_comma`, `strip_currency`, `default_if_empty`).",
      ),
    value: z
      .union([z.string(), z.number(), z.boolean(), z.null()])
      .describe("Operation parameter value, or null if unused."),
    note: z
      .string()
      .default("")
      .describe("Optional Hungarian rationale for the transformation."),
  })
  .describe("Value-level transformation the import engine must apply.");

export const ImportMappingPlanSchema = z
  .object({
    target: TargetSchema,
    columnMappings: z
      .array(ColumnMappingSchema)
      .describe("All columns the engine should import."),
    transformations: z
      .array(TransformationSchema)
      .describe("Value-level transformations to apply during import."),
    skippedColumns: z
      .array(z.string())
      .default([])
      .describe("Source column headers that will intentionally be ignored."),
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
  .describe("Whitelisted Excel-to-ERP import plan awaiting user approval.");

export type ImportMappingPlan = z.infer<typeof ImportMappingPlanSchema>;
