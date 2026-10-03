import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { getGatewayUrl } from "./gateway";
import "./CodeView.css";

interface SkillInfo {
  name: string;
  description: string;
  path: string;
}

interface HooksConfig {
  session_start: string[];
  session_stop: string[];
  post_file_change: string[];
}

interface ProjectInfo {
  id: string;
  name: string;
  instructions: string;
  code_path: string | null;
  created_at: number;
}

const EMPTY_HOOKS: HooksConfig = { session_start: [], session_stop: [], post_file_change: [] };

export default function CodeView() {
  const [cwd, setCwd] = useState<string>("");
  const [model, setModel] = useState("chat-default");
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [showHooks, setShowHooks] = useState(false);
  const [hooks, setHooks] = useState<HooksConfig>(EMPTY_HOOKS);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [projectId, setProjectId] = useState<string>("");

  const termContainerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const unlistenRef = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    invoke<SkillInfo[]>("list_skills").then(setSkills).catch(() => undefined);
    invoke<HooksConfig>("get_hooks_config").then(setHooks).catch(() => undefined);
    invoke<ProjectInfo[]>("list_projects").then(setProjects).catch(() => undefined);
  }, []);

  function selectProject(id: string) {
    setProjectId(id);
    const project = projects.find((p) => p.id === id);
    if (project?.code_path) setCwd(project.code_path);
  }

  useEffect(() => {
    if (!termContainerRef.current || termRef.current) return;
    const term = new Terminal({
      fontFamily: "'Cascadia Code', 'Consolas', monospace",
      fontSize: 13,
      theme: {
        background: "#1a2332", // --ink
        foreground: "#fefcf9", // --warm-white
        cursor: "#7a6a52", // --accent
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(termContainerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    term.onData((data) => {
      if (sessionIdRef.current) {
        invoke("write_to_code_session", { sessionId: sessionIdRef.current, data }).catch(() => undefined);
      }
    });

    const handleResize = () => {
      fit.fit();
      if (sessionIdRef.current) {
        invoke("resize_code_session", {
          sessionId: sessionIdRef.current,
          rows: term.rows,
          cols: term.cols,
        }).catch(() => undefined);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      term.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // sessionId needs to be readable inside the onData closure registered once on mount.
  const sessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  function toggleSkill(path: string) {
    setSelectedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function pickFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") setCwd(selected);
  }

  async function startSession() {
    if (!cwd) {
      setError("Pick a working directory first.");
      return;
    }
    setError(null);
    termRef.current?.clear();

    for (const fn of unlistenRef.current) fn();
    unlistenRef.current = [];

    try {
      const id = await invoke<string>("start_code_session", {
        args: {
          cwd,
          gateway_url: getGatewayUrl(),
          model,
          skill_paths: Array.from(selectedSkills),
          project_id: projectId || null,
        },
      });
      setSessionId(id);

      // History record only (cwd/model/when) - not a transcript. Aider already keeps its own
      // .aider.chat.history.md inside the working directory, which is the actual conversation
      // record; this is just so past Code sessions show up somewhere in the app.
      invoke("create_session", { view: "code", title: cwd, project_id: projectId || null }).catch(() => undefined);

      const unlistenOutput = await listen<string>(`code-output-${id}`, (event) => {
        termRef.current?.write(event.payload);
      });
      const unlistenEnded = await listen(`code-session-ended-${id}`, () => {
        setSessionId(null);
      });
      unlistenRef.current = [unlistenOutput, unlistenEnded];
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function stopSession() {
    if (!sessionId) return;
    await invoke("stop_code_session", { sessionId }).catch(() => undefined);
    setSessionId(null);
  }

  function updateHookField(field: keyof HooksConfig, value: string) {
    setHooks((prev) => ({ ...prev, [field]: value.split("\n") }));
  }

  async function saveHooks() {
    await invoke("save_hooks_config", { config: hooks }).catch((err) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
    setShowHooks(false);
  }

  return (
    <div className="code-view">
      <div className="code-toolbar">
        <select
          value={projectId}
          onChange={(e) => selectProject(e.target.value)}
          disabled={!!sessionId}
          title="Scope this session to a project - its instructions get read in alongside skills"
        >
          <option value="">No project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button type="button" className="folder-button" onClick={pickFolder} disabled={!!sessionId}>
          {cwd || "Choose working directory..."}
        </button>
        <select value={model} onChange={(e) => setModel(e.target.value)} disabled={!!sessionId}>
          <option value="chat-default">chat-default</option>
          <option value="chat-fast">chat-fast</option>
          <option value="chat-batch">chat-batch</option>
        </select>
        <div className="skill-picker">
          {skills.length === 0 ? (
            <span className="skill-empty">No skills yet</span>
          ) : (
            skills.map((s) => (
              <label key={s.path} className="skill-chip" title={s.description}>
                <input
                  type="checkbox"
                  checked={selectedSkills.has(s.path)}
                  onChange={() => toggleSkill(s.path)}
                  disabled={!!sessionId}
                />
                {s.name}
              </label>
            ))
          )}
        </div>
        <button type="button" className="icon-button" onClick={() => setShowHooks((s) => !s)} title="Hooks">
          ⚓
        </button>
        {sessionId ? (
          <button type="button" className="send-button stop" onClick={stopSession}>
            Stop
          </button>
        ) : (
          <button type="button" className="send-button" onClick={startSession}>
            Start
          </button>
        )}
      </div>

      {showHooks && (
        <div className="hooks-panel">
          <div className="hooks-field">
            <label>session-start (one shell command per line)</label>
            <textarea
              value={hooks.session_start.join("\n")}
              onChange={(e) => updateHookField("session_start", e.target.value)}
              rows={2}
            />
          </div>
          <div className="hooks-field">
            <label>session-stop</label>
            <textarea
              value={hooks.session_stop.join("\n")}
              onChange={(e) => updateHookField("session_stop", e.target.value)}
              rows={2}
            />
          </div>
          <div className="hooks-field">
            <label>post-file-change (runs on every file create/modify in the working dir)</label>
            <textarea
              value={hooks.post_file_change.join("\n")}
              onChange={(e) => updateHookField("post_file_change", e.target.value)}
              rows={2}
            />
          </div>
          <button type="button" onClick={saveHooks}>
            Save hooks
          </button>
        </div>
      )}

      {error && (
        <div className="error-banner">
          {error}
          <button type="button" onClick={() => setError(null)}>
            ✕
          </button>
        </div>
      )}

      <div className="terminal-container" ref={termContainerRef} />
    </div>
  );
}
