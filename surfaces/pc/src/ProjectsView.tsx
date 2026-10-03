import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import "./ProjectsView.css";

interface ProjectInfo {
  id: string;
  name: string;
  instructions: string;
  code_path: string | null;
  created_at: number;
}

const EMPTY: ProjectInfo = { id: "", name: "", instructions: "", code_path: null, created_at: 0 };

export default function ProjectsView() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [editing, setEditing] = useState<ProjectInfo>(EMPTY);
  const [dirty, setDirty] = useState(false);

  function refresh() {
    invoke<ProjectInfo[]>("list_projects").then(setProjects).catch(() => undefined);
  }

  useEffect(refresh, []);

  function selectProject(p: ProjectInfo) {
    setEditing(p);
    setDirty(false);
  }

  function startNew() {
    setEditing(EMPTY);
    setDirty(false);
  }

  async function pickCodePath() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      setEditing({ ...editing, code_path: selected });
      setDirty(true);
    }
  }

  async function save() {
    if (!editing.name.trim()) return;
    await invoke("save_project", {
      project: { ...editing, name: editing.name.trim() },
    }).catch(() => undefined);
    setDirty(false);
    refresh();
  }

  async function remove(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await invoke("delete_project", { id }).catch(() => undefined);
    if (editing.id === id) startNew();
    refresh();
  }

  return (
    <div className="projects-view">
      <aside className="projects-sidebar">
        <button type="button" className="new-project-button" onClick={startNew}>
          + New project
        </button>
        <div className="projects-list">
          {projects.map((p) => (
            <div
              key={p.id}
              className={`projects-item ${p.id === editing.id ? "active" : ""}`}
              onClick={() => selectProject(p)}
            >
              <span className="projects-item-name">{p.name}</span>
              <button
                type="button"
                className="projects-item-delete"
                onClick={(e) => remove(p.id, e)}
                title="Delete"
              >
                ✕
              </button>
            </div>
          ))}
          {projects.length === 0 && (
            <div className="projects-empty">No projects yet. Create one to get started.</div>
          )}
        </div>
      </aside>

      <div className="projects-editor">
        <p className="projects-intro">
          A project is a standing set of instructions/context - like "this chat is about the
          homelab Proxmox migration" or "answer as if reviewing a legal contract." Chats scoped to
          a project (pick it from the dropdown in Chat once created here) get this injected into
          their system prompt automatically, alongside memory and any selected agent persona. A
          Code session scoped to this project (pick it in the Code tab) gets the same instructions
          read in, and starting one from here jumps straight to the working directory below.
        </p>
        <input
          className="projects-name-input"
          type="text"
          value={editing.name}
          onChange={(e) => {
            setEditing({ ...editing, name: e.target.value });
            setDirty(true);
          }}
          placeholder="Project name"
        />
        <button type="button" className="projects-folder-button" onClick={pickCodePath}>
          {editing.code_path || "Working directory (optional - for the Code view)..."}
        </button>
        <textarea
          className="projects-instructions-input"
          value={editing.instructions}
          onChange={(e) => {
            setEditing({ ...editing, instructions: e.target.value });
            setDirty(true);
          }}
          placeholder="Standing instructions / context for every chat in this project..."
          rows={12}
        />
        <button type="button" className="projects-save-button" onClick={save} disabled={!dirty || !editing.name.trim()}>
          {editing.id ? "Save changes" : "Create project"}
        </button>
      </div>
    </div>
  );
}
