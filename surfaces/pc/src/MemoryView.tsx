import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./MemoryView.css";

interface MemoryInfo {
  id: number;
  category: string;
  content: string;
  created_at: number;
}

const CATEGORIES = ["user", "project", "feedback", "reference"] as const;

export default function MemoryView() {
  const [memories, setMemories] = useState<MemoryInfo[]>([]);
  const [category, setCategory] = useState<string>("project");
  const [content, setContent] = useState("");

  function refresh() {
    invoke<MemoryInfo[]>("list_memories").then(setMemories).catch(() => undefined);
  }

  useEffect(refresh, []);

  async function add() {
    if (!content.trim()) return;
    await invoke("add_memory", { category, content: content.trim() }).catch(() => undefined);
    setContent("");
    refresh();
  }

  async function remove(id: number) {
    await invoke("delete_memory", { id }).catch(() => undefined);
    refresh();
  }

  return (
    <div className="memory-view">
      <div className="memory-intro">
        <p>
          Everything here gets injected into every new Chat and Code session, the same way Claude
          Code's own CLAUDE.md / auto-memory works. The model can also add entries itself during a
          conversation when it decides something's worth remembering (look for a
          <code>[MEMORY:category]</code> line it may append) — this list is where those land too,
          alongside anything you add by hand.
        </p>
      </div>

      <div className="memory-add">
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Something worth remembering..."
        />
        <button type="button" onClick={add}>
          Add
        </button>
      </div>

      <div className="memory-list">
        {CATEGORIES.map((cat) => {
          const items = memories.filter((m) => m.category === cat);
          if (items.length === 0) return null;
          return (
            <div key={cat} className="memory-group">
              <h3>{cat}</h3>
              {items.map((m) => (
                <div key={m.id} className="memory-item">
                  <span>{m.content}</span>
                  <button type="button" onClick={() => remove(m.id)} title="Delete">
                    ✕
                  </button>
                </div>
              ))}
            </div>
          );
        })}
        {memories.length === 0 && <div className="memory-empty">Nothing remembered yet.</div>}
      </div>
    </div>
  );
}
