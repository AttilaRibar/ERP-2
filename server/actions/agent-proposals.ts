"use server";

import { db } from "@/lib/db";
import { agentProposalOperations, agentProposals } from "@/lib/db/schema";
import { requirePermission } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { and, asc, eq } from "drizzle-orm";

export interface AgentProposalDetail {
  proposal: typeof agentProposals.$inferSelect;
  operations: (typeof agentProposalOperations.$inferSelect)[];
}

export type AgentProposalActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

async function getCurrentUserId(): Promise<string | null> {
  const session = await getCurrentUser();
  return session?.user.sub ?? null;
}

/** Loads one proposal and its operation rows for the current user. */
export async function getAgentProposalDetail(
  proposalId: number,
): Promise<AgentProposalActionResult<AgentProposalDetail>> {
  await requirePermission("agent-proposals:read");
  const userId = await getCurrentUserId();
  if (!userId) return { success: false, error: "Nincs bejelentkezett felhasználó" };

  const [proposal] = await db
    .select()
    .from(agentProposals)
    .where(and(eq(agentProposals.id, proposalId), eq(agentProposals.createdBy, userId)));

  if (!proposal) return { success: false, error: "Agent javaslat nem található" };

  const operations = await db
    .select()
    .from(agentProposalOperations)
    .where(eq(agentProposalOperations.proposalId, proposalId))
    .orderBy(asc(agentProposalOperations.sortOrder));

  return { success: true, data: { proposal, operations } };
}

/** Rejects a draft proposal. Rejected proposals cannot be executed. */
export async function rejectAgentProposal(
  proposalId: number,
): Promise<AgentProposalActionResult> {
  await requirePermission("agent-proposals:execute");
  const userId = await getCurrentUserId();
  if (!userId) return { success: false, error: "Nincs bejelentkezett felhasználó" };

  const [updated] = await db
    .update(agentProposals)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(
      and(
        eq(agentProposals.id, proposalId),
        eq(agentProposals.createdBy, userId),
        eq(agentProposals.status, "draft"),
      ),
    )
    .returning({ id: agentProposals.id });

  if (!updated) return { success: false, error: "A javaslat nem elutasítható" };
  return { success: true, data: undefined };
}
