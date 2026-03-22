"use server";

import { db } from "@/lib/db";
import { partners } from "@/lib/db/schema";
import { eq, ilike, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const PartnerSchema = z.object({
  name: z.string().min(1, "A név megadása kötelező"),
  email: z.string().email("Érvénytelen e-mail cím").optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  address: z.string().optional().or(z.literal("")),
  taxNumber: z.string().optional().or(z.literal("")),
  partnerType: z.enum(["client", "subcontractor", "supplier"]),
});

export type PartnerFormState = {
  success: boolean;
  error?: string;
  data?: typeof partners.$inferSelect;
};

export async function getPartners(search?: string, typeFilter?: string) {
  const conditions = [];
  if (search) {
    conditions.push(
      or(
        ilike(partners.name, `%${search}%`),
        ilike(partners.email, `%${search}%`),
        ilike(partners.phone, `%${search}%`)
      )
    );
  }
  if (typeFilter && typeFilter !== "all") {
    conditions.push(eq(partners.partnerType, typeFilter));
  }

  const result = await db
    .select()
    .from(partners)
    .where(conditions.length > 0 ? conditions.reduce((a, b) => (a && b ? or(a, b) : a ?? b))! : undefined)
    .orderBy(partners.id);

  return result;
}

export async function getPartnerById(id: number) {
  const result = await db.select().from(partners).where(eq(partners.id, id));
  return result[0] ?? null;
}

export async function createPartner(formData: FormData): Promise<PartnerFormState> {
  const raw = {
    name: formData.get("name") as string,
    email: formData.get("email") as string,
    phone: formData.get("phone") as string,
    address: formData.get("address") as string,
    taxNumber: formData.get("taxNumber") as string,
    partnerType: formData.get("partnerType") as string,
  };

  const parsed = PartnerSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Érvénytelen adatok" };
  }

  const [created] = await db
    .insert(partners)
    .values({
      name: parsed.data.name,
      email: parsed.data.email || null,
      phone: parsed.data.phone || null,
      address: parsed.data.address || null,
      taxNumber: parsed.data.taxNumber || null,
      partnerType: parsed.data.partnerType,
    })
    .returning();

  revalidatePath("/");
  return { success: true, data: created };
}

export async function updatePartner(id: number, formData: FormData): Promise<PartnerFormState> {
  const raw = {
    name: formData.get("name") as string,
    email: formData.get("email") as string,
    phone: formData.get("phone") as string,
    address: formData.get("address") as string,
    taxNumber: formData.get("taxNumber") as string,
    partnerType: formData.get("partnerType") as string,
  };

  const parsed = PartnerSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Érvénytelen adatok" };
  }

  const [updated] = await db
    .update(partners)
    .set({
      name: parsed.data.name,
      email: parsed.data.email || null,
      phone: parsed.data.phone || null,
      address: parsed.data.address || null,
      taxNumber: parsed.data.taxNumber || null,
      partnerType: parsed.data.partnerType,
    })
    .where(eq(partners.id, id))
    .returning();

  if (!updated) {
    return { success: false, error: "Partner nem található" };
  }

  revalidatePath("/");
  return { success: true, data: updated };
}

export async function deletePartner(id: number): Promise<PartnerFormState> {
  const [deleted] = await db.delete(partners).where(eq(partners.id, id)).returning();
  if (!deleted) {
    return { success: false, error: "Partner nem található" };
  }
  revalidatePath("/");
  return { success: true, data: deleted };
}
