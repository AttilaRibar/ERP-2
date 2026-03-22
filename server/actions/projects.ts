"use server";

import { db } from "@/lib/db";
import { projects, partners } from "@/lib/db/schema";
import { eq, ilike, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const ProjectSchema = z.object({
  name: z.string().min(1, "A projekt neve kötelező"),
  startDate: z.string().optional().or(z.literal("")),
  endDate: z.string().optional().or(z.literal("")),
  clientId: z.coerce.number().optional().nullable(),
  warrantyMonths: z.coerce.number().min(0).default(12),
  status: z.enum(["active", "completed", "cancelled", "on_hold"]),
});

export type ProjectFormState = {
  success: boolean;
  error?: string;
  data?: typeof projects.$inferSelect;
};

export async function getProjects(search?: string, statusFilter?: string) {
  const rows = await db
    .select({
      id: projects.id,
      projectCode: projects.projectCode,
      name: projects.name,
      startDate: projects.startDate,
      endDate: projects.endDate,
      clientId: projects.clientId,
      warrantyMonths: projects.warrantyMonths,
      status: projects.status,
      createdAt: projects.createdAt,
      clientName: partners.name,
    })
    .from(projects)
    .leftJoin(partners, eq(projects.clientId, partners.id))
    .where(
      search
        ? or(ilike(projects.name, `%${search}%`), ilike(projects.projectCode, `%${search}%`))
        : statusFilter && statusFilter !== "all"
          ? eq(projects.status, statusFilter)
          : undefined
    )
    .orderBy(projects.id);

  if (statusFilter && statusFilter !== "all" && search) {
    return rows.filter((r) => r.status === statusFilter);
  }
  return rows;
}

export async function getProjectById(id: number) {
  const [result] = await db
    .select({
      id: projects.id,
      projectCode: projects.projectCode,
      name: projects.name,
      startDate: projects.startDate,
      endDate: projects.endDate,
      clientId: projects.clientId,
      warrantyMonths: projects.warrantyMonths,
      status: projects.status,
      createdAt: projects.createdAt,
      clientName: partners.name,
    })
    .from(projects)
    .leftJoin(partners, eq(projects.clientId, partners.id))
    .where(eq(projects.id, id));
  return result ?? null;
}

export async function createProject(formData: FormData): Promise<ProjectFormState> {
  const raw = {
    name: formData.get("name") as string,
    startDate: formData.get("startDate") as string,
    endDate: formData.get("endDate") as string,
    clientId: formData.get("clientId") ? Number(formData.get("clientId")) : null,
    warrantyMonths: Number(formData.get("warrantyMonths") ?? 12),
    status: formData.get("status") as string,
  };

  const parsed = ProjectSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Érvénytelen adatok" };
  }

  const [created] = await db
    .insert(projects)
    .values({
      name: parsed.data.name,
      startDate: parsed.data.startDate || null,
      endDate: parsed.data.endDate || null,
      clientId: parsed.data.clientId || null,
      warrantyMonths: parsed.data.warrantyMonths,
      status: parsed.data.status,
    })
    .returning();

  revalidatePath("/");
  return { success: true, data: created };
}

export async function updateProject(id: number, formData: FormData): Promise<ProjectFormState> {
  const raw = {
    name: formData.get("name") as string,
    startDate: formData.get("startDate") as string,
    endDate: formData.get("endDate") as string,
    clientId: formData.get("clientId") ? Number(formData.get("clientId")) : null,
    warrantyMonths: Number(formData.get("warrantyMonths") ?? 12),
    status: formData.get("status") as string,
  };

  const parsed = ProjectSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Érvénytelen adatok" };
  }

  const [updated] = await db
    .update(projects)
    .set({
      name: parsed.data.name,
      startDate: parsed.data.startDate || null,
      endDate: parsed.data.endDate || null,
      clientId: parsed.data.clientId || null,
      warrantyMonths: parsed.data.warrantyMonths,
      status: parsed.data.status,
    })
    .where(eq(projects.id, id))
    .returning();

  if (!updated) {
    return { success: false, error: "Projekt nem található" };
  }

  revalidatePath("/");
  return { success: true, data: updated };
}

export async function deleteProject(id: number): Promise<ProjectFormState> {
  const [deleted] = await db.delete(projects).where(eq(projects.id, id)).returning();
  if (!deleted) {
    return { success: false, error: "Projekt nem található" };
  }
  revalidatePath("/");
  return { success: true, data: deleted };
}

/** For dropdowns */
export async function getClientsForSelect() {
  return db
    .select({ id: partners.id, name: partners.name })
    .from(partners)
    .where(eq(partners.partnerType, "client"))
    .orderBy(partners.name);
}

/** For the global project selector */
export async function getProjectsForSelect() {
  return db
    .select({
      id: projects.id,
      projectCode: projects.projectCode,
      name: projects.name,
    })
    .from(projects)
    .where(eq(projects.status, "active"))
    .orderBy(projects.name);
}
