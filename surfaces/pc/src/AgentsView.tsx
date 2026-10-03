import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./AgentsView.css";

interface AgentInfo {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  mcp_servers: string[];
  use_research_tool: boolean;
}

interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
}

const EMPTY: AgentInfo = {
  id: "",
  name: "",
  description: "",
  system_prompt: "",
  mcp_servers: [],
  use_research_tool: false,
};

export default function AgentsView() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
  const [editing, setEditing] = useState<AgentInfo>(EMPTY);
  const [dirty, setDirty] = useState(false);

  function refresh() {
    invoke<AgentInfo[]>("list_agents").then(setAgents).catch(() => undefined);
    invoke<McpServerConfig[]>("get_mcp_servers_config").then(setMcpServers).catch(() => undefined);
  }

  useEffect(refresh, []);

  function selectAgent(a: AgentInfo) {
    setEditing(a);
    setDirty(false);
  }

  function startNew() {
    setEditing(EMPTY);
    setDirty(false);
  }

  function toggleMcpServer(name: string) {
    const has = editing.mcp_servers.includes(name);
    setEditing({
      ...editing,
      mcp_servers: has ? editing.mcp_servers.filter((s) => s !== name) : [...editing.mcp_servers, name],
    });
    setDirty(true);
  }

  async function save() {
    if (!editing.name.trim() || !editing.system_prompt.trim()) return;
    await invoke("save_agent", {
      agent: { ...editing, name: editing.name.trim() },
    }).catch(() => undefined);
    setDirty(false);
    refresh();
  }

  async function remove(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await invoke("delete_agent", { id }).catch(() => undefined);
    if (editing.id === id) startNew();
    refresh();
  }

  return (
    <div className="agents-view">
      <aside className="agents-sidebar">
        <button type="button" className="new-agent-button" onClick={startNew}>
          + New agent
        </button>
        <div className="agents-list">
          {agents.map((a) => (
            <div
              key={a.id}
              className={`agents-item ${a.id === editing.id ? "active" : ""}`}
              onClick={() => selectAgent(a)}
            >
              <span className="agents-item-name">{a.name}</span>
              <button
                type="button"
                className="agents-item-delete"
                onClick={(e) => remove(a.id, e)}
                title="Delete"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </aside>

      <div className="agents-editor">
        <p className="agents-intro">
          An agent is a named system-prompt + tool-scope preset you can pick from the dropdown in
          Chat, so you don't retype a system prompt every time. The five defaults (General
          Assistant, Research Analyst, Medical/Legal Research Assistant, Software Engineer) are
          deliberately framed as research/advisory personas, not as agents that present themselves
          as a licensed professional making binding decisions - follow the same framing for custom
          ones you add here.
        </p>
        <input
          className="agents-name-input"
          type="text"
          value={editing.name}
          onChange={(e) => {
            setEditing({ ...editing, name: e.target.value });
            setDirty(true);
          }}
          placeholder="Agent name"
        />
        <input
          className="agents-name-input"
          type="text"
          value={editing.description}
          onChange={(e) => {
            setEditing({ ...editing, description: e.target.value });
            setDirty(true);
          }}
          placeholder="Short description (shown as a tooltip in Chat)"
        />
        <textarea
          className="agents-prompt-input"
          value={editing.system_prompt}
          onChange={(e) => {
            setEditing({ ...editing, system_prompt: e.target.value });
            setDirty(true);
          }}
          placeholder="System prompt..."
          rows={8}
        />
        <label className="agents-checkbox">
          <input
            type="checkbox"
            checked={editing.use_research_tool}
            onChange={(e) => {
              setEditing({ ...editing, use_research_tool: e.target.checked });
              setDirty(true);
            }}
          />
          Can search real peer-reviewed journal articles (CrossRef) before answering
        </label>

        <div className="agents-mcp-scope">
          <div className="agents-mcp-scope-label">
            MCP servers this agent can use (stored for future use - not yet enforced; Chat
            currently exposes all connected MCP tools to every agent regardless of this list)
          </div>
          {mcpServers.length === 0 && (
            <div className="agents-mcp-scope-empty">No MCP servers configured yet (see Chat → 🔌).</div>
          )}
          {mcpServers.map((s) => (
            <label key={s.name} className="agents-checkbox">
              <input
                type="checkbox"
                checked={editing.mcp_servers.includes(s.name)}
                onChange={() => toggleMcpServer(s.name)}
              />
              {s.name}
            </label>
          ))}
        </div>

        <button
          type="button"
          className="agents-save-button"
          onClick={save}
          disabled={!dirty || !editing.name.trim() || !editing.system_prompt.trim()}
        >
          {editing.id ? "Save changes" : "Create agent"}
        </button>
      </div>
    </div>
  );
}
