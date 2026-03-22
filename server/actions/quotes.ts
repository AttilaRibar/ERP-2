"use server";

import { db } from "@/lib/db";
import { quotes, projects, partners } from "@/lib/db/schema";
import { eq, ilike, or, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const QuoteSchema = z.object({
  projectId: z.coerce.number().min(1, "Projekt kiválasztása kötelező"),
  subject: z.string().min(1, "A tárgy megadása kötelező"),
  offererId: z.coerce.number().optional().nullable(),
  price: z.coerce.number().min(0).default(0),
  currency: z.string().default("HUF"),
  status: z.enum(["pending", "accepted", "rejected", "expired"]),
  validUntil: z.string().optional().or(z.literal("")),
  notes: z.string().default(""),
});

export type QuoteFormState = {
  success: boolean;
  error?: string;
  data?: typeof quotes.$inferSelect;
};

export async function getQuotes(search?: string, statusFilter?: string, projectId?: number) {
  const conditions = [];

  if (search) {
    conditions.push(
      or(
        ilike(quotes.subject, `%${search}%`),
        ilike(quotes.quoteCode, `%${search}%`),
        ilike(projects.name, `%${search}%`)
      )!
    );
  }

  if (projectId) {
    conditions.push(eq(quotes.projectId, projectId));
  }

  if (statusFilter && statusFilter !== "all") {
    conditions.push(eq(quotes.status, statusFilter));
  }

  const rows = await db
    .select({
      id: quotes.id,
      quoteCode: quotes.quoteCode,
      subject: quotes.subject,
      price: quotes.price,
      currency: quotes.currency,
      status: quotes.status,
      validUntil: quotes.validUntil,
      notes: quotes.notes,
      createdAt: quotes.createdAt,
      projectId: quotes.projectId,
      offererId: quotes.offererId,
      projectCode: projects.projectCode,
      projectName: projects.name,
      offererName: partners.name,
    })
    .from(quotes)
    .leftJoin(projects, eq(quotes.projectId, projects.id))
    .leftJoin(partners, eq(quotes.offererId, partners.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(quotes.id);

  return rows;
}

export async function getQuoteById(id: number) {
  const [result] = await db
    .select({
      id: quotes.id,
      quoteCode: quotes.quoteCode,
      subject: quotes.subject,
      price: quotes.price,
      currency: quotes.currency,
      status: quotes.status,
      validUntil: quotes.validUntil,
      notes: quotes.notes,
      createdAt: quotes.createdAt,
      projectId: quotes.projectId,
      offererId: quotes.offererId,
      projectCode: projects.projectCode,
      projectName: projects.name,
      offererName: partners.name,
    })
    .from(quotes)
    .leftJoin(projects, eq(quotes.projectId, projects.id))
    .leftJoin(partners, eq(quotes.offererId, partners.id))
    .where(eq(quotes.id, id));
  return result ?? null;
}

export async function createQuote(formData: FormData): Promise<QuoteFormState> {
  const raw = {
    projectId: Number(formData.get("projectId")),
    subject: formData.get("subject") as string,
    offererId: formData.get("offererId") ? Number(formData.get("offererId")) : null,
    price: Number(formData.get("price") ?? 0),
    currency: (formData.get("currency") as string) || "HUF",
    status: formData.get("status") as string,
    validUntil: formData.get("validUntil") as string,
    notes: (formData.get("notes") as string) || "",
  };

  const parsed = QuoteSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Érvénytelen adatok" };
  }

  const [created] = await db
    .insert(quotes)
    .values({
      projectId: parsed.data.projectId,
      subject: parsed.data.subject,
      offererId: parsed.data.offererId || null,
      price: String(parsed.data.price),
      currency: parsed.data.currency,
      status: parsed.data.status,
      validUntil: parsed.data.validUntil || null,
      notes: parsed.data.notes,
    })
    .returning();

  revalidatePath("/");
  return { success: true, data: created };
}

export async function updateQuote(id: number, formData: FormData): Promise<QuoteFormState> {
  const raw = {
    projectId: Number(formData.get("projectId")),
    subject: formData.get("subject") as string,
    offererId: formData.get("offererId") ? Number(formData.get("offererId")) : null,
    price: Number(formData.get("price") ?? 0),
    currency: (formData.get("currency") as string) || "HUF",
    status: formData.get("status") as string,
    validUntil: formData.get("validUntil") as string,
    notes: (formData.get("notes") as string) || "",
  };

  const parsed = QuoteSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Érvénytelen adatok" };
  }

  const [updated] = await db
    .update(quotes)
    .set({
      projectId: parsed.data.projectId,
      subject: parsed.data.subject,
      offererId: parsed.data.offererId || null,
      price: String(parsed.data.price),
      currency: parsed.data.currency,
      status: parsed.data.status,
      validUntil: parsed.data.validUntil || null,
      notes: parsed.data.notes,
    })
    .where(eq(quotes.id, id))
    .returning();

  if (!updated) {
    return { success: false, error: "Ajánlat nem található" };
  }

  revalidatePath("/");
  return { success: true, data: updated };
}

export async function deleteQuote(id: number): Promise<QuoteFormState> {
  const [deleted] = await db.delete(quotes).where(eq(quotes.id, id)).returning();
  if (!deleted) {
    return { success: false, error: "Ajánlat nem található" };
  }
  revalidatePath("/");
  return { success: true, data: deleted };
}

/** For dropdowns */
export async function getProjectsForSelect() {
  return db
    .select({ id: projects.id, name: projects.name, projectCode: projects.projectCode })
    .from(projects)
    .orderBy(projects.name);
}

export async function getPartnersForSelect() {
  return db
    .select({ id: partners.id, name: partners.name })
    .from(partners)
    .orderBy(partners.name);
}
