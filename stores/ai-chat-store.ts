import { create } from "zustand";
import type {
  AiChatAttachment,
  AiChatMessageDto,
  AiChatSessionSummary,
  LinkedContent,
  ProposedAction,
} from "@/types/ai-chat";

export type { AiChatAttachment as FileAttachment, LinkedContent, ProposedAction } from "@/types/ai-chat";

export interface ThinkingStep {
  type:
    | "rationale"
    | "modelInput"
    | "toolCall"
    | "observation"
    | "preProcessing"
    | "postProcessing"
    | "failure";
  text?: string;
  actionGroup?: string;
  apiPath?: string;
  function?: string;
  knowledgeBase?: string;
  query?: string;
  invocationType?: string;
  traceType?: string;
  isValid?: boolean;
  rationale?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: AiChatAttachment[];
  thinkingSteps?: ThinkingStep[];
  linkedContents?: LinkedContent[];
  proposedActions?: ProposedAction[];
  timestamp: Date;
}

export function dtoToChatMessage(message: AiChatMessageDto): ChatMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    attachments: message.attachments,
    linkedContents: message.linkedContents,
    proposedActions: message.proposedActions,
    timestamp: new Date(message.timestamp),
  };
}

interface AiChatStore {
  sessions: AiChatSessionSummary[];
  messages: ChatMessage[];
  agentSessionId: string;
  webSearchEnabled: boolean;
  setSessions: (sessions: AiChatSessionSummary[]) => void;
  upsertSession: (session: AiChatSessionSummary | null | undefined) => void;
  removeSession: (sessionId: string) => void;
  setActiveSession: (input: {
    sessionId: string;
    messages: ChatMessage[];
    webSearchEnabled: boolean;
  }) => void;
  startNewSession: () => void;
  setWebSearchEnabled: (enabled: boolean) => void;
  addMessage: (msg: ChatMessage) => void;
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void;
  appendThinkingStep: (msgId: string, step: ThinkingStep) => void;
  resetChat: () => void;
}

export const useAiChatStore = create<AiChatStore>((set) => ({
  sessions: [],
  messages: [],
  agentSessionId: crypto.randomUUID(),
  webSearchEnabled: false,

  setSessions: (sessions) => set({ sessions }),

  upsertSession: (session) => {
    if (!session) return;
    set((state) => {
      const existingIndex = state.sessions.findIndex((item) => item.id === session.id);
      if (existingIndex >= 0) {
        return {
          sessions: state.sessions.map((item) => (item.id === session.id ? session : item)),
        };
      }

      return { sessions: [session, ...state.sessions] };
    });
  },

  removeSession: (sessionId) =>
    set((state) => ({
      sessions: state.sessions.filter((session) => session.id !== sessionId),
      ...(state.agentSessionId === sessionId
        ? {
            agentSessionId: crypto.randomUUID(),
            messages: [],
            webSearchEnabled: false,
          }
        : {}),
    })),

  setActiveSession: ({ sessionId, messages, webSearchEnabled }) =>
    set({
      agentSessionId: sessionId,
      messages,
      webSearchEnabled,
    }),

  startNewSession: () =>
    set({
      agentSessionId: crypto.randomUUID(),
      messages: [],
      webSearchEnabled: false,
    }),

  setWebSearchEnabled: (enabled) => set({ webSearchEnabled: enabled }),

  addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),

  updateMessage: (id, patch) =>
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === id ? { ...message, ...patch } : message,
      ),
    })),

  appendThinkingStep: (msgId, step) =>
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === msgId
          ? { ...message, thinkingSteps: [...(message.thinkingSteps ?? []), step] }
          : message,
      ),
    })),

  resetChat: () =>
    set({
      agentSessionId: crypto.randomUUID(),
      messages: [],
      webSearchEnabled: false,
    }),
}));
