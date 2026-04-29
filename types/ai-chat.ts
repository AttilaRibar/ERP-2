export type AiChatRole = "user" | "assistant";

export type AttachmentExtractionStatus =
  | "processed"
  | "unsupported"
  | "failed"
  | "truncated";

export interface LinkedContent {
  entityType: string;
  entityId: number;
}

export interface ProposedAction {
  actionType: "create" | "modify" | "delete";
  entityType: string;
  entityId: number | null;
  payload: Record<string, unknown>;
  description?: string;
}

export interface AiChatAttachment {
  name: string;
  size: number;
  type: string;
  extractionStatus?: AttachmentExtractionStatus;
  extractedText?: string;
  summary?: string;
  error?: string;
  /**
   * Set on assistant messages when the agent produced a downloadable file
   * (e.g. an edited Excel). Resolves to `/api/ai/files/{downloadId}`.
   * Outputs live in process-local memory and expire when the workbook
   * session does — historical chat turns may surface 410 Gone on download.
   */
  downloadId?: string;
}

export interface AiChatMessageDto {
  id: string;
  role: AiChatRole;
  content: string;
  attachments?: AiChatAttachment[];
  linkedContents?: LinkedContent[];
  proposedActions?: ProposedAction[];
  timestamp: string;
}

export interface AiChatSessionSummary {
  id: string;
  title: string;
  lastMessage: string;
  messageCount: number;
  webSearchEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AiChatSessionDetail {
  session: AiChatSessionSummary;
  messages: AiChatMessageDto[];
}
