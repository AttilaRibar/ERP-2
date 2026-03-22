"use server";

import { db } from "@/lib/db";
import { budgets, projects } from "@/lib/db/schema";
import { eq, ilike, or, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const BudgetSchema = z.object({
  projectId: z.coerce.number().min(1, "Projekt kiválasztása kötelező"),
  name: z.string().min(1, "A költségvetés neve kötelező"),
});

export type BudgetFormState = {
  success: boolean;
  error?: string;
  data?: typeof budgets.$inferSelect;
};

export async function getBudgets(search?: string, projectFilter?: string) {
  const conditions = [];

  if (search) {
    conditions.push(
      or(ilike(budgets.name, `%${search}%`), ilike(projects.name, `%${search}%`))!
    );
  }

  if (projectFilter && projectFilter !== "all") {
    conditions.push(eq(budgets.projectId, Number(projectFilter)));
  }

  const rows = await db
    .select({
      id: budgets.id,
      name: budgets.name,
      projectId: budgets.projectId,
      createdAt: budgets.createdAt,
      projectCode: projects.projectCode,
      projectName: projects.name,
    })
    .from(budgets)
    .leftJoin(projects, eq(budgets.projectId, projects.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(budgets.id);

  return rows;
}

export async function getBudgetById(id: number) {
  const [result] = await db
    .select({
      id: budgets.id,
      name: budgets.name,
      projectId: budgets.projectId,
      createdAt: budgets.createdAt,
      projectCode: projects.projectCode,
      projectName: projects.name,
    })
    .from(budgets)
    .leftJoin(projects, eq(budgets.projectId, projects.id))
    .where(eq(budgets.id, id));
  return result ?? null;
}

export async function createBudget(formData: FormData): Promise<BudgetFormState> {
  const raw = {
    projectId: Number(formData.get("projectId")),
    name: formData.get("name") as string,
  };

  const parsed = BudgetSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Érvénytelen adatok" };
  }

  const [created] = await db
    .insert(budgets)
    .values({
      projectId: parsed.data.projectId,
      name: parsed.data.name,
    })
    .returning();

  revalidatePath("/");
  return { success: true, data: created };
}

export async function updateBudget(id: number, formData: FormData): Promise<BudgetFormState> {
  const raw = {
    projectId: Number(formData.get("projectId")),
    name: formData.get("name") as string,
  };

  const parsed = BudgetSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Érvénytelen adatok" };
  }

  const [updated] = await db
    .update(budgets)
    .set({
      projectId: parsed.data.projectId,
      name: parsed.data.name,
    })
    .where(eq(budgets.id, id))
    .returning();

  if (!updated) {
    return { success: false, error: "Költségvetés nem található" };
  }

  revalidatePath("/");
  return { success: true, data: updated };
}

export async function deleteBudget(id: number): Promise<BudgetFormState> {
  const [deleted] = await db.delete(budgets).where(eq(budgets.id, id)).returning();
  if (!deleted) {
    return { success: false, error: "Költségvetés nem található" };
  }
  revalidatePath("/");
  return { success: true, data: deleted };
}
