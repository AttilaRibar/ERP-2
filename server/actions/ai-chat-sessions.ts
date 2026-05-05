"use server";

import {
  archiveAiChatSessionForUser,
  getAiChatSessionDetailForUser,
  listAiChatSessionsForUser,
  renameAiChatSessionForUser,
  updateAiChatSessionSettingsForUser,
} from "@/lib/agent/chat-persistence";
import { requirePermission } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import type { AiChatSessionDetail, AiChatSessionSummary } from "@/types/ai-chat";
import { z } from "zod";

export type AiChatActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

async function requireAiChatUser(permission: string): Promise<string> {
  await requirePermission(permission);
  const session = await getCurrentUser();
  if (!session) throw new Error("UNAUTHORIZED");
  return session.user.sub;
}

const RenameSessionTitleSchema = z.string().trim().min(1).max(80);

/** Lists persisted AI assistant sessions for the signed-in Cognito user. */
export async function listAiChatSessionsAction(): Promise<
  AiChatActionResult<AiChatSessionSummary[]>
> {
  try {
    const userId = await requireAiChatUser("ai-chat:read");
    return { success: true, data: await listAiChatSessionsForUser(userId) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ismeretlen AI session hiba";
    return { success: false, error: message };
  }
}

/** Loads one persisted AI assistant session with messages. */
export async function getAiChatSessionAction(
  sessionId: string,
): Promise<AiChatActionResult<AiChatSessionDetail>> {
  try {
    const userId = await requireAiChatUser("ai-chat:read");
    const detail = await getAiChatSessionDetailForUser(userId, sessionId);
    if (!detail) return { success: false, error: "A beszélgetés nem található" };
    return { success: true, data: detail };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ismeretlen AI session hiba";
    return { success: false, error: message };
  }
}

/** Updates persisted per-session AI assistant settings. */
export async function updateAiChatSessionSettingsAction(
  sessionId: string,
  settings: { webSearchEnabled: boolean },
): Promise<AiChatActionResult<AiChatSessionSummary | null>> {
  try {
    const userId = await requireAiChatUser("ai-chat:write");
    if (settings.webSearchEnabled) {
      await requirePermission("internet-search:use");
    }
    const updated = await updateAiChatSessionSettingsForUser(userId, sessionId, settings);
    return { success: true, data: updated };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ismeretlen AI session hiba";
    return { success: false, error: message };
  }
}

/** Renames one persisted AI assistant session for the signed-in user. */
export async function renameAiChatSessionAction(
  sessionId: string,
  title: string,
): Promise<AiChatActionResult<AiChatSessionSummary>> {
  try {
    const userId = await requireAiChatUser("ai-chat:write");
    const parsedTitle = RenameSessionTitleSchema.safeParse(title);
    if (!parsedTitle.success) {
      return { success: false, error: "A beszélgetés neve 1-80 karakter lehet" };
    }

    const updated = await renameAiChatSessionForUser(userId, sessionId, parsedTitle.data);
    if (!updated) return { success: false, error: "A beszélgetés nem található" };
    return { success: true, data: updated };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ismeretlen AI session hiba";
    return { success: false, error: message };
  }
}

/** Archives one persisted AI assistant session for the signed-in user. */
export async function deleteAiChatSessionAction(
  sessionId: string,
): Promise<AiChatActionResult<{ deleted: true }>> {
  try {
    const userId = await requireAiChatUser("ai-chat:write");
    const archived = await archiveAiChatSessionForUser(userId, sessionId);
    if (!archived) return { success: false, error: "A beszélgetés nem található" };
    return { success: true, data: { deleted: true } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ismeretlen AI session hiba";
    return { success: false, error: message };
  }
}
