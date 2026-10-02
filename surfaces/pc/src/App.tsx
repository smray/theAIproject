import { useEffect, useRef, useState } from "react";
import {
  type ChatMessage,
  getGatewayUrl,
  listModels,
  setGatewayUrl,
  streamChatCompletion,
} from "./gateway";
import "./App.css";

interface DisplayMessage extends ChatMessage {
  id: string;
  pending?: boolean;
}

const FALLBACK_MODELS = ["chat-default", "chat-fast", "chat-batch"];

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function App() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [models, setModels] = useState<string[]>(FALLBACK_MODELS);
  const [model, setModel] = useState(FALLBACK_MODELS[1]); // chat-fast by default
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [gatewayUrlInput, setGatewayUrlInput] = useState(getGatewayUrl());

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listModels()
      .then((list) => {
        if (list.length > 0) {
          const ids = list.map((m) => m.id);
          setModels(ids);
          if (!ids.includes(model)) setModel(ids[0]);
        }
      })
      .catch(() => {
        // Gateway unreachable at startup - keep the fallback list, surfaced on first send instead.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    const text = input.trim();
    if (!text || isStreaming) return;

    setError(null);
    setInput("");

    const userMsg: DisplayMessage = { id: newId(), role: "user", content: text };
    const assistantId = newId();
    const history = [...messages, userMsg];
    setMessages([...history, { id: assistantId, role: "assistant", content: "", pending: true }]);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamChatCompletion(
        model,
        history.map(({ role, content }) => ({ role, content })),
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
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, pending: false } : m)));
      setIsStreaming(false);
      abortRef.current = null;
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
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">The AI Project</h1>
        <div className="app-header-controls">
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
      </header>

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
  );
}
