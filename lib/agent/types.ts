/**
 * Shared types used across the SmartERP LangGraph/LangChain agent stack.
 *
 * Kept tiny on purpose — only cross-cutting types belong here. Agent-specific
 * Zod schemas live under `lib/agent/schemas/` and tool-internal types stay
 * close to the tool factories.
 */

/** Runtime context every agent tool needs to enforce RBAC and audit. */
export interface AgentToolContext {
  /** Cognito subject of the user the agent acts on behalf of. */
  userId: string;
  /** Stable agent-side conversation/session ID (used for memory + audit). */
  sessionId: string;
}

/** File payload forwarded by the chat UI to the chat agent. */
export interface AgentFileAttachment {
  name: string;
  mediaType: string;
  size?: number;
  base64?: string;
  extractionStatus?: "processed" | "unsupported" | "failed" | "truncated";
  extractedText?: string;
  summary?: string;
  error?: string;
  /**
   * Workbook-session ID assigned to spreadsheets so the agent can reference
   * the file via the `excel_*` tools without re-uploading bytes. Set only
   * for the current turn — never persisted.
   */
  workbookId?: string;
}

/** Persisted message history passed back into the agent for continuation. */
export interface AgentChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
  attachments?: AgentFileAttachment[];
}
