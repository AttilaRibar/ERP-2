import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { invokeErpChatAgent } from "@/lib/agent/agents/chat-agent";
import {
  createSessionTitle,
  ensureAiChatSession,
  getAiChatSessionForUser,
  insertAiChatMessageForUser,
  loadAgentHistoryForUser,
} from "@/lib/agent/chat-persistence";
import {
  processAgentFileAttachments,
  toStoredAttachment,
} from "@/lib/agent/file-attachments";
import { requirePermission } from "@/lib/auth/permissions";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ------------------------------------------------------------------ */
/*  Request validation                                                 */
/* ------------------------------------------------------------------ */

const RequestSchema = z.object({
  message: z.string().max(10_000).default(""),
  sessionId: z.string().uuid(),
  clientMessageId: z.string().uuid().optional(),
  webSearchEnabled: z.boolean().default(false),
  files: z
    .array(
      z.object({
        name: z.string().min(1).max(255),
        mediaType: z.string().min(1).max(180),
        size: z.number().int().min(0).max(5 * 1024 * 1024),
        base64: z.string().min(1).max(8_000_000),
      }),
    )
    .max(5)
    .optional(),
});

/* ------------------------------------------------------------------ */
/*  POST /api/ai — persisted non-streaming chat turn                   */
/* ------------------------------------------------------------------ */

export async function POST(req: NextRequest) {
  /* --- Auth check --- */
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await requirePermission("ai-chat:write");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  /* --- Parse & validate body --- */
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { clientMessageId, files, sessionId, webSearchEnabled } = parsed.data;
  const message = parsed.data.message.trim();
  if (!message && (!files || files.length === 0)) {
    return NextResponse.json({ error: "Message or file is required" }, { status: 400 });
  }

  if (webSearchEnabled) {
    try {
      await requirePermission("internet-search:use");
    } catch {
      return NextResponse.json({ error: "Internet search is not allowed" }, { status: 403 });
    }
  }

  const userId = session.user.sub;
  const processedFiles = await processAgentFileAttachments(files ?? [], {
    userId,
    sessionId,
  });
  const storedAttachments = processedFiles.map(toStoredAttachment);
  const sessionBeforeTurn = await ensureAiChatSession({
    userId,
    sessionId,
    webSearchEnabled,
  });
  const history = await loadAgentHistoryForUser({ userId, sessionId, limit: 16 });

  const userMessage = await insertAiChatMessageForUser({
    id: clientMessageId,
    userId,
    sessionId,
    role: "user",
    content: message,
    attachments: storedAttachments,
    sessionTitle:
      sessionBeforeTurn.messageCount === 0
        ? createSessionTitle(message, storedAttachments)
        : undefined,
  });

  try {
    const response = await invokeErpChatAgent({
      message,
      sessionId,
      session,
      attachments: processedFiles,
      history,
      allowWebSearch: webSearchEnabled,
    });

    const assistantAttachments = (response.outputAttachments ?? []).map((file) => ({
      name: file.name,
      size: file.size,
      type: file.mediaType,
      downloadId: file.attachmentId,
    }));

    const assistantMessage = await insertAiChatMessageForUser({
      userId,
      sessionId,
      role: "assistant",
      content: response.answer,
      linkedContents: response.linkedContents,
      proposedActions: response.proposedActions,
      attachments: assistantAttachments.length > 0 ? assistantAttachments : undefined,
    });

    const updatedSession = await getAiChatSessionForUser(userId, sessionId);

    return NextResponse.json({
      session: updatedSession,
      userMessage,
      assistantMessage,
      response,
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Unknown agent error";
    console.error("[api/ai] LangGraph agent error:", errorMessage);

    const assistantMessage = await insertAiChatMessageForUser({
      userId,
      sessionId,
      role: "assistant",
      content: `Hiba történt az agent futtatása közben: ${errorMessage}`,
    });
    const updatedSession = await getAiChatSessionForUser(userId, sessionId);

    return NextResponse.json(
      { error: errorMessage, session: updatedSession, userMessage, assistantMessage },
      { status: 500 },
    );
  }
}
