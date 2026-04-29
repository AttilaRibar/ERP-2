"use server";

import { db } from "@/lib/db";
import {
  agentProposalOperations,
  agentProposals,
  partners,
  projects,
  quotes,
  budgets,
} from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

const ProposedActionSchema = z.object({
  actionType: z.enum(["create", "modify", "delete"]),
  entityType: z.string().min(1),
  entityId: z.coerce.number().nullable(),
  payload: z.record(z.string(), z.unknown()).default({}),
  description: z.string().optional(),
});

export type ExecuteActionResult = {
  success: boolean;
  error?: string;
};

/* ------------------------------------------------------------------ */
/*  Entity handlers                                                    */
/* ------------------------------------------------------------------ */

async function handlePartner(
  actionType: string,
  entityId: number | null,
  payload: Record<string, unknown>,
): Promise<ExecuteActionResult> {
  if (actionType === "create") {
    const name = payload.name;
    if (typeof name !== "string" || !name) {
      return { success: false, error: "A partner neve kötelező" };
    }
    await db.insert(partners).values({
      name,
      email: (payload.email as string) || null,
      phone: (payload.phone as string) || null,
      address: (payload.address as string) || null,
      taxNumber: (payload.taxNumber as string) || null,
      partnerType: (payload.partnerType as string) || "client",
    });
    return { success: true };
  }

  if (actionType === "modify") {
    if (!entityId) return { success: false, error: "Hiányzó partner azonosító" };
    const set: Record<string, unknown> = {};
    if ("name" in payload) set.name = payload.name;
    if ("email" in payload) set.email = payload.email || null;
    if ("phone" in payload) set.phone = payload.phone || null;
    if ("address" in payload) set.address = payload.address || null;
    if ("taxNumber" in payload) set.taxNumber = payload.taxNumber || null;
    if ("partnerType" in payload) set.partnerType = payload.partnerType;
    if (Object.keys(set).length === 0) return { success: false, error: "Nincs módosítandó mező" };

    const [updated] = await db.update(partners).set(set).where(eq(partners.id, entityId)).returning();
    if (!updated) return { success: false, error: "Partner nem található" };
    return { success: true };
  }

  if (actionType === "delete") {
    if (!entityId) return { success: false, error: "Hiányzó partner azonosító" };
    const [deleted] = await db.delete(partners).where(eq(partners.id, entityId)).returning();
    if (!deleted) return { success: false, error: "Partner nem található" };
    return { success: true };
  }

  return { success: false, error: "Ismeretlen művelet típus" };
}

async function handleProject(
  actionType: string,
  entityId: number | null,
  payload: Record<string, unknown>,
): Promise<ExecuteActionResult> {
  if (actionType === "create") {
    const name = payload.name;
    if (typeof name !== "string" || !name) {
      return { success: false, error: "A projekt neve kötelező" };
    }
    await db.insert(projects).values({
      name,
      startDate: (payload.startDate as string) || null,
      endDate: (payload.endDate as string) || null,
      clientId: payload.clientId != null ? Number(payload.clientId) : null,
      warrantyMonths: payload.warrantyMonths != null ? Number(payload.warrantyMonths) : 12,
      status: (payload.status as string) || "active",
    });
    return { success: true };
  }

  if (actionType === "modify") {
    if (!entityId) return { success: false, error: "Hiányzó projekt azonosító" };
    const set: Record<string, unknown> = {};
    if ("name" in payload) set.name = payload.name;
    if ("startDate" in payload) set.startDate = payload.startDate || null;
    if ("endDate" in payload) set.endDate = payload.endDate || null;
    if ("clientId" in payload) set.clientId = payload.clientId != null ? Number(payload.clientId) : null;
    if ("warrantyMonths" in payload) set.warrantyMonths = Number(payload.warrantyMonths);
    if ("status" in payload) set.status = payload.status;
    if (Object.keys(set).length === 0) return { success: false, error: "Nincs módosítandó mező" };

    const [updated] = await db.update(projects).set(set).where(eq(projects.id, entityId)).returning();
    if (!updated) return { success: false, error: "Projekt nem található" };
    return { success: true };
  }

  if (actionType === "delete") {
    if (!entityId) return { success: false, error: "Hiányzó projekt azonosító" };
    const [deleted] = await db.delete(projects).where(eq(projects.id, entityId)).returning();
    if (!deleted) return { success: false, error: "Projekt nem található" };
    return { success: true };
  }

  return { success: false, error: "Ismeretlen művelet típus" };
}

async function handleQuote(
  actionType: string,
  entityId: number | null,
  payload: Record<string, unknown>,
): Promise<ExecuteActionResult> {
  if (actionType === "create") {
    if (!payload.projectId || !payload.subject) {
      return { success: false, error: "A projekt és a tárgy megadása kötelező" };
    }
    await db.insert(quotes).values({
      projectId: Number(payload.projectId),
      subject: payload.subject as string,
      offererId: payload.offererId != null ? Number(payload.offererId) : null,
      price: payload.price != null ? String(payload.price) : "0",
      currency: (payload.currency as string) || "HUF",
      status: (payload.status as string) || "pending",
      validUntil: (payload.validUntil as string) || null,
      notes: (payload.notes as string) || "",
    });
    return { success: true };
  }

  if (actionType === "modify") {
    if (!entityId) return { success: false, error: "Hiányzó ajánlat azonosító" };
    const set: Record<string, unknown> = {};
    if ("subject" in payload) set.subject = payload.subject;
    if ("projectId" in payload) set.projectId = Number(payload.projectId);
    if ("offererId" in payload) set.offererId = payload.offererId != null ? Number(payload.offererId) : null;
    if ("price" in payload) set.price = String(payload.price);
    if ("currency" in payload) set.currency = payload.currency;
    if ("status" in payload) set.status = payload.status;
    if ("validUntil" in payload) set.validUntil = payload.validUntil || null;
    if ("notes" in payload) set.notes = payload.notes;
    if (Object.keys(set).length === 0) return { success: false, error: "Nincs módosítandó mező" };

    const [updated] = await db.update(quotes).set(set).where(eq(quotes.id, entityId)).returning();
    if (!updated) return { success: false, error: "Ajánlat nem található" };
    return { success: true };
  }

  if (actionType === "delete") {
    if (!entityId) return { success: false, error: "Hiányzó ajánlat azonosító" };
    const [deleted] = await db.delete(quotes).where(eq(quotes.id, entityId)).returning();
    if (!deleted) return { success: false, error: "Ajánlat nem található" };
    return { success: true };
  }

  return { success: false, error: "Ismeretlen művelet típus" };
}

async function handleBudget(
  actionType: string,
  entityId: number | null,
  payload: Record<string, unknown>,
): Promise<ExecuteActionResult> {
  if (actionType === "create") {
    if (!payload.projectId || !payload.name) {
      return { success: false, error: "A projekt és a név megadása kötelező" };
    }
    await db.insert(budgets).values({
      projectId: Number(payload.projectId),
      name: payload.name as string,
    });
    return { success: true };
  }

  if (actionType === "modify") {
    if (!entityId) return { success: false, error: "Hiányzó költségvetés azonosító" };
    const set: Record<string, unknown> = {};
    if ("name" in payload) set.name = payload.name;
    if ("projectId" in payload) set.projectId = Number(payload.projectId);
    if (Object.keys(set).length === 0) return { success: false, error: "Nincs módosítandó mező" };

    const [updated] = await db.update(budgets).set(set).where(eq(budgets.id, entityId)).returning();
    if (!updated) return { success: false, error: "Költségvetés nem található" };
    return { success: true };
  }

  if (actionType === "delete") {
    if (!entityId) return { success: false, error: "Hiányzó költségvetés azonosító" };
    const [deleted] = await db.delete(budgets).where(eq(budgets.id, entityId)).returning();
    if (!deleted) return { success: false, error: "Költségvetés nem található" };
    return { success: true };
  }

  return { success: false, error: "Ismeretlen művelet típus" };
}

function proposalOperationToActionType(operationType: string): "create" | "modify" | "delete" | null {
  if (operationType === "create") return "create";
  if (operationType === "update") return "modify";
  if (operationType === "delete") return "delete";
  return null;
}

function readProposalId(entityId: number | null, payload: Record<string, unknown>): number | null {
  if (entityId) return entityId;
  const fromPayload = payload.proposalId;
  return typeof fromPayload === "number" && Number.isInteger(fromPayload) ? fromPayload : null;
}

async function handleAgentProposal(
  actionType: string,
  entityId: number | null,
  payload: Record<string, unknown>,
): Promise<ExecuteActionResult> {
  if (actionType !== "modify") {
    return { success: false, error: "Agent javaslatot csak jóváhagyni lehet" };
  }

  await requirePermission("agent-proposals:execute");
  const session = await getCurrentUser();
  if (!session) return { success: false, error: "Nincs bejelentkezett felhasználó" };

  const proposalId = readProposalId(entityId, payload);
  if (!proposalId) return { success: false, error: "Hiányzó agent javaslat azonosító" };

  const [proposal] = await db
    .select()
    .from(agentProposals)
    .where(
      and(
        eq(agentProposals.id, proposalId),
        eq(agentProposals.createdBy, session.user.sub),
      ),
    );

  if (!proposal) return { success: false, error: "Agent javaslat nem található" };
  if (proposal.status !== "draft" && proposal.status !== "approved") {
    return { success: false, error: `A javaslat nem végrehajtható állapotban van: ${proposal.status}` };
  }
  if (proposal.expiresAt && proposal.expiresAt.getTime() < Date.now()) {
    await db.update(agentProposals).set({ status: "expired", updatedAt: new Date() }).where(eq(agentProposals.id, proposal.id));
    return { success: false, error: "A javaslat lejárt" };
  }

  for (const permission of proposal.requiredPermissions) {
    await requirePermission(permission);
  }

  const operations = await db
    .select()
    .from(agentProposalOperations)
    .where(eq(agentProposalOperations.proposalId, proposal.id))
    .orderBy(asc(agentProposalOperations.sortOrder));

  if (operations.length === 0) {
    return { success: false, error: "A javaslat nem tartalmaz végrehajtható műveletet" };
  }

  await db
    .update(agentProposals)
    .set({
      status: "executing",
      approvedBy: session.user.sub,
      executedBy: session.user.sub,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(agentProposals.id, proposal.id));

  const errors: string[] = [];

  for (const operation of operations) {
    const handler = ENTITY_HANDLERS[operation.entityType];
    const mappedActionType = proposalOperationToActionType(operation.operationType);

    if (!handler || !mappedActionType) {
      const error = `Nem támogatott proposal művelet: ${operation.entityType}/${operation.operationType}`;
      errors.push(error);
      await db
        .update(agentProposalOperations)
        .set({ status: "failed", conflictReason: error, updatedAt: new Date() })
        .where(eq(agentProposalOperations.id, operation.id));
      continue;
    }

    const numericEntityId = operation.entityId === null ? null : Number(operation.entityId);
    if (operation.entityId !== null && !Number.isFinite(numericEntityId)) {
      const error = `Érvénytelen entitás azonosító: ${operation.entityId}`;
      errors.push(error);
      await db
        .update(agentProposalOperations)
        .set({ status: "failed", conflictReason: error, updatedAt: new Date() })
        .where(eq(agentProposalOperations.id, operation.id));
      continue;
    }

    const operationPayload = mappedActionType === "delete" ? {} : operation.afterSnapshot;
    const result = await handler(mappedActionType, numericEntityId, operationPayload);

    await db
      .update(agentProposalOperations)
      .set({
        status: result.success ? "applied" : "failed",
        conflictReason: result.success ? null : (result.error ?? "Ismeretlen hiba"),
        updatedAt: new Date(),
      })
      .where(eq(agentProposalOperations.id, operation.id));

    if (!result.success) {
      errors.push(result.error ?? "Ismeretlen hiba");
    }
  }

  await db
    .update(agentProposals)
    .set({
      status: errors.length === 0 ? "executed" : "failed",
      failureReason: errors.length === 0 ? null : errors.join("; "),
      executedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(agentProposals.id, proposal.id));

  return errors.length === 0
    ? { success: true }
    : { success: false, error: errors.join("; ") };
}

/* ------------------------------------------------------------------ */
/*  Router                                                             */
/* ------------------------------------------------------------------ */

const ENTITY_HANDLERS: Record<
  string,
  (actionType: string, entityId: number | null, payload: Record<string, unknown>) => Promise<ExecuteActionResult>
> = {
  partner: handlePartner,
  project: handleProject,
  quote: handleQuote,
  budget: handleBudget,
  agent_proposal: handleAgentProposal,
};

/**
 * Executes a proposed AI action after user approval.
 * Routes to the correct entity handler based on entityType.
 */
export async function executeProposedAction(
  actionType: string,
  entityType: string,
  entityId: number | null,
  payload?: Record<string, unknown>,
): Promise<ExecuteActionResult> {
  const parsed = ProposedActionSchema.safeParse({ actionType, entityType, entityId, payload: payload ?? {} });
  if (!parsed.success) {
    console.error("[ai-actions] Validation failed:", parsed.error.flatten(), { actionType, entityType, entityId, payload });
    return { success: false, error: "Érvénytelen művelet paraméterek" };
  }

  const handler = ENTITY_HANDLERS[parsed.data.entityType];
  if (!handler) {
    return { success: false, error: `Ismeretlen entitás típus: ${parsed.data.entityType}` };
  }

  try {
    const result = await handler(parsed.data.actionType, parsed.data.entityId, parsed.data.payload);
    if (result.success) {
      revalidatePath("/");
    }
    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Ismeretlen hiba";
    console.error("[ai-actions] executeProposedAction error:", msg);
    return { success: false, error: msg };
  }
}

/* ------------------------------------------------------------------ */
/*  Entity name resolution                                             */
/* ------------------------------------------------------------------ */

export interface ResolvedEntity {
  entityType: string;
  entityId: number;
  name: string | null;
}

/**
 * Resolves display names for a batch of entity references.
 * Used by the AI linked content panel.
 */
export async function resolveEntityNames(
  items: Array<{ entityType: string; entityId: number }>,
): Promise<ResolvedEntity[]> {
  const results: ResolvedEntity[] = [];

  for (const item of items) {
    let name: string | null = null;
    try {
      switch (item.entityType) {
        case "partner": {
          const [row] = await db
            .select({ name: partners.name })
            .from(partners)
            .where(eq(partners.id, item.entityId));
          name = row?.name ?? null;
          break;
        }
        case "project": {
          const [row] = await db
            .select({ name: projects.name, code: projects.projectCode })
            .from(projects)
            .where(eq(projects.id, item.entityId));
          name = row ? `${row.code ?? ""} ${row.name}`.trim() : null;
          break;
        }
        case "quote": {
          const [row] = await db
            .select({ subject: quotes.subject, code: quotes.quoteCode })
            .from(quotes)
            .where(eq(quotes.id, item.entityId));
          name = row ? `${row.code ?? ""} ${row.subject}`.trim() : null;
          break;
        }
        case "budget": {
          const [row] = await db
            .select({ name: budgets.name })
            .from(budgets)
            .where(eq(budgets.id, item.entityId));
          name = row?.name ?? null;
          break;
        }
      }
    } catch (err) {
      console.error(`[ai-actions] resolveEntityNames error for ${item.entityType}#${item.entityId}:`, err);
    }
    results.push({ entityType: item.entityType, entityId: item.entityId, name });
  }

  return results;
}
