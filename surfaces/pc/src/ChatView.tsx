import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  type ChatMessage,
  getGatewayUrl,
  listModels,
  setGatewayUrl,
  streamChatCompletion,
} from "./gateway";
import "./ChatView.css";

interface DisplayMessage extends ChatMessage {
  id: string;
  pending?: boolean;
}

interface SessionInfo {
  id: string;
  view: string;
  title: string;
  updated_at: number;
}

const FALLBACK_MODELS = ["chat-default", "chat-fast", "chat-batch"];
const MEMORY_MARKER = /\[MEMORY:(user|feedback|project|reference)\]\s*(.+)/i;

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function ChatView() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [models, setModels] = useState<string[]>(FALLBACK_MODELS);
  const [model, setModel] = useState(FALLBACK_MODELS[1]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [gatewayUrlInput, setGatewayUrlInput] = useState(getGatewayUrl());

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  function refreshSessions() {
    invoke<SessionInfo[]>("list_sessions", { view: "chat" }).then(setSessions).catch(() => undefined);
  }

  useEffect(() => {
    refreshSessions();
    listModels()
      .then((list) => {
        if (list.length > 0) {
          const ids = list.map((m) => m.id);
          setModels(ids);
          if (!ids.includes(model)) setModel(ids[0]);
        }
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function loadSession(id: string) {
    const rows = await invoke<{ role: string; content: string }[]>("get_session_messages", {
      sessionId: id,
    });
    setMessages(rows.map((r) => ({ id: newId(), role: r.role as DisplayMessage["role"], content: r.content })));
    setSessionId(id);
  }

  function startNewSession() {
    setSessionId(null);
    setMessages([]);
  }

  async function deleteSession(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await invoke("delete_session", { sessionId: id }).catch(() => undefined);
    if (sessionId === id) startNewSession();
    refreshSessions();
  }

  async function ensureSession(firstMessage: string): Promise<string> {
    if (sessionId) return sessionId;
    const title = firstMessage.slice(0, 60);
    const id = await invoke<string>("create_session", { view: "chat", title });
    setSessionId(id);
    refreshSessions();
    return id;
  }

  /** Detects a trailing [MEMORY:category] marker in a completed response, saves it, and
   *  returns the text with that line stripped so it isn't shown to the user verbatim. */
  async function extractAndSaveMemory(text: string): Promise<string> {
    const match = text.match(MEMORY_MARKER);
    if (!match) return text;
    const [full, category, content] = match;
    await invoke("add_memory", { category, content: content.trim() }).catch(() => undefined);
    return text.replace(full, "").trimEnd();
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || isStreaming) return;

    setError(null);
    setInput("");

    const sid = await ensureSession(text);
    await invoke("append_message", { sessionId: sid, role: "user", content: text }).catch(() => undefined);

    const userMsg: DisplayMessage = { id: newId(), role: "user", content: text };
    const assistantId = newId();
    const history = [...messages, userMsg];
    setMessages([...history, { id: assistantId, role: "assistant", content: "", pending: true }]);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const memoryContext = await invoke<string>("get_memory_context").catch(() => "");
      const systemPrelude: ChatMessage[] = memoryContext
        ? [
            {
              role: "system",
              content:
                `${memoryContext}\nIf you learn something about the user or this project worth ` +
                `remembering for future conversations, end your reply with one line formatted ` +
                `exactly as: [MEMORY:category] the fact to remember - where category is one of ` +
                `user, feedback, project, reference. Only do this when something is genuinely ` +
                `worth persisting, not on every message.`,
            },
          ]
        : [];

      await streamChatCompletion(
        model,
        [...systemPrelude, ...history.map(({ role, content }) => ({ role, content }))],
        (delta) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m)),
          );
        },
        controller.signal,
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      let finalContent = "";
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== assistantId) return m;
          finalContent = m.content;
          return { ...m, pending: false };
        }),
      );
      setIsStreaming(false);
      abortRef.current = null;

      if (finalContent) {
        const stripped = await extractAndSaveMemory(finalContent);
        if (stripped !== finalContent) {
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: stripped } : m)));
        }
        await invoke("append_message", { sessionId: sid, role: "assistant", content: stripped }).catch(
          () => undefined,
        );
        refreshSessions();
      }
    }
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function saveSettings() {
    setGatewayUrl(gatewayUrlInput);
    setShowSettings(false);
    setError(null);
    listModels()
      .then((list) => {
        if (list.length > 0) setModels(list.map((m) => m.id));
      })
      .catch(() => undefined);
  }

  return (
    <div className="chat-layout">
      <aside className="session-sidebar">
        <button type="button" className="new-session-button" onClick={startNewSession}>
          + New chat
        </button>
        <div className="session-list">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`session-item ${s.id === sessionId ? "active" : ""}`}
              onClick={() => loadSession(s.id)}
            >
              <span className="session-title">{s.title || "Untitled"}</span>
              <button
                type="button"
                className="session-delete"
                onClick={(e) => deleteSession(s.id, e)}
                title="Delete"
              >
                ✕
              </button>
            </div>
          ))}
          {sessions.length === 0 && <div className="session-empty">No past chats yet</div>}
        </div>
      </aside>

      <div className="chat-view">
        <div className="chat-toolbar">
          <select
            className="model-select"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={isStreaming}
          >
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <button
            className="icon-button"
            onClick={() => setShowSettings((s) => !s)}
            title="Gateway settings"
            type="button"
          >
            ⚙
          </button>
        </div>

        {showSettings && (
          <div className="settings-panel">
            <label htmlFor="gateway-url">Gateway URL</label>
            <input
              id="gateway-url"
              type="text"
              value={gatewayUrlInput}
              onChange={(e) => setGatewayUrlInput(e.target.value)}
              placeholder="http://192.168.1.40:4000/v1"
            />
            <button type="button" onClick={saveSettings}>
              Save
            </button>
          </div>
        )}

        <div className="messages" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="empty-state">
              <p>Start a conversation.</p>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`message message-${m.role}`}>
              <div className="message-role">{m.role === "user" ? "You" : model}</div>
              <div className="message-content">
                {m.content}
                {m.pending && m.content === "" && <span className="cursor">●</span>}
              </div>
            </div>
          ))}
        </div>

        {error && (
          <div className="error-banner">
            {error}
            <button type="button" onClick={() => setError(null)}>
              ✕
            </button>
          </div>
        )}

        <div className="composer">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message the AI..."
            rows={2}
          />
          {isStreaming ? (
            <button type="button" className="send-button stop" onClick={handleStop}>
              Stop
            </button>
          ) : (
            <button type="button" className="send-button" onClick={handleSend} disabled={!input.trim()}>
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
