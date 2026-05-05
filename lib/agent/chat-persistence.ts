import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiChatMessages, aiChatSessions } from "@/lib/db/schema";
import { toAgentAttachment } from "@/lib/agent/file-attachments";
import type { AgentChatHistoryMessage } from "@/lib/agent/types";
import type {
  AiChatAttachment,
  AiChatMessageDto,
  AiChatRole,
  AiChatSessionDetail,
  AiChatSessionSummary,
  LinkedContent,
  ProposedAction,
} from "@/types/ai-chat";

type AiChatSessionRow = typeof aiChatSessions.$inferSelect;
type AiChatMessageRow = typeof aiChatMessages.$inferSelect;

const DEFAULT_SESSION_TITLE = "Új beszélgetés";

function toIso(date: Date): string {
  return date.toISOString();
}

function compactPreview(content: string, attachments: AiChatAttachment[] = []): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length > 0) return normalized.slice(0, 180);
  if (attachments.length > 0) return `Csatolmány: ${attachments.map((file) => file.name).join(", ")}`.slice(0, 180);
  return "Üres üzenet";
}

export function createSessionTitle(message: string, attachments: AiChatAttachment[] = []): string {
  const preview = compactPreview(message, attachments);
  if (preview === "Üres üzenet") return DEFAULT_SESSION_TITLE;
  return preview.length > 64 ? `${preview.slice(0, 61)}...` : preview;
}

export function serializeAiChatSession(row: AiChatSessionRow): AiChatSessionSummary {
  return {
    id: row.id,
    title: row.title,
    lastMessage: row.lastMessagePreview,
    messageCount: row.messageCount,
    webSearchEnabled: row.webSearchEnabled,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.lastMessageAt ?? row.updatedAt),
  };
}

export function serializeAiChatMessage(row: AiChatMessageRow): AiChatMessageDto {
  return {
    id: row.id,
    role: row.role as AiChatRole,
    content: row.content,
    attachments: row.attachments.length > 0 ? row.attachments : undefined,
    linkedContents: row.linkedContents.length > 0 ? row.linkedContents : undefined,
    proposedActions: row.proposedActions.length > 0 ? row.proposedActions : undefined,
    timestamp: toIso(row.createdAt),
  };
}

export async function listAiChatSessionsForUser(userId: string): Promise<AiChatSessionSummary[]> {
  const rows = await db
    .select()
    .from(aiChatSessions)
    .where(and(eq(aiChatSessions.userId, userId), isNull(aiChatSessions.archivedAt)))
    .orderBy(desc(aiChatSessions.lastMessageAt), desc(aiChatSessions.updatedAt))
    .limit(50);

  return rows.map(serializeAiChatSession);
}

export async function getAiChatSessionForUser(
  userId: string,
  sessionId: string,
): Promise<AiChatSessionSummary | null> {
  const [row] = await db
    .select()
    .from(aiChatSessions)
    .where(
      and(
        eq(aiChatSessions.id, sessionId),
        eq(aiChatSessions.userId, userId),
        isNull(aiChatSessions.archivedAt),
      ),
    );

  return row ? serializeAiChatSession(row) : null;
}

export async function getAiChatSessionDetailForUser(
  userId: string,
  sessionId: string,
): Promise<AiChatSessionDetail | null> {
  const session = await getAiChatSessionForUser(userId, sessionId);
  if (!session) return null;

  const messages = await db
    .select()
    .from(aiChatMessages)
    .where(and(eq(aiChatMessages.sessionId, sessionId), eq(aiChatMessages.userId, userId)))
    .orderBy(asc(aiChatMessages.createdAt));

  return { session, messages: messages.map(serializeAiChatMessage) };
}

export async function ensureAiChatSession(input: {
  userId: string;
  sessionId: string;
  webSearchEnabled: boolean;
}): Promise<AiChatSessionSummary> {
  const existing = await getAiChatSessionForUser(input.userId, input.sessionId);
  if (existing) {
    if (existing.webSearchEnabled !== input.webSearchEnabled) {
      await updateAiChatSessionSettingsForUser(input.userId, input.sessionId, {
        webSearchEnabled: input.webSearchEnabled,
      });
      return {
        ...existing,
        webSearchEnabled: input.webSearchEnabled,
        updatedAt: new Date().toISOString(),
      };
    }
    return existing;
  }

  const [created] = await db
    .insert(aiChatSessions)
    .values({
      id: input.sessionId,
      userId: input.userId,
      webSearchEnabled: input.webSearchEnabled,
    })
    .returning();

  if (!created) throw new Error("Nem sikerült létrehozni az AI beszélgetést");
  return serializeAiChatSession(created);
}

export async function updateAiChatSessionSettingsForUser(
  userId: string,
  sessionId: string,
  settings: { webSearchEnabled: boolean },
): Promise<AiChatSessionSummary | null> {
  const [updated] = await db
    .update(aiChatSessions)
    .set({
      webSearchEnabled: settings.webSearchEnabled,
      updatedAt: new Date(),
    })
    .where(and(eq(aiChatSessions.id, sessionId), eq(aiChatSessions.userId, userId)))
    .returning();

  return updated ? serializeAiChatSession(updated) : null;
}

export async function renameAiChatSessionForUser(
  userId: string,
  sessionId: string,
  title: string,
): Promise<AiChatSessionSummary | null> {
  const [updated] = await db
    .update(aiChatSessions)
    .set({
      title,
      updatedAt: new Date(),
    })
    .where(and(eq(aiChatSessions.id, sessionId), eq(aiChatSessions.userId, userId)))
    .returning();

  return updated ? serializeAiChatSession(updated) : null;
}

export async function archiveAiChatSessionForUser(
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const [updated] = await db
    .update(aiChatSessions)
    .set({
      archivedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(aiChatSessions.id, sessionId), eq(aiChatSessions.userId, userId)))
    .returning({ id: aiChatSessions.id });

  return Boolean(updated);
}

export async function insertAiChatMessageForUser(input: {
  id?: string;
  userId: string;
  sessionId: string;
  role: AiChatRole;
  content: string;
  attachments?: AiChatAttachment[];
  linkedContents?: LinkedContent[];
  proposedActions?: ProposedAction[];
  sessionTitle?: string;
}): Promise<AiChatMessageDto> {
  const attachments = input.attachments ?? [];
  const linkedContents = input.linkedContents ?? [];
  const proposedActions = input.proposedActions ?? [];
  const now = new Date();

  return db.transaction(async (tx) => {
    const [message] = await tx
      .insert(aiChatMessages)
      .values({
        ...(input.id ? { id: input.id } : {}),
        sessionId: input.sessionId,
        userId: input.userId,
        role: input.role,
        content: input.content,
        attachments,
        linkedContents,
        proposedActions,
        createdAt: now,
      })
      .returning();

    if (!message) throw new Error("Nem sikerült menteni az AI üzenetet");

    await tx
      .update(aiChatSessions)
      .set({
        ...(input.sessionTitle ? { title: input.sessionTitle } : {}),
        lastMessagePreview: compactPreview(input.content, attachments),
        messageCount: sql`${aiChatSessions.messageCount} + 1`,
        lastMessageAt: now,
        updatedAt: now,
      })
      .where(and(eq(aiChatSessions.id, input.sessionId), eq(aiChatSessions.userId, input.userId)));

    return serializeAiChatMessage(message);
  });
}

export async function loadAgentHistoryForUser(input: {
  userId: string;
  sessionId: string;
  limit: number;
}): Promise<AgentChatHistoryMessage[]> {
  const rows = await db
    .select()
    .from(aiChatMessages)
    .where(and(eq(aiChatMessages.sessionId, input.sessionId), eq(aiChatMessages.userId, input.userId)))
    .orderBy(desc(aiChatMessages.createdAt))
    .limit(input.limit);

  return rows.reverse().map((row) => ({
    role: row.role as AiChatRole,
    content: row.content,
    attachments: row.attachments.map(toAgentAttachment),
  }));
}
