"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Send,
  Paperclip,
  Bot,
  User,
  Plus,
  MessageSquare,
  X,
  FileIcon,
  Sparkles,
  Square,
  Brain,
  ChevronDown,
  ChevronRight,
  Wrench,
  Eye,
  AlertTriangle,
  Link2,
  ClipboardCheck,
  Check,
  XCircle,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { useTabStore } from "@/stores/tab-store";
import { useAiChatStore, type ChatMessage, type ThinkingStep, type LinkedContent, type ProposedAction, type FileAttachment } from "@/stores/ai-chat-store";
import { executeProposedAction, resolveEntityNames } from "@/server/actions/ai-actions";
import { MODULE_REGISTRY } from "@/lib/modules";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AiJsonResponse {
  answer: string;
  linkedContents: LinkedContent[];
  proposedActions: ProposedAction[];
}

interface Session {
  id: string;
  title: string;
  lastMessage: string;
  date: string;
}

/* ------------------------------------------------------------------ */
/*  Placeholder data                                                   */
/* ------------------------------------------------------------------ */

const PLACEHOLDER_SESSIONS: Session[] = [
  {
    id: "s1",
    title: "Költségvetés elemzés",
    lastMessage: "Az Q1 költségvetés 12%-kal meghaladta a tervet...",
    date: "Ma",
  },
  {
    id: "s2",
    title: "Partner kereső",
    lastMessage: "A következő partnerek felelnek meg a feltételeknek...",
    date: "Tegnap",
  },
  {
    id: "s3",
    title: "Projekt státusz riport",
    lastMessage: "3 projekt van késedelemben, amelyek...",
    date: "Márc. 20.",
  },
  {
    id: "s4",
    title: "Ajánlat összehasonlítás",
    lastMessage: "Az A ajánlat 15%-kal kedvezőbb mint a B ajánlat...",
    date: "Márc. 18.",
  },
  {
    id: "s5",
    title: "HR költségek kimutatás",
    lastMessage: "A bérköltségek az elmúlt negyedévben...",
    date: "Márc. 15.",
  },
];



/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

let msgCounter = 0;
function newMsgId() {
  msgCounter++;
  return `msg-${msgCounter}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Read a File object as base64-encoded string (without the data URI prefix). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip "data:...;base64," prefix
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Attempt to parse the full AI response text as the structured JSON format. */
function tryParseAiJson(text: string): AiJsonResponse | null {
  try {
    // The agent may wrap JSON in markdown code blocks — strip them
    let cleaned = text.trim();
    if (cleaned.startsWith("```json")) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith("```")) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith("```")) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();

    // The LLM often puts literal newlines inside JSON string values, which is
    // invalid JSON.  Fix: escape unescaped newlines/tabs that sit inside strings.
    // We walk through the text tracking whether we're inside a JSON string and
    // replace raw control characters with their escaped equivalents.
    cleaned = fixJsonStringNewlines(cleaned);

    const parsed = JSON.parse(cleaned);
    if (typeof parsed === "object" && parsed !== null && "answer" in parsed) {
      return {
        answer: String(parsed.answer ?? ""),
        linkedContents: Array.isArray(parsed.linkedContents) ? parsed.linkedContents : [],
        proposedActions: Array.isArray(parsed.proposedActions) ? parsed.proposedActions : [],
      };
    }
  } catch {
    // Not valid JSON — treat as plain text
  }
  return null;
}

/**
 * Walk through raw JSON text and escape literal newlines / tabs that appear
 * inside string values.  This handles the common LLM problem where the model
 * outputs multiline content inside a JSON string without proper escaping.
 */
function fixJsonStringNewlines(raw: string): string {
  let result = "";
  let inString = false;
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];

    // Handle escape sequences inside strings — skip next character
    if (inString && ch === "\\") {
      result += ch + (raw[i + 1] ?? "");
      i += 2;
      continue;
    }

    // Toggle string state on unescaped double quotes
    if (ch === '"') {
      inString = !inString;
      result += ch;
      i++;
      continue;
    }

    // If inside a string, replace literal control chars with escape sequences
    if (inString) {
      if (ch === "\n") { result += "\\n"; i++; continue; }
      if (ch === "\r") { result += "\\r"; i++; continue; }
      if (ch === "\t") { result += "\\t"; i++; continue; }
    }

    result += ch;
    i++;
  }
  return result;
}

/** Map entityType to Hungarian label */
const ENTITY_LABELS: Record<string, string> = {
  partner: "Partner",
  project: "Projekt",
  quote: "Ajánlat",
  budget: "Költségvetés",
};

/** Map entityType to module key for tab navigation */
const ENTITY_MODULE_MAP: Record<string, string> = {
  partner: "partners",
  project: "projects",
  quote: "quotes",
  budget: "budgets",
};

const ACTION_TYPE_LABELS: Record<string, string> = {
  create: "Létrehozás",
  modify: "Módosítás",
  delete: "Törlés",
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function AiAssistant() {
  const messages = useAiChatStore((s) => s.messages);
  const bedrockSessionId = useAiChatStore((s) => s.bedrockSessionId);
  const addMessage = useAiChatStore((s) => s.addMessage);
  const updateMessage = useAiChatStore((s) => s.updateMessage);
  const appendThinkingStep = useAiChatStore((s) => s.appendThinkingStep);
  const resetChat = useAiChatStore((s) => s.resetChat);

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [rawFiles, setRawFiles] = useState<File[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  /* ---- Stop generation ---- */
  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsTyping(false);
  }, []);

  /* ---- Send message ---- */
  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed && attachments.length === 0) return;

    const userMsg: ChatMessage = {
      id: newMsgId(),
      role: "user",
      content: trimmed,
      attachments: attachments.length > 0 ? [...attachments] : undefined,
      timestamp: new Date(),
    };

    // Convert raw files to base64 for the API
    const filesToSend = await Promise.all(
      rawFiles.map(async (f) => ({
        name: f.name,
        mediaType: f.type || "application/octet-stream",
        base64: await fileToBase64(f),
      })),
    );

    addMessage(userMsg);
    setInput("");
    setAttachments([]);
    setRawFiles([]);
    scrollToBottom();

    // Start streaming from Bedrock
    setIsTyping(true);
    const assistantMsgId = newMsgId();
    const abortController = new AbortController();
    abortRef.current = abortController;

    // Add empty assistant message that we'll stream into
    addMessage({
      id: assistantMsgId,
      role: "assistant",
      content: "",
      timestamp: new Date(),
    });

    let fullText = "";

    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          sessionId: bedrockSessionId,
          ...(filesToSend.length > 0 ? { files: filesToSend } : {}),
        }),
        signal: abortController.signal,
      });

      if (!res.ok) {
        const errorBody = await res.text();
        throw new Error(`HTTP ${res.status}: ${errorBody}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // Keep the last potentially incomplete line
        buffer = lines.pop() ?? "";

        let currentEvent = "";
        for (const line of lines) {
          // SSE event type line
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
            continue;
          }
          if (line.startsWith("data: ")) {
            try {
              const payload = JSON.parse(line.slice(6));

              if (currentEvent === "chunk" && "text" in payload) {
                // Accumulate full text silently — don't display raw chunks
                // (the agent responds with JSON; we parse and show only the answer after streaming)
                fullText += payload.text;
                scrollToBottom();
              }

              if (currentEvent === "thinking") {
                appendThinkingStep(assistantMsgId, payload as ThinkingStep);
                scrollToBottom();
              }
            } catch {
              // Skip malformed SSE lines
            }
            currentEvent = "";
          }
        }
      }

      // After streaming completes, parse JSON and extract answer + linked data
      const parsed = tryParseAiJson(fullText);
      if (parsed) {
        updateMessage(assistantMsgId, {
          content: parsed.answer,
          linkedContents: parsed.linkedContents.length > 0 ? parsed.linkedContents : undefined,
          proposedActions: parsed.proposedActions.length > 0 ? parsed.proposedActions : undefined,
        });
      } else {
        // Not valid JSON — show raw text as fallback and log warning
        console.warn("[AiAssistant] Failed to parse AI response as JSON. Raw:", fullText);
        updateMessage(assistantMsgId, { content: fullText });
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // User cancelled — try to parse what we have so far
        const partial = tryParseAiJson(fullText);
        if (partial) {
          updateMessage(assistantMsgId, {
            content: partial.answer,
            linkedContents: partial.linkedContents.length > 0 ? partial.linkedContents : undefined,
            proposedActions: partial.proposedActions.length > 0 ? partial.proposedActions : undefined,
          });
        } else if (fullText) {
          updateMessage(assistantMsgId, { content: fullText });
        }
      } else {
        const errorMsg = err instanceof Error ? err.message : "Ismeretlen hiba";
        console.error("[AiAssistant] Streaming error:", errorMsg, err);
        updateMessage(assistantMsgId, {
          content: `⚠️ Hiba történt: ${errorMsg}`,
        });
      }
    } finally {
      abortRef.current = null;
      setIsTyping(false);
      scrollToBottom();
    }
  }, [input, attachments, rawFiles, bedrockSessionId, scrollToBottom, addMessage, updateMessage, appendThinkingStep]);

  /* ---- File handling ---- */
  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;
      const fileArr = Array.from(files);
      const newAttachments: FileAttachment[] = fileArr.map((f) => ({
        name: f.name,
        size: f.size,
        type: f.type,
      }));
      setAttachments((prev) => [...prev, ...newAttachments]);
      setRawFiles((prev) => [...prev, ...fileArr]);
      // reset input so the same file can be re-selected
      e.target.value = "";
    },
    [],
  );

  const removeAttachment = useCallback((name: string) => {
    setAttachments((prev) => prev.filter((a) => a.name !== name));
    setRawFiles((prev) => prev.filter((f) => f.name !== name));
  }, []);

  /* ---- Sessions ---- */
  const handleNewSession = useCallback(() => {
    setActiveSessionId(null);
    resetChat();
    setInput("");
    setAttachments([]);
  }, [resetChat]);

  return (
    <div className="flex flex-1 min-h-0 bg-[var(--slate-50)]">
      {/* ===== LEFT — Sessions sidebar ===== */}
      <aside className="w-[280px] shrink-0 bg-white border-r border-[var(--slate-200)] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--slate-200)]">
          <div className="flex items-center gap-2">
            <Bot size={16} className="text-emerald-500" />
            <span className="text-sm font-semibold text-[var(--slate-800)]">
              Beszélgetések
            </span>
          </div>
          <button
            onClick={handleNewSession}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-[var(--slate-500)] hover:bg-[var(--slate-100)] hover:text-[var(--slate-800)] transition-colors cursor-pointer"
            title="Új beszélgetés"
          >
            <Plus size={14} />
            Új
          </button>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {PLACEHOLDER_SESSIONS.map((session) => (
            <button
              key={session.id}
              onClick={() => setActiveSessionId(session.id)}
              className={`w-full text-left px-3 py-[10px] rounded-lg transition-colors cursor-pointer ${
                activeSessionId === session.id
                  ? "bg-emerald-50 border border-emerald-200"
                  : "hover:bg-[var(--slate-50)] border border-transparent"
              }`}
            >
              <div className="flex items-center gap-2 mb-[2px]">
                <MessageSquare
                  size={12}
                  className={
                    activeSessionId === session.id
                      ? "text-emerald-500"
                      : "text-[var(--slate-400)]"
                  }
                />
                <span className="text-[13px] font-medium text-[var(--slate-800)] truncate">
                  {session.title}
                </span>
                <span className="text-[10px] text-[var(--slate-400)] ml-auto shrink-0">
                  {session.date}
                </span>
              </div>
              <p className="text-[11px] text-[var(--slate-400)] truncate pl-5">
                {session.lastMessage}
              </p>
            </button>
          ))}
        </div>
      </aside>

      {/* ===== RIGHT — Chat area ===== */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Chat header */}
        <div className="flex items-center gap-3 px-5 py-3 bg-white border-b border-[var(--slate-200)] shrink-0">
          <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
            <Sparkles size={16} className="text-emerald-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--slate-800)]">
              ERP AI Asszisztens
            </p>
            <p className="text-[11px] text-[var(--slate-400)]">
              Bedrock Agent &middot; Mindig elérhető
            </p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}
            >
              {msg.role === "assistant" && (
                <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 mt-[2px]">
                  <Bot size={14} className="text-emerald-600" />
                </div>
              )}

              <div
                className={`max-w-[70%] rounded-xl px-4 py-[10px] ${
                  msg.role === "user"
                    ? "bg-[var(--indigo-600)] text-white"
                    : "bg-white border border-[var(--slate-200)] text-[var(--slate-700)]"
                }`}
              >
                {/* Thinking steps (collapsible) */}
                {msg.role === "assistant" &&
                  msg.thinkingSteps &&
                  msg.thinkingSteps.length > 0 && (
                    <ThinkingPanel steps={msg.thinkingSteps} />
                  )}

                {msg.role === "assistant" ? (
                  <div className="text-[13px] leading-relaxed prose prose-sm prose-slate max-w-none prose-p:my-1 prose-headings:font-semibold prose-headings:text-[var(--slate-800)] prose-code:bg-[var(--slate-100)] prose-code:px-1 prose-code:rounded prose-pre:bg-[var(--slate-100)] prose-pre:text-[var(--slate-800)] prose-a:text-emerald-600 prose-a:no-underline hover:prose-a:underline prose-ul:my-1 prose-ol:my-1 prose-li:my-0">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-[13px] leading-relaxed whitespace-pre-wrap">
                    {msg.content}
                  </p>
                )}

                {/* Linked content entities */}
                {msg.role === "assistant" &&
                  msg.linkedContents &&
                  msg.linkedContents.length > 0 && (
                    <LinkedContentPanel items={msg.linkedContents} />
                  )}

                {/* Proposed actions for approval */}
                {msg.role === "assistant" &&
                  msg.proposedActions &&
                  msg.proposedActions.length > 0 && (
                    <ProposedActionsPanel
                      actions={msg.proposedActions}
                      messageId={msg.id}
                    />
                  )}

                {/* Attachments */}
                {msg.attachments && msg.attachments.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {msg.attachments.map((att) => (
                      <div
                        key={att.name}
                        className={`flex items-center gap-2 text-[11px] px-2 py-1 rounded-md ${
                          msg.role === "user"
                            ? "bg-white/15 text-white/90"
                            : "bg-[var(--slate-50)] text-[var(--slate-500)]"
                        }`}
                      >
                        <FileIcon size={12} />
                        <span className="truncate">{att.name}</span>
                        <span className="shrink-0 opacity-70">
                          {formatFileSize(att.size)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <p
                  className={`text-[10px] mt-1 ${
                    msg.role === "user" ? "text-white/50" : "text-[var(--slate-300)]"
                  }`}
                >
                  {msg.timestamp.toLocaleTimeString("hu-HU", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>

              {msg.role === "user" && (
                <div className="w-7 h-7 rounded-full bg-[var(--indigo-100)] flex items-center justify-center shrink-0 mt-[2px]">
                  <User size={14} className="text-[var(--indigo-600)]" />
                </div>
              )}
            </div>
          ))}

          {/* Typing indicator */}
          {isTyping && (
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                <Bot size={14} className="text-emerald-600" />
              </div>
              <div className="bg-white border border-[var(--slate-200)] rounded-xl px-4 py-3">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-[var(--slate-300)] rounded-full animate-bounce [animation-delay:0ms]" />
                  <span className="w-2 h-2 bg-[var(--slate-300)] rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-2 h-2 bg-[var(--slate-300)] rounded-full animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Attachment preview bar */}
        {attachments.length > 0 && (
          <div className="px-5 py-2 bg-white border-t border-[var(--slate-100)] flex gap-2 flex-wrap">
            {attachments.map((att) => (
              <div
                key={att.name}
                className="flex items-center gap-[6px] bg-[var(--slate-50)] border border-[var(--slate-200)] rounded-md px-2 py-1 text-[11px] text-[var(--slate-600)]"
              >
                <FileIcon size={12} />
                <span className="max-w-[120px] truncate">{att.name}</span>
                <span className="text-[var(--slate-400)]">
                  {formatFileSize(att.size)}
                </span>
                <button
                  onClick={() => removeAttachment(att.name)}
                  className="text-[var(--slate-400)] hover:text-red-500 cursor-pointer"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input area */}
        <div className="px-5 py-3 bg-white border-t border-[var(--slate-200)] shrink-0">
          <div className="flex items-end gap-2 bg-[var(--slate-50)] border border-[var(--slate-200)] rounded-xl px-3 py-2 focus-within:border-emerald-400 transition-colors">
            <button
              onClick={handleFileSelect}
              className="flex items-center justify-center w-8 h-8 rounded-lg text-[var(--slate-400)] hover:text-emerald-600 hover:bg-emerald-50 transition-colors cursor-pointer shrink-0"
              title="Fájl csatolása"
            >
              <Paperclip size={16} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileChange}
              className="hidden"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg"
            />
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Írjon üzenetet az AI asszisztensnek..."
              rows={1}
              className="flex-1 resize-none bg-transparent text-[13px] text-[var(--slate-800)] placeholder:text-[var(--slate-400)] outline-none py-[6px] max-h-[120px] overflow-y-auto"
            />
            <button
              onClick={isTyping ? handleStop : handleSend}
              disabled={!isTyping && !input.trim() && attachments.length === 0}
              className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors cursor-pointer shrink-0 ${
                isTyping
                  ? "bg-red-500 text-white hover:bg-red-600"
                  : "bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed"
              }`}
              title={isTyping ? "Generálás leállítása" : "Küldés"}
            >
              {isTyping ? <Square size={14} /> : <Send size={14} />}
            </button>
          </div>
          <p className="text-[10px] text-[var(--slate-400)] mt-[6px] text-center">
            Az AI válaszok tájékoztató jellegűek. Kérjük, ellenőrizze a fontos adatokat.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ThinkingPanel — collapsible agent reasoning steps                  */
/* ------------------------------------------------------------------ */

const STEP_CONFIG: Record<
  ThinkingStep["type"],
  { icon: typeof Brain; label: string; color: string }
> = {
  rationale: { icon: Brain, label: "Gondolkodás", color: "text-purple-500" },
  modelInput: { icon: Brain, label: "LLM prompt", color: "text-blue-500" },
  toolCall: { icon: Wrench, label: "Eszköz hívás", color: "text-amber-500" },
  observation: { icon: Eye, label: "Eredmény", color: "text-emerald-500" },
  preProcessing: { icon: Brain, label: "Előfeldolgozás", color: "text-cyan-500" },
  postProcessing: { icon: Brain, label: "Utófeldolgozás", color: "text-cyan-500" },
  failure: { icon: AlertTriangle, label: "Hiba", color: "text-red-500" },
};

function ThinkingPanel({ steps }: { steps: ThinkingStep[] }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mb-2">
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="flex items-center gap-[6px] text-[11px] text-[var(--slate-400)] hover:text-[var(--slate-600)] transition-colors cursor-pointer py-1"
      >
        {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Brain size={12} className="text-purple-400" />
        <span>
          Gondolkodás{" "}
          <span className="text-[var(--slate-300)]">
            ({steps.length} lépés)
          </span>
        </span>
      </button>

      {isOpen && (
        <div className="ml-1 pl-3 border-l-2 border-purple-100 space-y-[6px] mt-1 mb-2">
          {steps.map((step, i) => {
            const cfg = STEP_CONFIG[step.type] ?? STEP_CONFIG.rationale;
            const Icon = cfg.icon;
            return (
              <div key={i} className="text-[11px]">
                <div className="flex items-center gap-[5px] mb-[2px]">
                  <Icon size={11} className={cfg.color} />
                  <span className="font-medium text-[var(--slate-500)]">
                    {cfg.label}
                  </span>
                  {step.type === "toolCall" && step.actionGroup && (
                    <span className="px-[5px] py-[1px] rounded bg-amber-50 text-amber-700 text-[10px]">
                      {step.actionGroup}
                      {step.apiPath ? ` → ${step.apiPath}` : ""}
                      {step.function ? ` → ${step.function}` : ""}
                    </span>
                  )}
                  {step.type === "toolCall" && step.knowledgeBase && (
                    <span className="px-[5px] py-[1px] rounded bg-emerald-50 text-emerald-700 text-[10px]">
                      KB: {step.knowledgeBase}
                    </span>
                  )}
                </div>
                {step.text && (
                  <p className="text-[var(--slate-400)] leading-relaxed whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto">
                    {step.text}
                  </p>
                )}
                {step.query && (
                  <p className="text-[var(--slate-400)] italic">
                    Keresés: {step.query}
                  </p>
                )}
                {step.type === "preProcessing" && step.rationale && (
                  <p className="text-[var(--slate-400)]">
                    {step.isValid ? "✓" : "✗"} {step.rationale}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  LinkedContentPanel — collapsible list of linked entities           */
/* ------------------------------------------------------------------ */

function LinkedContentPanel({ items }: { items: LinkedContent[] }) {
  const [isOpen, setIsOpen] = useState(true);
  const [names, setNames] = useState<Record<string, string>>({});
  const openTab = useTabStore((s) => s.openTab);

  // Fetch entity names on mount / when items change
  useEffect(() => {
    resolveEntityNames(items).then((resolved) => {
      const map: Record<string, string> = {};
      for (const r of resolved) {
        if (r.name) {
          map[`${r.entityType}-${r.entityId}`] = r.name;
        }
      }
      setNames(map);
    });
  }, [items]);

  const handleOpen = (item: LinkedContent) => {
    const moduleKey = ENTITY_MODULE_MAP[item.entityType] ?? item.entityType;
    const moduleDef = MODULE_REGISTRY.find((m) => m.key === moduleKey);
    const displayName = names[`${item.entityType}-${item.entityId}`];
    const label = ENTITY_LABELS[item.entityType] ?? item.entityType;
    const title = displayName ?? `${label} #${item.entityId}`;

    openTab({
      moduleKey: `${moduleKey}-form`,
      title,
      color: moduleDef?.color ?? "#6b7280",
      tabType: "view",
      params: { id: item.entityId },
    });
  };

  return (
    <div className="mt-3 rounded-lg border border-[var(--slate-200)] bg-[var(--slate-50)] overflow-hidden">
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-[var(--slate-100)] transition-colors cursor-pointer"
      >
        {isOpen ? <ChevronDown size={12} className="text-[var(--slate-400)]" /> : <ChevronRight size={12} className="text-[var(--slate-400)]" />}
        <Link2 size={12} className="text-blue-500" />
        <span className="text-[11px] font-semibold text-[var(--slate-600)]">
          Kapcsolódó elemek
          <span className="text-[var(--slate-400)] font-normal ml-1">
            ({items.length})
          </span>
        </span>
      </button>

      {isOpen && (
        <div className="px-3 pb-2 space-y-1">
          {items.map((item, i) => {
            const label = ENTITY_LABELS[item.entityType] ?? item.entityType;
            const displayName = names[`${item.entityType}-${item.entityId}`];
            return (
              <button
                key={`${item.entityType}-${item.entityId}-${i}`}
                onClick={() => handleOpen(item)}
                className="flex items-center gap-2 w-full px-2 py-[6px] rounded-md bg-white border border-[var(--slate-200)] hover:border-blue-300 hover:bg-blue-50 transition-colors cursor-pointer group"
              >
                <span className="text-[10px] font-medium text-[var(--slate-400)] group-hover:text-blue-500 shrink-0">
                  {label}
                </span>
                <span className="text-[11px] font-medium text-[var(--slate-700)] group-hover:text-blue-700 truncate">
                  {displayName ?? `#${item.entityId}`}
                </span>
                <span className="text-[10px] text-[var(--slate-400)] group-hover:text-blue-400 shrink-0">
                  #{item.entityId}
                </span>
                <ExternalLink size={10} className="ml-auto text-[var(--slate-300)] group-hover:text-blue-400 shrink-0" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ProposedActionsPanel — actions waiting for user approval           */
/* ------------------------------------------------------------------ */

type ActionStatus = "pending" | "accepted" | "rejected" | "executing" | "done" | "error";

function ProposedActionsPanel({
  actions,
  messageId,
}: {
  actions: ProposedAction[];
  messageId: string;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const [statuses, setStatuses] = useState<Record<number, ActionStatus>>(() => {
    const init: Record<number, ActionStatus> = {};
    actions.forEach((_, i) => { init[i] = "pending"; });
    return init;
  });
  const [errors, setErrors] = useState<Record<number, string>>({});

  const handleAccept = async (index: number) => {
    const action = actions[index];
    if (!action) return;

    setStatuses((prev) => ({ ...prev, [index]: "executing" }));
    try {
      const result = await executeProposedAction(
        action.actionType,
        action.entityType,
        action.entityId,
        action.payload,
      );
      if (result.success) {
        setStatuses((prev) => ({ ...prev, [index]: "done" }));
      } else {
        setStatuses((prev) => ({ ...prev, [index]: "error" }));
        setErrors((prev) => ({ ...prev, [index]: result.error ?? "Ismeretlen hiba" }));
      }
    } catch {
      setStatuses((prev) => ({ ...prev, [index]: "error" }));
      setErrors((prev) => ({ ...prev, [index]: "Hálózati hiba történt" }));
    }
  };

  const handleReject = (index: number) => {
    setStatuses((prev) => ({ ...prev, [index]: "rejected" }));
  };

  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/50 overflow-hidden">
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-amber-100/50 transition-colors cursor-pointer"
      >
        {isOpen ? <ChevronDown size={12} className="text-amber-500" /> : <ChevronRight size={12} className="text-amber-500" />}
        <ClipboardCheck size={12} className="text-amber-600" />
        <span className="text-[11px] font-semibold text-amber-800">
          Jóváhagyandó módosítások
          <span className="text-amber-500 font-normal ml-1">
            ({actions.length})
          </span>
        </span>
      </button>

      {isOpen && (
        <div className="px-3 pb-2 space-y-2">
          {actions.map((action, i) => {
            const status = statuses[i] ?? "pending";
            const entityLabel = ENTITY_LABELS[action.entityType] ?? action.entityType;
            const actionLabel = ACTION_TYPE_LABELS[action.actionType] ?? action.actionType;

            return (
              <div
                key={`action-${messageId}-${i}`}
                className={`rounded-md border bg-white px-3 py-2 ${
                  status === "done"
                    ? "border-emerald-200 bg-emerald-50/50"
                    : status === "rejected"
                      ? "border-[var(--slate-200)] bg-[var(--slate-50)] opacity-60"
                      : status === "error"
                        ? "border-red-200 bg-red-50/50"
                        : "border-amber-200"
                }`}
              >
                {/* Header */}
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] font-semibold px-[6px] py-[1px] rounded ${
                    action.actionType === "create"
                      ? "bg-emerald-100 text-emerald-700"
                      : action.actionType === "modify"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-red-100 text-red-700"
                  }`}>
                    {actionLabel}
                  </span>
                  <span className="text-[11px] font-medium text-[var(--slate-700)]">
                    {entityLabel}
                    {action.entityId != null && (
                      <span className="text-[var(--slate-400)] ml-1">#{action.entityId}</span>
                    )}
                  </span>
                </div>

                {/* Description */}
                {action.description && (
                  <p className="text-[11px] text-[var(--slate-500)] mb-1">
                    {action.description}
                  </p>
                )}

                {/* Payload summary */}
                {action.actionType !== "delete" && Object.keys(action.payload).length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {Object.entries(action.payload).map(([key, value]) => (
                      <span
                        key={key}
                        className="inline-flex items-center gap-1 text-[10px] bg-[var(--slate-100)] text-[var(--slate-600)] px-[6px] py-[2px] rounded"
                      >
                        <span className="font-medium">{key}:</span>
                        <span className="max-w-[120px] truncate">{String(value)}</span>
                      </span>
                    ))}
                  </div>
                )}

                {/* Action buttons / Status */}
                {status === "pending" && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleAccept(i)}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors cursor-pointer"
                    >
                      <Check size={11} />
                      Elfogadás
                    </button>
                    <button
                      onClick={() => handleReject(i)}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-[var(--slate-200)] text-[var(--slate-600)] hover:bg-[var(--slate-300)] transition-colors cursor-pointer"
                    >
                      <XCircle size={11} />
                      Elutasítás
                    </button>
                  </div>
                )}
                {status === "executing" && (
                  <div className="flex items-center gap-1 text-[11px] text-amber-600">
                    <Loader2 size={11} className="animate-spin" />
                    Végrehajtás...
                  </div>
                )}
                {status === "done" && (
                  <div className="flex items-center gap-1 text-[11px] text-emerald-600 font-medium">
                    <Check size={11} />
                    Végrehajtva
                  </div>
                )}
                {status === "rejected" && (
                  <div className="flex items-center gap-1 text-[11px] text-[var(--slate-400)]">
                    <XCircle size={11} />
                    Elutasítva
                  </div>
                )}
                {status === "error" && (
                  <div className="text-[11px] text-red-600">
                    <div className="flex items-center gap-1 font-medium">
                      <AlertTriangle size={11} />
                      Hiba történt
                    </div>
                    {errors[i] && (
                      <p className="text-[10px] mt-[2px]">{errors[i]}</p>
                    )}
                    <button
                      onClick={() => {
                        setStatuses((prev) => ({ ...prev, [i]: "pending" }));
                        setErrors((prev) => { const next = { ...prev }; delete next[i]; return next; });
                      }}
                      className="text-[10px] underline mt-1 cursor-pointer hover:text-red-700"
                    >
                      Újrapróbálás
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
