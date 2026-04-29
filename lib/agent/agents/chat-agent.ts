import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { createAgentTraceHandler } from "@/lib/agent/debug/trace-handler";
import { createAnthropicModel, DEFAULT_ANTHROPIC_MODEL } from "@/lib/agent/llm";
import {
  CHAT_AGENT_RESPONSE_FORMAT_PROMPT,
  CHAT_AGENT_SYSTEM_PROMPT,
} from "@/lib/agent/prompts/chat-agent.prompt";
import { finishAgentRun, startAgentRun } from "@/lib/agent/proposals";
import {
  AiJsonResponseSchema,
  type AiJsonResponse,
} from "@/lib/agent/schemas/chat-response";
import { createProposalTools } from "@/lib/agent/tools/proposal-tools";
import { createReadTools } from "@/lib/agent/tools/read-tools";
import { createExcelTools } from "@/lib/agent/tools/excel-tools";
import type { AgentFileAttachment, AgentToolContext } from "@/lib/agent/types";
import { createWebSearchTools } from "@/lib/agent/tools/web-tools";
import type { AgentChatHistoryMessage } from "@/lib/agent/types";
import type { AuthSession } from "@/lib/auth/session";

// Re-exported so existing API consumers keep their import paths.
export type { AiJsonResponse } from "@/lib/agent/schemas/chat-response";
export { AiJsonResponseSchema } from "@/lib/agent/schemas/chat-response";
export type { AgentFileAttachment } from "@/lib/agent/types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface InvokeErpChatAgentInput {
  message: string;
  sessionId: string;
  session: AuthSession;
  attachments?: AgentFileAttachment[];
  history?: AgentChatHistoryMessage[];
  allowWebSearch: boolean;
}

// ---------------------------------------------------------------------------
// LangGraph runtime configuration
// ---------------------------------------------------------------------------

const AGENT_TEMPERATURE = 0.1;
const AGENT_MAX_TOKENS = 4_000;
/**
 * LangGraph ReAct cycle cap. One "step" ≈ one LLM call OR one tool call, so a
 * single Excel pricing turn can easily burn 15–25 steps:
 *   excel_inspect → excel_read_range × N sheets → db_search_items × N tételek
 *   → excel_apply_operations × M batch → excel_save_as_attachment.
 * The previous cap of 8 was too low and produced GraphRecursionError mid-run.
 * 40 leaves ample headroom while still bounding runaway loops.
 */
const RECURSION_LIMIT = 40;
const AGENT_NAME = "erp-chat-agent";
const HISTORY_MESSAGE_LIMIT = 16;
const FORMATTER_MAX_TOKENS = 2_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildAttachmentBlock(attachments: AgentFileAttachment[] = []): string {
  if (attachments.length === 0) return "";

  const blocks = attachments.map((file) => {
    const status = file.extractionStatus ?? "unsupported";
    const lines = [
      `<attachment name="${file.name}" mediaType="${file.mediaType}" status="${status}"${
        file.workbookId ? ` workbookId="${file.workbookId}"` : ""
      }>`,
      file.workbookId
        ? `Excel szerkesztő azonosító: ${file.workbookId} (használd az excel_inspect / excel_read_range / excel_apply_operations / excel_save_as_attachment eszközökkel).`
        : null,
      file.summary ? `Összegzés: ${file.summary}` : null,
      file.error ? `Hiba: ${file.error}` : null,
      file.extractedText ? `Tartalom:\n${file.extractedText}` : "Nincs feldolgozható szöveges tartalom.",
      "</attachment>",
    ];
    return lines.filter((line): line is string => line !== null).join("\n");
  });

  return `\n\n[Csatolmányok feldolgozott kivonata]\n${blocks.join("\n\n")}`;
}

function buildHumanContent(content: string, attachments?: AgentFileAttachment[]): string {
  const base = content.trim() || "Kérlek elemezd a csatolt fájlt.";
  return `${base}${buildAttachmentBlock(attachments)}`;
}

/**
 * Builds the HumanMessage for the *current* turn. PDF attachments with base64
 * payload are forwarded to Claude as native `document` content blocks so the
 * model can read text + images directly. Other attachment types remain inside
 * the textual prompt block produced by `buildAttachmentBlock`.
 */
function buildCurrentTurnHumanMessage(input: InvokeErpChatAgentInput): HumanMessage {
  const text = `${buildRuntimeContext(input)}\n\n${buildHumanContent(input.message, input.attachments)}`;
  const pdfDocs = (input.attachments ?? []).filter(
    (file) => file.mediaType === "application/pdf" && typeof file.base64 === "string" && file.base64.length > 0,
  );

  if (pdfDocs.length === 0) {
    return new HumanMessage(text);
  }

  // Anthropic multimodal content array — LangChain passes blocks through.
  const blocks: Array<Record<string, unknown>> = pdfDocs.map((file) => ({
    type: "document",
    source: {
      type: "base64",
      media_type: "application/pdf",
      data: file.base64 as string,
    },
    title: file.name,
  }));
  blocks.push({ type: "text", text });

  return new HumanMessage({ content: blocks as never });
}

function buildRuntimeContext(input: InvokeErpChatAgentInput): string {
  const now = new Date();
  return [
    "[Runtime context]",
    `Server date/time: ${now.toLocaleString("hu-HU", { timeZone: "Europe/Budapest" })}`,
    `Server ISO timestamp: ${now.toISOString()}`,
    `Internet search: ${input.allowWebSearch ? "ENABLED" : "DISABLED"}`,
    input.allowWebSearch
      ? "The web_search tool is available in this turn. For current public information, use it instead of saying search is disabled."
      : "The web_search tool is not available in this turn. If the user asks for internet lookup, say in Hungarian that internet search is disabled.",
    "[/Runtime context]",
  ].join("\n");
}

function toLangChainHistoryMessage(message: AgentChatHistoryMessage) {
  if (message.role === "assistant") {
    return new AIMessage(message.content);
  }

  return new HumanMessage(buildHumanContent(message.content, message.attachments));
}

function buildMessages(input: InvokeErpChatAgentInput) {
  const history = (input.history ?? [])
    .slice(-HISTORY_MESSAGE_LIMIT)
    .map(toLangChainHistoryMessage);

  return [
    ...history,
    buildCurrentTurnHumanMessage(input),
  ];
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part === "object" && part !== null && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return content === null || content === undefined ? "" : String(content);
}

function messageRole(message: BaseMessage): string {
  const typedMessage = message as BaseMessage & { _getType?: () => string };
  return typeof typedMessage._getType === "function" ? typedMessage._getType() : "unknown";
}

function extractFinalAssistantText(messages: BaseMessage[]): string {
  for (const message of [...messages].reverse()) {
    if (message instanceof AIMessage || messageRole(message) === "ai") {
      const text = contentToText(message.content).trim();
      if (text.length > 0) return text;
    }
  }
  return "Nem érkezett értelmezhető válasz az agenttől.";
}

function serializeFormatterTranscript(messages: BaseMessage[]): string {
  return JSON.stringify(
    messages.slice(-24).map((message) => ({
      role: messageRole(message),
      content: contentToText(message.content).slice(0, 8_000),
    })),
  );
}

async function formatAgentResponse(
  messages: BaseMessage[],
  callbacks: ReturnType<typeof createAgentTraceHandler>[] = [],
): Promise<AiJsonResponse> {
  const finalAnswer = extractFinalAssistantText(messages);
  const formatter = createAnthropicModel({
    temperature: 0,
    maxTokens: FORMATTER_MAX_TOKENS,
  }).withStructuredOutput<AiJsonResponse>(AiJsonResponseSchema, {
    name: "AiJsonResponse",
  });

  const formatted = await formatter.invoke(
    [
      new SystemMessage(CHAT_AGENT_RESPONSE_FORMAT_PROMPT),
      new HumanMessage(
        [
          "Format this ERP agent conversation into the required response envelope.",
          "The final user-visible answer is:",
          finalAnswer,
          "",
          "Recent message/tool transcript JSON:",
          serializeFormatterTranscript(messages),
        ].join("\n"),
      ),
    ],
    callbacks.length > 0 ? { callbacks } : undefined,
  );

  return AiJsonResponseSchema.parse(formatted);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Invokes the main ERP chat agent through LangGraph + Anthropic.
 *
 * Pipeline (per-turn):
 *   1. ReAct loop: tool-using agent answers in free-form Hungarian.
 *   2. A separate structured-output call reshapes the conversation into
 *      `AiJsonResponseSchema`. The formatter prompt ends with a human message,
 *      which avoids Anthropic assistant-prefill errors.
 *
 * Every invocation is audited via `agent_runs`.
 */
export async function invokeErpChatAgent(
  input: InvokeErpChatAgentInput,
): Promise<AiJsonResponse> {
  const context: AgentToolContext = {
    userId: input.session.user.sub,
    sessionId: input.sessionId,
  };

  const excel = createExcelTools(context);
  const tools = [
    ...createReadTools(context),
    ...(input.allowWebSearch ? createWebSearchTools(context) : []),
    ...createProposalTools(context),
    ...excel.tools,
  ];

  const model = createAnthropicModel({
    temperature: AGENT_TEMPERATURE,
    maxTokens: AGENT_MAX_TOKENS,
  });

  const runId = await startAgentRun({
    userId: context.userId,
    sessionId: context.sessionId,
    agentName: AGENT_NAME,
    model: DEFAULT_ANTHROPIC_MODEL,
    inputSummary: `${input.message} | attachments=${input.attachments?.length ?? 0} | web=${input.allowWebSearch}`,
  });

  const trace = createAgentTraceHandler(
    `chat sid=${context.sessionId.slice(0, 8)} run=${runId}`,
  );

  try {
    const agent = createReactAgent({
      llm: model,
      tools,
      prompt: CHAT_AGENT_SYSTEM_PROMPT,
      version: "v2",
      name: AGENT_NAME,
    });

    const result = await agent.invoke(
      { messages: buildMessages(input) },
      {
        recursionLimit: RECURSION_LIMIT,
        callbacks: [trace],
      },
    );

    const response = await formatAgentResponse(result.messages as BaseMessage[], [trace]);

    // Merge any agent-saved Excel outputs (the formatter step can't see the
    // workbook session store, so we attach them deterministically here).
    const outputAttachments = await excel.collectOutputAttachments();
    if (outputAttachments.length > 0) {
      response.outputAttachments = outputAttachments.map((file) => ({
        attachmentId: file.attachmentId,
        name: file.name,
        size: file.size,
        mediaType: file.mediaType,
      }));
    }

    trace.logSummary({
      sessionId: context.sessionId,
      userId: context.userId,
      messagePreview: input.message.slice(0, 120),
      attachments: input.attachments?.length ?? 0,
      webSearch: input.allowWebSearch,
    });
    await finishAgentRun(runId, {
      status: "succeeded",
      outputSummary: response.answer,
    });
    return response;
  } catch (error) {
    trace.logSummary({
      sessionId: context.sessionId,
      userId: context.userId,
      failed: true,
    });
    const rawMessage = error instanceof Error ? error.message : "Unknown agent error";
    // LangGraph throws "Recursion limit of N reached without hitting a stop
    // condition." — rephrase to actionable Hungarian guidance instead of
    // surfacing the framework-internal English string to end users.
    const isRecursionLimit = /recursion limit/i.test(rawMessage);
    const message = isRecursionLimit
      ? "A feladat túl sok lépést igényelt egyetlen körben, ezért az AI futás korlátba ütközött. Bontsd kisebb részekre (pl. szakaszonként árazd be a költségvetést), vagy próbáld újra."
      : rawMessage;
    await finishAgentRun(runId, { status: "failed", errorMessage: rawMessage });
    throw new Error(message);
  }
}
