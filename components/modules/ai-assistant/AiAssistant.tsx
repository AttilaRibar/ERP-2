"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Download,
  ExternalLink,
  FileIcon,
  Globe2,
  Link2,
  Loader2,
  MessageSquare,
  Paperclip,
  Pencil,
  Plus,
  Send,
  Sparkles,
  Square,
  Trash2,
  User,
  X,
  XCircle,
} from "lucide-react";
import { useTabStore } from "@/stores/tab-store";
import {
  dtoToChatMessage,
  useAiChatStore,
  type ChatMessage,
  type FileAttachment,
  type LinkedContent,
  type ProposedAction,
} from "@/stores/ai-chat-store";
import { executeProposedAction, resolveEntityNames } from "@/server/actions/ai-actions";
import {
  deleteAiChatSessionAction,
  getAiChatSessionAction,
  listAiChatSessionsAction,
  renameAiChatSessionAction,
  updateAiChatSessionSettingsAction,
} from "@/server/actions/ai-chat-sessions";
import { MODULE_REGISTRY } from "@/lib/modules";
import type { AiChatMessageDto, AiChatSessionSummary } from "@/types/ai-chat";

interface AiApiResponse {
  error?: string;
  session?: AiChatSessionSummary | null;
  userMessage?: AiChatMessageDto;
  assistantMessage?: AiChatMessageDto;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_FILE_INPUT = ".txt,.md,.csv,.json,.xls,.xlsx,.xlsm,.pdf";
const ACCEPTED_EXTENSIONS = new Set(["txt", "md", "csv", "json", "xls", "xlsx", "xlsm", "pdf"]);

function newMsgId(): string {
  return crypto.randomUUID();
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "";
}

function isAcceptedFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  return ACCEPTED_EXTENSIONS.has(fileExtension(file.name));
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatRelativeDate(value: string): string {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "Ma";
  if (date.toDateString() === yesterday.toDateString()) return "Tegnap";
  return date.toLocaleDateString("hu-HU", { month: "short", day: "numeric" });
}

function attachmentStatusLabel(attachment: FileAttachment): string | null {
  if (!attachment.extractionStatus) return null;
  if (attachment.extractionStatus === "processed") return "feldolgozva";
  if (attachment.extractionStatus === "truncated") return "rövidítve";
  if (attachment.extractionStatus === "unsupported") return "nem olvasható";
  return "hiba";
}

const ENTITY_LABELS: Record<string, string> = {
  partner: "Partner",
  project: "Projekt",
  quote: "Ajánlat",
  budget: "Költségvetés",
  agent_proposal: "Agent javaslat",
};

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

export function AiAssistant() {
  const sessions = useAiChatStore((state) => state.sessions);
  const messages = useAiChatStore((state) => state.messages);
  const agentSessionId = useAiChatStore((state) => state.agentSessionId);
  const webSearchEnabled = useAiChatStore((state) => state.webSearchEnabled);
  const setSessions = useAiChatStore((state) => state.setSessions);
  const upsertSession = useAiChatStore((state) => state.upsertSession);
  const removeSession = useAiChatStore((state) => state.removeSession);
  const setActiveSession = useAiChatStore((state) => state.setActiveSession);
  const startNewSession = useAiChatStore((state) => state.startNewSession);
  const setWebSearchEnabled = useAiChatStore((state) => state.setWebSearchEnabled);
  const addMessage = useAiChatStore((state) => state.addMessage);
  const updateMessage = useAiChatStore((state) => state.updateMessage);

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [rawFiles, setRawFiles] = useState<File[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [typingStartedAt, setTypingStartedAt] = useState<number | null>(null);
  const [typingElapsedMs, setTypingElapsedMs] = useState(0);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadSessions() {
      setIsLoadingSessions(true);
      const result = await listAiChatSessionsAction();
      if (cancelled) return;

      if (result.success) {
        setSessions(result.data);
        setSessionError(null);
      } else {
        setSessionError(result.error);
      }
      setIsLoadingSessions(false);
    }

    loadSessions();
    return () => {
      cancelled = true;
    };
  }, [setSessions]);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, scrollToBottom]);

  // Drives the elapsed-seconds counter shown next to "Válasz készítése...".
  // Updates 5×/sec while a turn is in flight; cleared on completion/abort.
  useEffect(() => {
    if (typingStartedAt === null) {
      setTypingElapsedMs(0);
      return;
    }
    setTypingElapsedMs(Date.now() - typingStartedAt);
    const interval = window.setInterval(() => {
      setTypingElapsedMs(Date.now() - typingStartedAt);
    }, 200);
    return () => window.clearInterval(interval);
  }, [typingStartedAt]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsTyping(false);
    setTypingStartedAt(null);
  }, []);

  const handleNewSession = useCallback(() => {
    handleStop();
    startNewSession();
    setInput("");
    setAttachments([]);
    setRawFiles([]);
    setUploadError(null);
    setSessionError(null);
  }, [handleStop, startNewSession]);

  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      if (sessionId === agentSessionId) return;

      handleStop();
      setIsLoadingMessages(true);
      setSessionError(null);
      const result = await getAiChatSessionAction(sessionId);
      if (result.success) {
        setActiveSession({
          sessionId: result.data.session.id,
          messages: result.data.messages.map(dtoToChatMessage),
          webSearchEnabled: result.data.session.webSearchEnabled,
        });
        upsertSession(result.data.session);
        setAttachments([]);
        setRawFiles([]);
        setInput("");
      } else {
        setSessionError(result.error);
      }
      setIsLoadingMessages(false);
    },
    [agentSessionId, handleStop, setActiveSession, upsertSession],
  );

  const handleToggleWebSearch = useCallback(async () => {
    const nextValue = !webSearchEnabled;
    const persisted = sessions.some((session) => session.id === agentSessionId);
    setWebSearchEnabled(nextValue);

    if (!persisted) return;

    const result = await updateAiChatSessionSettingsAction(agentSessionId, {
      webSearchEnabled: nextValue,
    });
    if (result.success) {
      upsertSession(result.data);
      setSessionError(null);
    } else {
      setWebSearchEnabled(!nextValue);
      setSessionError(result.error);
    }
  }, [agentSessionId, sessions, setWebSearchEnabled, upsertSession, webSearchEnabled]);

  const handleDeleteSession = useCallback(
    async (sessionId: string, title: string) => {
      const confirmed = window.confirm(`Törli ezt a beszélgetést?\n\n${title}`);
      if (!confirmed) return;

      handleStop();
      const result = await deleteAiChatSessionAction(sessionId);
      if (result.success) {
        removeSession(sessionId);
        if (editingSessionId === sessionId) {
          setEditingSessionId(null);
          setEditingTitle("");
        }
        setSessionError(null);
      } else {
        setSessionError(result.error);
      }
    },
    [editingSessionId, handleStop, removeSession],
  );

  const handleStartRename = useCallback((session: AiChatSessionSummary) => {
    setEditingSessionId(session.id);
    setEditingTitle(session.title);
  }, []);

  const handleCancelRename = useCallback(() => {
    setEditingSessionId(null);
    setEditingTitle("");
  }, []);

  const handleRenameSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>, session: AiChatSessionSummary) => {
      event.preventDefault();
      const nextTitle = editingTitle.trim();
      if (!nextTitle || nextTitle === session.title) {
        handleCancelRename();
        return;
      }

      const result = await renameAiChatSessionAction(session.id, nextTitle);
      if (result.success) {
        upsertSession(result.data);
        handleCancelRename();
        setSessionError(null);
      } else {
        setSessionError(result.error);
      }
    },
    [editingTitle, handleCancelRename, upsertSession],
  );

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (isTyping || (!trimmed && attachments.length === 0)) return;

    let filesToSend: Array<{ name: string; mediaType: string; size: number; base64: string }> = [];
    try {
      filesToSend = await Promise.all(
        rawFiles.map(async (file) => ({
          name: file.name,
          mediaType: file.type || "application/octet-stream",
          size: file.size,
          base64: await fileToBase64(file),
        })),
      );
    } catch {
      setUploadError("A fájl beolvasása nem sikerült.");
      return;
    }

    const userMessageId = newMsgId();
    const userMsg: ChatMessage = {
      id: userMessageId,
      role: "user",
      content: trimmed,
      attachments: attachments.length > 0 ? [...attachments] : undefined,
      timestamp: new Date(),
    };

    addMessage(userMsg);

    setInput("");
    setAttachments([]);
    setRawFiles([]);
    setUploadError(null);
    setIsTyping(true);
    setTypingStartedAt(Date.now());
    scrollToBottom();

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          sessionId: agentSessionId,
          clientMessageId: userMessageId,
          webSearchEnabled,
          ...(filesToSend.length > 0 ? { files: filesToSend } : {}),
        }),
        signal: abortController.signal,
      });

      const payload = (await response.json().catch(() => ({}))) as AiApiResponse;

      if (payload.session) upsertSession(payload.session);
      if (payload.userMessage) updateMessage(userMessageId, dtoToChatMessage(payload.userMessage));
      if (payload.assistantMessage) {
        addMessage(dtoToChatMessage(payload.assistantMessage));
      }

      if (!response.ok) {
        if (!payload.assistantMessage) {
          addMessage({
            id: newMsgId(),
            role: "assistant",
            content: `Hiba történt az agent futtatása közben: ${payload.error ?? response.statusText}`,
            timestamp: new Date(),
          });
        }
        return;
      }

      if (!payload.assistantMessage) {
        addMessage({
          id: newMsgId(),
          role: "assistant",
          content: "Nem érkezett válasz az agenttől.",
          timestamp: new Date(),
        });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        addMessage({
          id: newMsgId(),
          role: "assistant",
          content: "A válasz megszakítva.",
          timestamp: new Date(),
        });
      } else {
        const message = error instanceof Error ? error.message : "Ismeretlen hiba";
        console.error("[AiAssistant] Agent request error:", message, error);
        addMessage({
          id: newMsgId(),
          role: "assistant",
          content: `Hiba történt az agent futtatása közben: ${message}`,
          timestamp: new Date(),
        });
      }
    } finally {
      abortRef.current = null;
      setIsTyping(false);
      setTypingStartedAt(null);
      scrollToBottom();
    }
  }, [
    addMessage,
    agentSessionId,
    attachments,
    input,
    isTyping,
    rawFiles,
    scrollToBottom,
    updateMessage,
    upsertSession,
    webSearchEnabled,
  ]);

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files;
    if (!selected) return;

    const acceptedFiles: File[] = [];
    const rejectedNames: string[] = [];

    for (const file of Array.from(selected)) {
      if (!isAcceptedFile(file)) {
        rejectedNames.push(file.name);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        rejectedNames.push(`${file.name} (${formatFileSize(file.size)})`);
        continue;
      }
      acceptedFiles.push(file);
    }

    if (rejectedNames.length > 0) {
      setUploadError(`Nem támogatott vagy túl nagy fájl: ${rejectedNames.join(", ")}`);
    } else {
      setUploadError(null);
    }

    setAttachments((current) => [
      ...current,
      ...acceptedFiles.map((file) => ({
        name: file.name,
        size: file.size,
        type: file.type || "application/octet-stream",
      })),
    ]);
    setRawFiles((current) => [...current, ...acceptedFiles]);
    event.target.value = "";
  }, []);

  const removeAttachment = useCallback((name: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.name !== name));
    setRawFiles((current) => current.filter((file) => file.name !== name));
  }, []);

  return (
    <div className="flex flex-1 min-h-0 bg-[var(--slate-50)]">
      <aside className="w-[280px] shrink-0 bg-white border-r border-[var(--slate-200)] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--slate-200)]">
          <div className="flex items-center gap-2 min-w-0">
            <Bot size={16} className="text-emerald-500 shrink-0" />
            <span className="text-sm font-semibold text-[var(--slate-800)] truncate">
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

        {sessionError && (
          <div className="mx-3 mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
            {sessionError}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {isLoadingSessions && (
            <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-[var(--slate-400)]">
              <Loader2 size={12} className="animate-spin" />
              Betöltés...
            </div>
          )}

          {!isLoadingSessions && sessions.length === 0 && (
            <div className="px-3 py-4 text-[12px] text-[var(--slate-400)]">
              Nincs mentett beszélgetés.
            </div>
          )}

          {sessions.map((session) => (
            <div
              key={session.id}
              className={`group flex items-start gap-1 rounded-lg border transition-colors ${
                agentSessionId === session.id
                  ? "bg-emerald-50 border-emerald-300 shadow-[inset_3px_0_0_var(--emerald-500)]"
                  : "border-transparent hover:bg-[var(--slate-50)]"
              }`}
            >
              {editingSessionId === session.id ? (
                <form
                  onSubmit={(event) => handleRenameSubmit(event, session)}
                  className="flex min-w-0 flex-1 items-center gap-1 px-2 py-2"
                >
                  <input
                    value={editingTitle}
                    onChange={(event) => setEditingTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") handleCancelRename();
                    }}
                    autoFocus
                    maxLength={80}
                    className="min-w-0 flex-1 rounded-md border border-emerald-300 bg-white px-2 py-1 text-[12px] text-[var(--slate-800)] outline-none focus:ring-2 focus:ring-emerald-100"
                    aria-label="Beszélgetés neve"
                  />
                  <button
                    type="submit"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-emerald-600 hover:bg-emerald-100 cursor-pointer"
                    title="Mentés"
                    aria-label="Név mentése"
                  >
                    <Check size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelRename}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--slate-400)] hover:bg-[var(--slate-100)] hover:text-[var(--slate-700)] cursor-pointer"
                    title="Mégse"
                    aria-label="Átnevezés megszakítása"
                  >
                    <X size={13} />
                  </button>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => handleSelectSession(session.id)}
                    className="min-w-0 flex-1 text-left px-3 py-[10px] cursor-pointer"
                  >
                    <div className="flex items-center gap-2 mb-[2px] min-w-0">
                      <MessageSquare
                        size={12}
                        className={agentSessionId === session.id ? "text-emerald-500" : "text-[var(--slate-400)]"}
                      />
                      <span className="text-[13px] font-medium text-[var(--slate-800)] truncate">
                        {session.title}
                      </span>
                      <span className="text-[10px] text-[var(--slate-400)] ml-auto shrink-0">
                        {formatRelativeDate(session.updatedAt)}
                      </span>
                    </div>
                    <p className="text-[11px] text-[var(--slate-400)] truncate pl-5">
                      {session.lastMessage || `${session.messageCount} üzenet`}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleStartRename(session)}
                    className={`mt-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--slate-300)] transition-opacity hover:bg-emerald-50 hover:text-emerald-600 focus:opacity-100 cursor-pointer ${
                      agentSessionId === session.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    }`}
                    title="Beszélgetés átnevezése"
                    aria-label={`Beszélgetés átnevezése: ${session.title}`}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteSession(session.id, session.title)}
                    className={`mr-2 mt-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--slate-300)] transition-opacity hover:bg-red-50 hover:text-red-600 focus:opacity-100 cursor-pointer ${
                      agentSessionId === session.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    }`}
                    title="Beszélgetés törlése"
                    aria-label={`Beszélgetés törlése: ${session.title}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-3 px-5 py-3 bg-white border-b border-[var(--slate-200)] shrink-0">
          <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
            <Sparkles size={16} className="text-emerald-600" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--slate-800)] truncate">
              ERP AI Asszisztens
            </p>
            <p className="text-[11px] text-[var(--slate-400)] truncate">
              LangChain + OpenRouter · Mentett beszélgetések
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={webSearchEnabled}
            onClick={handleToggleWebSearch}
            className={`ml-auto inline-flex items-center gap-2 h-8 px-3 rounded-md border text-[12px] font-medium transition-colors cursor-pointer ${
              webSearchEnabled
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : "border-[var(--slate-200)] bg-white text-[var(--slate-500)] hover:bg-[var(--slate-50)]"
            }`}
            title={webSearchEnabled ? "Internetes keresés bekapcsolva" : "Internetes keresés kikapcsolva"}
          >
            <Globe2 size={14} />
            Internet
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {isLoadingMessages && (
            <div className="flex items-center gap-2 text-[12px] text-[var(--slate-400)]">
              <Loader2 size={13} className="animate-spin" />
              Beszélgetés betöltése...
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}>
              {msg.role === "assistant" && (
                <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 mt-[2px]">
                  <Bot size={14} className="text-emerald-600" />
                </div>
              )}

              <div
                className={`max-w-[72%] rounded-xl px-4 py-[10px] ${
                  msg.role === "user"
                    ? "bg-[var(--indigo-600)] text-white"
                    : "bg-white border border-[var(--slate-200)] text-[var(--slate-700)]"
                }`}
              >
                {msg.role === "assistant" ? (
                  <div className="text-[13px] leading-relaxed prose prose-sm prose-slate max-w-none prose-p:my-1 prose-headings:font-semibold prose-headings:text-[var(--slate-800)] prose-code:bg-[var(--slate-100)] prose-code:px-1 prose-code:rounded prose-pre:bg-[var(--slate-100)] prose-pre:text-[var(--slate-800)] prose-a:text-emerald-600 prose-a:no-underline hover:prose-a:underline prose-ul:my-1 prose-ol:my-1 prose-li:my-0">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.content || (isTyping ? "..." : "")}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-[13px] leading-relaxed whitespace-pre-wrap">
                    {msg.content || "Csatolmány elküldve."}
                  </p>
                )}

                {msg.role === "assistant" && msg.linkedContents && msg.linkedContents.length > 0 && (
                  <LinkedContentPanel items={msg.linkedContents} />
                )}

                {msg.role === "assistant" && msg.proposedActions && msg.proposedActions.length > 0 && (
                  <ProposedActionsPanel actions={msg.proposedActions} messageId={msg.id} />
                )}

                {msg.attachments && msg.attachments.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {msg.attachments.map((attachment) => {
                      const status = attachmentStatusLabel(attachment);
                      const isDownloadable =
                        msg.role === "assistant" && Boolean(attachment.downloadId);
                      const className = `flex items-center gap-2 text-[11px] px-2 py-1 rounded-md ${
                        msg.role === "user"
                          ? "bg-white/15 text-white/90"
                          : isDownloadable
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors cursor-pointer"
                            : "bg-[var(--slate-50)] text-[var(--slate-500)]"
                      }`;
                      const content = (
                        <>
                          {isDownloadable ? (
                            <Download size={12} className="shrink-0" />
                          ) : (
                            <FileIcon size={12} />
                          )}
                          <span className="truncate">{attachment.name}</span>
                          <span className="shrink-0 opacity-70">{formatFileSize(attachment.size)}</span>
                          {status && <span className="shrink-0 opacity-70">{status}</span>}
                          {isDownloadable && (
                            <span className="shrink-0 ml-auto font-medium text-emerald-600">
                              Letöltés
                            </span>
                          )}
                        </>
                      );
                      const key = `${msg.id}-${attachment.name}`;
                      if (isDownloadable) {
                        return (
                          <a
                            key={key}
                            href={`/api/ai/files/${encodeURIComponent(attachment.downloadId!)}`}
                            download={attachment.name}
                            className={className}
                          >
                            {content}
                          </a>
                        );
                      }
                      return (
                        <div key={key} className={className}>
                          {content}
                        </div>
                      );
                    })}
                  </div>
                )}

                <p className={`text-[10px] mt-1 ${msg.role === "user" ? "text-white/50" : "text-[var(--slate-300)]"}`}>
                  {msg.timestamp.toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>

              {msg.role === "user" && (
                <div className="w-7 h-7 rounded-full bg-[var(--indigo-100)] flex items-center justify-center shrink-0 mt-[2px]">
                  <User size={14} className="text-[var(--indigo-600)]" />
                </div>
              )}
            </div>
          ))}

          {isTyping && (
            <div className="flex items-center gap-2 text-[12px] text-[var(--slate-400)]">
              <Loader2 size={13} className="animate-spin" />
              Válasz készítése... <span className="tabular-nums opacity-80">{(typingElapsedMs / 1000).toFixed(1)}s</span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {(attachments.length > 0 || uploadError) && (
          <div className="px-5 py-2 bg-white border-t border-[var(--slate-100)] flex gap-2 flex-wrap">
            {uploadError && (
              <div className="flex items-center gap-2 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-1">
                <AlertTriangle size={12} />
                {uploadError}
              </div>
            )}
            {attachments.map((attachment) => (
              <div
                key={attachment.name}
                className="flex items-center gap-[6px] bg-[var(--slate-50)] border border-[var(--slate-200)] rounded-md px-2 py-1 text-[11px] text-[var(--slate-600)]"
              >
                <FileIcon size={12} />
                <span className="max-w-[140px] truncate">{attachment.name}</span>
                <span className="text-[var(--slate-400)]">{formatFileSize(attachment.size)}</span>
                <button
                  onClick={() => removeAttachment(attachment.name)}
                  className="text-[var(--slate-400)] hover:text-red-500 cursor-pointer"
                  title="Csatolmány eltávolítása"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="px-5 py-3 bg-white border-t border-[var(--slate-200)] shrink-0">
          <div className="flex items-end gap-2 bg-[var(--slate-50)] border border-[var(--slate-200)] rounded-xl px-3 py-2 focus-within:border-emerald-400 transition-colors">
            <button
              onClick={handleFileSelect}
              disabled={isTyping}
              className="flex items-center justify-center w-8 h-8 rounded-lg text-[var(--slate-400)] hover:text-emerald-600 hover:bg-emerald-50 transition-colors cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
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
              accept={ACCEPTED_FILE_INPUT}
            />
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
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

function LinkedContentPanel({ items }: { items: LinkedContent[] }) {
  const [isOpen, setIsOpen] = useState(true);
  const [names, setNames] = useState<Record<string, string>>({});
  const openTab = useTabStore((state) => state.openTab);

  useEffect(() => {
    resolveEntityNames(items).then((resolved) => {
      const map: Record<string, string> = {};
      for (const item of resolved) {
        if (item.name) map[`${item.entityType}-${item.entityId}`] = item.name;
      }
      setNames(map);
    });
  }, [items]);

  const handleOpen = (item: LinkedContent) => {
    const moduleKey = ENTITY_MODULE_MAP[item.entityType] ?? item.entityType;
    const moduleDef = MODULE_REGISTRY.find((moduleItem) => moduleItem.key === moduleKey);
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
        onClick={() => setIsOpen((value) => !value)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-[var(--slate-100)] transition-colors cursor-pointer"
      >
        {isOpen ? <ChevronDown size={12} className="text-[var(--slate-400)]" /> : <ChevronRight size={12} className="text-[var(--slate-400)]" />}
        <Link2 size={12} className="text-blue-500" />
        <span className="text-[11px] font-semibold text-[var(--slate-600)]">
          Kapcsolódó elemek
          <span className="text-[var(--slate-400)] font-normal ml-1">({items.length})</span>
        </span>
      </button>

      {isOpen && (
        <div className="px-3 pb-2 space-y-1">
          {items.map((item, index) => {
            const label = ENTITY_LABELS[item.entityType] ?? item.entityType;
            const displayName = names[`${item.entityType}-${item.entityId}`];
            return (
              <button
                key={`${item.entityType}-${item.entityId}-${index}`}
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

type ActionStatus = "pending" | "rejected" | "executing" | "done" | "error";

function ProposedActionsPanel({
  actions,
  messageId,
}: {
  actions: ProposedAction[];
  messageId: string;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const [statuses, setStatuses] = useState<Record<number, ActionStatus>>(() => {
    const initial: Record<number, ActionStatus> = {};
    actions.forEach((_, index) => {
      initial[index] = "pending";
    });
    return initial;
  });
  const [errors, setErrors] = useState<Record<number, string>>({});

  const handleAccept = async (index: number) => {
    const action = actions[index];
    if (!action) return;

    setStatuses((current) => ({ ...current, [index]: "executing" }));
    try {
      const result = await executeProposedAction(
        action.actionType,
        action.entityType,
        action.entityId,
        action.payload,
      );
      if (result.success) {
        setStatuses((current) => ({ ...current, [index]: "done" }));
      } else {
        setStatuses((current) => ({ ...current, [index]: "error" }));
        setErrors((current) => ({ ...current, [index]: result.error ?? "Ismeretlen hiba" }));
      }
    } catch {
      setStatuses((current) => ({ ...current, [index]: "error" }));
      setErrors((current) => ({ ...current, [index]: "Hálózati hiba történt" }));
    }
  };

  const handleReject = (index: number) => {
    setStatuses((current) => ({ ...current, [index]: "rejected" }));
  };

  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/50 overflow-hidden">
      <button
        onClick={() => setIsOpen((value) => !value)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-amber-100/50 transition-colors cursor-pointer"
      >
        {isOpen ? <ChevronDown size={12} className="text-amber-500" /> : <ChevronRight size={12} className="text-amber-500" />}
        <ClipboardCheck size={12} className="text-amber-600" />
        <span className="text-[11px] font-semibold text-amber-800">
          Jóváhagyandó módosítások
          <span className="text-amber-500 font-normal ml-1">({actions.length})</span>
        </span>
      </button>

      {isOpen && (
        <div className="px-3 pb-2 space-y-2">
          {actions.map((action, index) => {
            const status = statuses[index] ?? "pending";
            const entityLabel = ENTITY_LABELS[action.entityType] ?? action.entityType;
            const actionLabel = ACTION_TYPE_LABELS[action.actionType] ?? action.actionType;

            return (
              <div
                key={`action-${messageId}-${index}`}
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
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] font-semibold px-[6px] py-[1px] rounded ${
                    action.actionType === "create"
                      ? "bg-emerald-100 text-emerald-700"
                      : action.actionType === "modify"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-red-100 text-red-700"
                  }`}
                  >
                    {actionLabel}
                  </span>
                  <span className="text-[11px] font-medium text-[var(--slate-700)]">
                    {entityLabel}
                    {action.entityId != null && (
                      <span className="text-[var(--slate-400)] ml-1">#{action.entityId}</span>
                    )}
                  </span>
                </div>

                {action.description && (
                  <p className="text-[11px] text-[var(--slate-500)] mb-1">{action.description}</p>
                )}

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

                {status === "pending" && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleAccept(index)}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors cursor-pointer"
                    >
                      <Check size={11} />
                      Elfogadás
                    </button>
                    <button
                      onClick={() => handleReject(index)}
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
                    {errors[index] && <p className="text-[10px] mt-[2px]">{errors[index]}</p>}
                    <button
                      onClick={() => {
                        setStatuses((current) => ({ ...current, [index]: "pending" }));
                        setErrors((current) => {
                          const next = { ...current };
                          delete next[index];
                          return next;
                        });
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
