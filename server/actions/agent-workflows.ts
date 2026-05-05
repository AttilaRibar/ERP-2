"use server";

import {
  planAgenticImport,
  type ImportMappingPlan,
  type PlanImportInput,
} from "@/lib/agent/agents/import-agent";
import {
  planBulkChange,
  type BulkChangePlan,
  type PlanBulkChangeInput,
} from "@/lib/agent/agents/change-agent";
import { requirePermission } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";

export type AgentWorkflowResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

async function requireLoggedInUser(): Promise<string> {
  const session = await getCurrentUser();
  if (!session) throw new Error("UNAUTHORIZED");
  return session.user.sub;
}

/** Runs the dedicated import planner agent. It returns a mapping plan only. */
export async function planAgenticImportAction(
  input: PlanImportInput,
): Promise<AgentWorkflowResult<ImportMappingPlan>> {
  try {
    await requireLoggedInUser();
    await requirePermission("imports:create");
    const data = await planAgenticImport(input);
    return { success: true, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ismeretlen import agent hiba";
    return { success: false, error: message };
  }
}

/** Runs the dedicated bulk-change planner agent. It returns a safe DSL plan only. */
export async function planBulkChangeAction(
  input: PlanBulkChangeInput,
): Promise<AgentWorkflowResult<BulkChangePlan>> {
  try {
    await requireLoggedInUser();
    await requirePermission("budget-items:write");
    const data = await planBulkChange(input);
    return { success: true, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ismeretlen módosítás-tervező agent hiba";
    return { success: false, error: message };
  }
}
