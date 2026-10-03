import { useState } from "react";
import AgentsView from "./AgentsView";
import ChatView from "./ChatView";
import CodeView from "./CodeView";
import MemoryView from "./MemoryView";
import ProjectsView from "./ProjectsView";
import "./App.css";

type Tab = "chat" | "code" | "memory" | "projects" | "agents";

export default function App() {
  const [tab, setTab] = useState<Tab>("chat");

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">The AI Project</h1>
        <nav className="app-tabs">
          <button
            type="button"
            className={`app-tab ${tab === "chat" ? "active" : ""}`}
            onClick={() => setTab("chat")}
          >
            Chat
          </button>
          <button
            type="button"
            className={`app-tab ${tab === "code" ? "active" : ""}`}
            onClick={() => setTab("code")}
          >
            Code
          </button>
          <button
            type="button"
            className={`app-tab ${tab === "memory" ? "active" : ""}`}
            onClick={() => setTab("memory")}
          >
            Memory
          </button>
          <button
            type="button"
            className={`app-tab ${tab === "projects" ? "active" : ""}`}
            onClick={() => setTab("projects")}
          >
            Projects
          </button>
          <button
            type="button"
            className={`app-tab ${tab === "agents" ? "active" : ""}`}
            onClick={() => setTab("agents")}
          >
            Agents
          </button>
        </nav>
      </header>

      {/* All views stay mounted so switching tabs never kills a running Code session. */}
      <div className="app-body" style={{ display: tab === "chat" ? "flex" : "none" }}>
        <ChatView />
      </div>
      <div className="app-body" style={{ display: tab === "code" ? "flex" : "none" }}>
        <CodeView />
      </div>
      <div className="app-body" style={{ display: tab === "memory" ? "flex" : "none" }}>
        <MemoryView />
      </div>
      <div className="app-body" style={{ display: tab === "projects" ? "flex" : "none" }}>
        <ProjectsView />
      </div>
      <div className="app-body" style={{ display: tab === "agents" ? "flex" : "none" }}>
        <AgentsView />
      </div>
    </div>
  );
}
