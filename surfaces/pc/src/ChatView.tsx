import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  type ChatMessage,
  type GatewayTool,
  getGatewayUrl,
  listModels,
  runToolLoop,
  setGatewayUrl,
  streamChatCompletion,
} from "./gateway";
import "./ChatView.css";

interface DisplayMessage extends ChatMessage {
  id: string;
  pending?: boolean;
  status?: string;
}

interface SessionInfo {
  id: string;
  view: string;
  title: string;
  project_id: string | null;
  updated_at: number;
}

interface McpTool {
  server: string;
  name: string;
  description: string;
  input_schema: unknown;
}

interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
}

interface AgentInfo {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  mcp_servers: string[];
  use_research_tool: boolean;
}

interface ProjectInfo {
  id: string;
  name: string;
  instructions: string;
  created_at: number;
}

const RESEARCH_TOOL: GatewayTool = {
  type: "function",
  function: {
    name: "search_journal_articles",
    description:
      "Search CrossRef for real peer-reviewed journal articles on a topic, ranked by citation " +
      "count. Use this before answering factual or scientific questions so claims can be " +
      "grounded in actual literature rather than guessed.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search terms for the topic." },
        limit: { type: "number", description: "Max results to return (1-20)." },
      },
      required: ["query"],
    },
  },
};

interface Attachment {
  id: string;
  name: string;
  content: string;
  truncated: boolean;
}

const FALLBACK_MODELS = ["chat-default", "chat-fast", "chat-batch"];
const MEMORY_MARKER = /\[MEMORY:(user|feedback|project|reference)\]\s*(.+)/i;
// Plain text/code only, no Tauri fs/vision plumbing - dropped files are read with the browser's
// own File API (FileReader), so this needs no new capability permissions at all. Caps at ~12k
// tokens/file so one dropped log file can't blow out the whole context window silently.
const MAX_ATTACHMENT_CHARS = 50_000;

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code(props) {
          const { children, className, ...rest } = props;
          const match = /language-(\w+)/.exec(className || "");
          const inline = !match && !String(children).includes("\n");
          if (inline) {
            return (
              <code className="inline-code" {...rest}>
                {children}
              </code>
            );
          }
          return (
            <SyntaxHighlighter
              style={oneDark}
              language={match?.[1] || "text"}
              PreTag="div"
              customStyle={{ margin: 0, borderRadius: 6, fontSize: 13 }}
            >
              {String(children).replace(/\n$/, "")}
            </SyntaxHighlighter>
          );
        },
      }}
    >
      {text}
    </ReactMarkdown>
  );
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
  const [showMcp, setShowMcp] = useState(false);
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
  const [mcpTools, setMcpTools] = useState<McpTool[]>([]);
  const [newMcpName, setNewMcpName] = useState("");
  const [newMcpCommand, setNewMcpCommand] = useState("npx");
  const [newMcpArgs, setNewMcpArgs] = useState("");
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [agentId, setAgentId] = useState<string>("");
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [autonomousMode, setAutonomousMode] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  function refreshSessions() {
    invoke<SessionInfo[]>("list_sessions", { view: "chat" }).then(setSessions).catch(() => undefined);
  }

  function refreshMcpTools() {
    invoke<McpTool[]>("list_mcp_tools").then(setMcpTools).catch(() => undefined);
  }

  useEffect(() => {
    refreshSessions();
    refreshMcpTools();
    invoke<McpServerConfig[]>("get_mcp_servers_config").then(setMcpServers).catch(() => undefined);
    invoke<AgentInfo[]>("list_agents").then(setAgents).catch(() => undefined);
    invoke<ProjectInfo[]>("list_projects").then(setProjects).catch(() => undefined);
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
    setProjectId(sessions.find((s) => s.id === id)?.project_id ?? "");
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
    const id = await invoke<string>("create_session", {
      view: "chat",
      title,
      projectId: projectId || null,
    });
    setSessionId(id);
    refreshSessions();
    return id;
  }

  async function extractAndSaveMemory(text: string): Promise<string> {
    const match = text.match(MEMORY_MARKER);
    if (!match) return text;
    const [full, category, content] = match;
    await invoke("add_memory", { category, content: content.trim() }).catch(() => undefined);
    return text.replace(full, "").trimEnd();
  }

  async function addMcpServer() {
    if (!newMcpName.trim() || !newMcpCommand.trim()) return;
    const config: McpServerConfig = {
      name: newMcpName.trim(),
      command: newMcpCommand.trim(),
      args: newMcpArgs.trim() ? newMcpArgs.trim().split(/\s+/) : [],
    };
    const updated = [...mcpServers.filter((s) => s.name !== config.name), config];
    setMcpServers(updated);
    await invoke("save_mcp_servers_config", { servers: updated }).catch(() => undefined);
    setNewMcpName("");
    setNewMcpArgs("");
  }

  async function connectMcpServer(config: McpServerConfig) {
    setError(null);
    try {
      await invoke("connect_mcp_server", { config });
      refreshMcpTools();
    } catch (err) {
      setError(`Failed to connect ${config.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function disconnectMcpServer(name: string) {
    await invoke("disconnect_mcp_server", { name }).catch(() => undefined);
    refreshMcpTools();
  }

  async function removeMcpServerConfig(name: string) {
    const updated = mcpServers.filter((s) => s.name !== name);
    setMcpServers(updated);
    await invoke("save_mcp_servers_config", { servers: updated }).catch(() => undefined);
  }

  function setStatus(assistantId: string, status: string) {
    setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, status } : m)));
  }

  function readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
      reader.readAsText(file);
    });
  }

  async function addAttachments(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      // Heuristic, not a real content-type check - good enough to keep binary drops (images,
      // PDFs) from landing as garbled text in the chat. No vision/base64 path here; attaching an
      // image would need a model that accepts image content blocks, not assumed yet.
      const looksBinary = /\.(png|jpe?g|gif|webp|pdf|zip|exe|dll|bin|ico)$/i.test(file.name);
      if (looksBinary) {
        setError(`Can't attach "${file.name}" - only text/code files are supported right now.`);
        continue;
      }
      try {
        const text = await readFileAsText(file);
        const truncated = text.length > MAX_ATTACHMENT_CHARS;
        setAttachments((prev) => [
          ...prev,
          {
            id: newId(),
            name: file.name,
            content: truncated ? text.slice(0, MAX_ATTACHMENT_CHARS) : text,
            truncated,
          },
        ]);
      } catch {
        setError(`Couldn't read "${file.name}" as text.`);
      }
    }
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDraggingOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setIsDraggingOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDraggingOver(false);
    if (e.dataTransfer.files.length > 0) addAttachments(e.dataTransfer.files);
  }

  async function handleSend() {
    const typedText = input.trim();
    if ((!typedText && attachments.length === 0) || isStreaming) return;

    setError(null);
    setInput("");
    const pendingAttachments = attachments;
    setAttachments([]);

    const attachmentNote =
      pendingAttachments.length > 0 ? `📎 ${pendingAttachments.map((a) => a.name).join(", ")}` : "";
    // join rather than concatenate so an attachment-only message (no typed text) doesn't end up
    // as a session title that's just leading blank lines.
    const displayText = [typedText, attachmentNote].filter(Boolean).join("\n\n");
    const apiText =
      pendingAttachments.length > 0
        ? `${pendingAttachments
            .map(
              (a) =>
                `Attached file: ${a.name}${a.truncated ? " (truncated)" : ""}\n\`\`\`\n${a.content}\n\`\`\``,
            )
            .join("\n\n")}\n\n${typedText}`
        : typedText;

    const sid = await ensureSession(displayText);
    await invoke("append_message", { sessionId: sid, role: "user", content: displayText }).catch(
      () => undefined,
    );

    const userMsg: DisplayMessage = { id: newId(), role: "user", content: displayText };
    const assistantId = newId();
    const history = [...messages, userMsg];
    setMessages([...history, { id: assistantId, role: "assistant", content: "", pending: true }]);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const selectedAgent = agents.find((a) => a.id === agentId);
      const selectedProject = projects.find((p) => p.id === projectId);
      const memoryContext = await invoke<string>("get_memory_context").catch(() => "");
      const systemPrelude: ChatMessage[] = [];
      if (selectedProject?.instructions) {
        systemPrelude.push({ role: "system", content: selectedProject.instructions });
      }
      if (selectedAgent?.system_prompt) {
        systemPrelude.push({ role: "system", content: selectedAgent.system_prompt });
      }
      if (memoryContext) {
        systemPrelude.push({
          role: "system",
          content:
            `${memoryContext}\nIf you learn something about the user or this project worth ` +
            `remembering for future conversations, end your reply with one line formatted ` +
            `exactly as: [MEMORY:category] the fact to remember - where category is one of ` +
            `user, feedback, project, reference. Only do this when something is genuinely ` +
            `worth persisting, not on every message.`,
        });
      }
      if (autonomousMode) {
        systemPrelude.push({
          role: "system",
          content:
            "Autonomous mode is on. Work through this task step by step using the tools " +
            "available to you - call a tool, look at its result, and call another if the task " +
            "isn't done yet, rather than stopping after one tool call. Only give a final answer " +
            "once the task is genuinely complete, or you hit a real blocker (missing " +
            "information, a decision only the user can make, or a tool that doesn't exist for " +
            "what's needed) - in that case say exactly what's blocking you instead of guessing.",
        });
      }
      // The displayed/stored turn keeps the short "📎 filename" note; the model actually gets the
      // full attached file content, swapped in only for this latest turn so history replayed on
      // reload doesn't re-send every past attachment's full text on every future message.
      const outgoingHistory = [
        ...systemPrelude,
        ...history.slice(0, -1).map(({ role, content }) => ({ role, content })),
        { role: "user" as const, content: apiText },
      ];

      const tools: GatewayTool[] = mcpTools.map((t) => ({
        type: "function",
        function: {
          name: `${t.server}__${t.name}`,
          description: t.description,
          parameters: t.input_schema,
        },
      }));
      if (selectedAgent?.use_research_tool) {
        tools.push(RESEARCH_TOOL);
      }

      if (tools.length > 0) {
        const finalText = await runToolLoop(
          model,
          outgoingHistory,
          tools,
          async (toolName, args) => {
            if (toolName === "search_journal_articles") {
              return invoke("search_journal_articles", args as Record<string, unknown>);
            }
            const sepIdx = toolName.indexOf("__");
            const server = toolName.slice(0, sepIdx);
            const tool = toolName.slice(sepIdx + 2);
            return invoke("call_mcp_tool", { server, tool, arguments: args });
          },
          (status) => setStatus(assistantId, status),
          controller.signal,
          autonomousMode ? 25 : undefined,
        );
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: finalText, status: undefined } : m)),
        );
      } else {
        await streamChatCompletion(
          model,
          outgoingHistory,
          (delta) => {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m)),
            );
          },
          controller.signal,
        );
      }
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
          return { ...m, pending: false, status: undefined };
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

  const connectedServerNames = new Set(mcpTools.map((t) => t.server));

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

      <div
        className={`chat-view ${isDraggingOver ? "drag-over" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDraggingOver && <div className="drop-overlay">Drop files to attach as context</div>}
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
          <select
            className="model-select"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            disabled={isStreaming}
            title={agents.find((a) => a.id === agentId)?.description}
          >
            <option value="">No agent</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select
            className="model-select"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            disabled={isStreaming || !!sessionId}
            title={
              sessionId
                ? "Project is fixed once a chat has started - start a new chat to change it"
                : projects.find((p) => p.id === projectId)?.instructions
            }
          >
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`icon-button ${autonomousMode ? "active" : ""}`}
            onClick={() => setAutonomousMode((v) => !v)}
            title="Autonomous mode: let the model keep calling tools across more turns (up to 25) until the task is actually done, instead of stopping after one. Only has an effect when at least one tool (an agent's research tool, or a connected MCP server) is available."
          >
            🧠
          </button>
          {agents.find((a) => a.id === agentId)?.use_research_tool && (
            <span className="mcp-badge" title="This agent can search CrossRef for peer-reviewed journal articles">
              📚 research
            </span>
          )}
          {mcpTools.length > 0 && (
            <span className="mcp-badge" title={mcpTools.map((t) => t.name).join(", ")}>
              🔌 {mcpTools.length} tool{mcpTools.length === 1 ? "" : "s"}
            </span>
          )}
          <button
            className="icon-button"
            onClick={() => setShowMcp((s) => !s)}
            title="MCP servers"
            type="button"
          >
            🔌
          </button>
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

        {showMcp && (
          <div className="mcp-panel">
            <div className="mcp-server-list">
              {mcpServers.map((s) => {
                const connected = connectedServerNames.has(s.name);
                return (
                  <div key={s.name} className="mcp-server-item">
                    <span className={`mcp-dot ${connected ? "connected" : ""}`} />
                    <span className="mcp-server-name">{s.name}</span>
                    <code className="mcp-server-cmd">
                      {s.command} {s.args.join(" ")}
                    </code>
                    {connected ? (
                      <button type="button" onClick={() => disconnectMcpServer(s.name)}>
                        Disconnect
                      </button>
                    ) : (
                      <button type="button" onClick={() => connectMcpServer(s)}>
                        Connect
                      </button>
                    )}
                    <button type="button" className="mcp-remove" onClick={() => removeMcpServerConfig(s.name)}>
                      ✕
                    </button>
                  </div>
                );
              })}
              {mcpServers.length === 0 && (
                <div className="session-empty">
                  No MCP servers configured. Add one below - e.g. name "filesystem", command "npx",
                  args "-y @modelcontextprotocol/server-filesystem C:\Users\you\Documents"
                </div>
              )}
            </div>
            <div className="mcp-add">
              <input placeholder="name" value={newMcpName} onChange={(e) => setNewMcpName(e.target.value)} />
              <input
                placeholder="command (e.g. npx)"
                value={newMcpCommand}
                onChange={(e) => setNewMcpCommand(e.target.value)}
              />
              <input
                placeholder="args (space-separated)"
                value={newMcpArgs}
                onChange={(e) => setNewMcpArgs(e.target.value)}
              />
              <button type="button" onClick={addMcpServer}>
                Add
              </button>
            </div>
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
                {m.role === "assistant" ? <Markdown text={m.content} /> : m.content}
                {m.status && <div className="tool-status">{m.status}</div>}
                {m.pending && m.content === "" && !m.status && <span className="cursor">●</span>}
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

        {attachments.length > 0 && (
          <div className="attachment-list">
            {attachments.map((a) => (
              <span key={a.id} className="attachment-chip" title={a.truncated ? "Truncated to fit" : a.name}>
                📎 {a.name}
                <button type="button" onClick={() => removeAttachment(a.id)} title="Remove">
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="composer">
          <label className="attach-button" title="Attach a text/code file">
            📎
            <input
              type="file"
              multiple
              onChange={(e) => {
                if (e.target.files) addAttachments(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message the AI... (drag files in, or drop them anywhere here, to attach)"
            rows={2}
          />
          {isStreaming ? (
            <button type="button" className="send-button stop" onClick={handleStop}>
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="send-button"
              onClick={handleSend}
              disabled={!input.trim() && attachments.length === 0}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
