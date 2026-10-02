import { useState } from "react";
import ChatView from "./ChatView";
import CodeView from "./CodeView";
import "./App.css";

type Tab = "chat" | "code";

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
        </nav>
      </header>

      {/* Both views stay mounted so switching tabs never kills a running Code session. */}
      <div className="app-body" style={{ display: tab === "chat" ? "flex" : "none" }}>
        <ChatView />
      </div>
      <div className="app-body" style={{ display: tab === "code" ? "flex" : "none" }}>
        <CodeView />
      </div>
    </div>
  );
}
