import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/permissions";
import type { AgentToolContext } from "@/lib/agent/types";
import { globalSearch } from "@/server/actions/search";
import { searchBudgetItems } from "@/server/actions/item-search";
import {
  compareMultipleVersions,
  compareVersions,
  getVersionsByBudgetId,
} from "@/server/actions/versions";

// Re-exported for back-compat with tools that import from this module.
export type { AgentToolContext } from "@/lib/agent/types";

// ---------------------------------------------------------------------------
// Tool argument schemas
// ---------------------------------------------------------------------------

const SearchSchema = z.object({
  query: z
    .string()
    .min(2)
    .max(200)
    .describe("Free-text search query (Hungarian or English), 2–200 characters."),
});

const ItemSearchSchema = z.object({
  query: z
    .string()
    .min(2)
    .max(200)
    .describe("Free-text query matching budget item name, code or description."),
  projectId: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe("Optional project ID filter."),
  budgetId: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe("Optional budget ID filter."),
  versionId: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe("Optional budget version ID filter."),
});

const BudgetVersionsSchema = z.object({
  budgetId: z
    .number()
    .int()
    .positive()
    .describe("Budget ID whose versions should be listed."),
});

const CompareVersionsSchema = z.object({
  versionAId: z
    .number()
    .int()
    .positive()
    .describe("Baseline version ID (left side of the comparison)."),
  versionBId: z
    .number()
    .int()
    .positive()
    .describe("Compared version ID (right side of the comparison)."),
});

const CompareMultipleVersionsSchema = z.object({
  versionIds: z
    .array(z.number().int().positive())
    .min(2)
    .max(8)
    .describe("Array of 2 to 8 version IDs to compare side-by-side."),
});

// ---------------------------------------------------------------------------
// Read-only tool factory
// ---------------------------------------------------------------------------

/**
 * Builds the read-only tool set the chat agent uses to ground its answers in
 * actual ERP data. All tools enforce RBAC via `requirePermission` and return
 * JSON-stringified payloads that LangChain forwards back to the model.
 */
export function createReadTools(context: AgentToolContext) {
  if (!context.userId || !context.sessionId) {
    throw new Error("Missing agent tool runtime context");
  }

  return [
    tool(
      async ({ query }) => {
        await requirePermission("projects:read");
        const results = await globalSearch(query);
        return JSON.stringify({ results });
      },
      {
        name: "erp_global_search",
        description:
          "Cross-entity search over projects, partners, quotes and budgets. Use this first when the user references an entity by name to obtain its ID.",
        schema: SearchSchema,
      },
    ),
    tool(
      async ({ query, projectId, budgetId, versionId }) => {
        await requirePermission("budget-items:read");
        const rows = await searchBudgetItems(query, projectId, budgetId, versionId);
        return JSON.stringify({ rows: rows.slice(0, 60), totalReturned: rows.length });
      },
      {
        name: "erp_search_budget_items",
        description:
          "Search budget line items by name or item code. Optional project/budget/version filters narrow the scope. Returns up to 60 rows.",
        schema: ItemSearchSchema,
      },
    ),
    tool(
      async ({ budgetId }) => {
        await requirePermission("versions:read");
        const versions = await getVersionsByBudgetId(budgetId);
        return JSON.stringify({ versions });
      },
      {
        name: "erp_get_budget_versions",
        description:
          "List all versions of a given budget. Use before comparing versions or when picking an import target version.",
        schema: BudgetVersionsSchema,
      },
    ),
    tool(
      async ({ versionAId, versionBId }) => {
        await requirePermission("comparisons:read");
        const comparison = await compareVersions(versionAId, versionBId);
        const changed = comparison.items.filter((item) => item.status === "changed").length;
        const added = comparison.items.filter((item) => item.status === "added").length;
        const removed = comparison.items.filter((item) => item.status === "removed").length;
        return JSON.stringify({
          summary: { changed, added, removed, totalItems: comparison.items.length },
          totalA: comparison.totalA,
          totalB: comparison.totalB,
          ignorePrice: comparison.ignorePrice,
          largestExamples: comparison.items.slice(0, 25),
        });
      },
      {
        name: "erp_compare_versions",
        description:
          "Structured pairwise comparison of two budget versions. Read-only. Returns aggregated counts and the 25 most material item-level differences.",
        schema: CompareVersionsSchema,
      },
    ),
    tool(
      async ({ versionIds }) => {
        await requirePermission("comparisons:read");
        const comparison = await compareMultipleVersions(versionIds);
        return JSON.stringify({
          versions: comparison.versions,
          allSectionCodes: comparison.allSectionCodes,
          itemCount: comparison.items.length,
          itemExamples: comparison.items.slice(0, 30),
        });
      },
      {
        name: "erp_compare_multiple_versions",
        description:
          "Multi-way comparison of 2–8 budget versions for variance/dispersion analysis. Read-only.",
        schema: CompareMultipleVersionsSchema,
      },
    ),
  ];
}
