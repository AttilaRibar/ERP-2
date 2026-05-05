"use server";

import { requirePermission } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import {
  analyzePricingWorkbookFormData,
  listPricingBudgetsForProject,
  listPricingProjects,
  listPricingVersionsForBudget,
} from "@/lib/pricing/pricing-engine";
import type {
  PricingActionResult,
  PricingAnalysisResult,
  PricingBudgetOption,
  PricingProjectOption,
  PricingVersionOption,
} from "@/types/pricing";

async function requirePricingRead(): Promise<void> {
  const session = await getCurrentUser();
  if (!session) throw new Error("UNAUTHORIZED");
  await requirePermission("projects:read");
  await requirePermission("budgets:read");
  await requirePermission("versions:read");
  await requirePermission("budget-items:read");
}

function toActionError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Ismeretlen árazási hiba";
}

/** Lists projects that can be selected as pricing source context. */
export async function getPricingProjects(): Promise<PricingActionResult<PricingProjectOption[]>> {
  try {
    await requirePricingRead();
    const data = await listPricingProjects();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: toActionError(error) };
  }
}

/** Lists budgets for the selected project in the pricing workflow. */
export async function getPricingBudgetsForProject(
  projectId: number,
): Promise<PricingActionResult<PricingBudgetOption[]>> {
  try {
    await requirePricingRead();
    const data = await listPricingBudgetsForProject(projectId);
    return { success: true, data };
  } catch (error) {
    return { success: false, error: toActionError(error) };
  }
}

/** Lists versions for the selected budget in the pricing workflow. */
export async function getPricingVersionsForBudget(
  budgetId: number,
): Promise<PricingActionResult<PricingVersionOption[]>> {
  try {
    await requirePricingRead();
    const data = await listPricingVersionsForBudget(budgetId);
    return { success: true, data };
  } catch (error) {
    return { success: false, error: toActionError(error) };
  }
}

/** Parses an uploaded workbook and returns the matching/price preview. */
export async function analyzePricingWorkbook(
  formData: FormData,
): Promise<PricingActionResult<PricingAnalysisResult>> {
  try {
    await requirePricingRead();
    const data = await analyzePricingWorkbookFormData(formData);
    return { success: true, data };
  } catch (error) {
    return { success: false, error: toActionError(error) };
  }
}