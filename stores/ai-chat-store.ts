import { create } from "zustand";

/* ------------------------------------------------------------------ */
/*  Types (shared with AiAssistant component)                          */
/* ------------------------------------------------------------------ */

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

export interface ThinkingStep {
  type: "rationale" | "modelInput" | "toolCall" | "observation" | "preProcessing" | "postProcessing" | "failure";
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

export interface FileAttachment {
  name: string;
  size: number;
  type: string;
  base64?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: FileAttachment[];
  thinkingSteps?: ThinkingStep[];
  linkedContents?: LinkedContent[];
  proposedActions?: ProposedAction[];
  timestamp: Date;
}

/* ------------------------------------------------------------------ */
/*  Store                                                              */
/* ------------------------------------------------------------------ */

const WELCOME_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Üdvözlöm! Az ERP AI Asszisztens vagyok. Segíthetek adatok elemzésében, riportok készítésében, vagy bármilyen kérdésben az ERP rendszerrel kapcsolatban. Miben segíthetek?",
  timestamp: new Date(),
};

interface AiChatStore {
  messages: ChatMessage[];
  bedrockSessionId: string;
  addMessage: (msg: ChatMessage) => void;
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void;
  appendThinkingStep: (msgId: string, step: ThinkingStep) => void;
  resetChat: () => void;
}

export const useAiChatStore = create<AiChatStore>((set) => ({
  messages: [WELCOME_MESSAGE],
  bedrockSessionId: crypto.randomUUID(),

  addMessage: (msg) =>
    set((s) => ({ messages: [...s.messages, msg] })),

  updateMessage: (id, patch) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, ...patch } : m,
      ),
    })),

  appendThinkingStep: (msgId, step) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === msgId
          ? { ...m, thinkingSteps: [...(m.thinkingSteps ?? []), step] }
          : m,
      ),
    })),

  resetChat: () =>
    set({
      messages: [{ ...WELCOME_MESSAGE, timestamp: new Date() }],
      bedrockSessionId: crypto.randomUUID(),
    }),
}));
