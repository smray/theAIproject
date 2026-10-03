import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { getGatewayUrl, listModels } from "./gateway";
import Markdown from "./Markdown";
import CodeTerminal from "./CodeTerminal";
import {
  diffLineKind,
  liveView,
  normalize,
  parseAiderRecord,
  type EditBlock,
  type ParsedTurn,
  type Segment,
} from "./aiderRecord";
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

interface CodeSessionRow {
  id: string;
  title: string;
  project_id: string | null;
  updated_at: number;
  cwd: string | null;
}

interface ChangedFile {
  path: string;
  kind: string;
}

interface EndedPayload {
  exit_code: number;
  stopped: boolean;
  record: string;
  raw: string;
}

type Msg =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "turn"; record: string; parsed: ParsedTurn; stopped: boolean }
  | { id: string; kind: "error"; text: string };

interface LiveTurn {
  turnId: string;
  startedAt: number;
  raw: string;
}

const EMPTY_HOOKS: HooksConfig = { session_start: [], session_stop: [], post_file_change: [] };
const FALLBACK_MODELS = ["chat-default", "chat-fast", "chat-batch"];
const SUGGESTIONS = [
  "Explain how this project is structured",
  "Add a README with setup and usage instructions",
  "Find and fix bugs in the main entry point",
  "Write tests for the core logic",
];

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function errText(err: unknown): string {
  return typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
}

function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

function looksLikePath(s: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(s) || s.startsWith("/");
}

function msgFromRow(role: string, content: string): Msg {
  if (role === "user") return { id: newId(), kind: "user", text: content };
  if (role === "error") return { id: newId(), kind: "error", text: content };
  return { id: newId(), kind: "turn", record: content, parsed: parseAiderRecord(content), stopped: false };
}

function failureHint(raw: string, gatewayUrl: string): string {
  const text = normalize(raw);
  if (/APIConnectionError|Connection error|ConnectError|getaddrinfo|ConnectionRefused|timed out/i.test(text)) {
    return `Couldn't reach the model gateway at ${gatewayUrl}. Check the URL in Chat settings and that the gateway is up.`;
  }
  if (/AuthenticationError|Incorrect API key/i.test(text)) return "The gateway rejected the credentials.";
  if (/NotFoundError|model.*not found/i.test(text)) return "The gateway doesn't know that model name. Pick another model.";
  return "";
}

function DiffView({ text }: { text: string }) {
  return (
    <pre className="cv-diff">
      {text.split("\n").map((line, i) => (
        <div key={i} className={`cv-diff-line cv-diff-${diffLineKind(line)}`}>
          {line || " "}
        </div>
      ))}
    </pre>
  );
}

function EditCard({ edit }: { edit: EditBlock }) {
  const [expanded, setExpanded] = useState(false);
  const LIMIT = 40;
  const removed = edit.search ? edit.search.split("\n") : [];
  const added = edit.replace ? edit.replace.split("\n") : [];
  const lines = [
    ...removed.map((t) => ({ k: "del", t })),
    ...added.map((t) => ({ k: "add", t })),
  ];
  const shown = expanded ? lines : lines.slice(0, LIMIT);
  return (
    <div className="cv-edit">
      <div className="cv-edit-head">
        <span className="cv-edit-file">{edit.file || "(unnamed file)"}</span>
        {!edit.search && <span className="cv-badge cv-badge-new">new</span>}
        <span className="cv-edit-count">
          <span className="cv-plus">+{added.length}</span> <span className="cv-minus">-{removed.length}</span>
        </span>
      </div>
      <pre className="cv-diff">
        {shown.map((l, i) => (
          <div key={i} className={`cv-diff-line cv-diff-${l.k}`}>
            {(l.k === "add" ? "+ " : "- ") + l.t}
          </div>
        ))}
      </pre>
      {lines.length > LIMIT && (
        <button type="button" className="cv-link" onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Show less" : `Show all ${lines.length} lines`}
        </button>
      )}
    </div>
  );
}

function Segments({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        s.kind === "text" ? (
          <div key={i} className="cv-prose">
            <Markdown text={s.text} />
          </div>
        ) : (
          <EditCard key={i} edit={s.edit} />
        ),
      )}
    </>
  );
}

function TurnCard({
  msg,
  activeRev,
  onViewDiff,
}: {
  msg: Extract<Msg, { kind: "turn" }>;
  activeRev: string | null;
  onViewDiff: (hash: string) => void;
}) {
  const p = msg.parsed;
  return (
    <div className="cv-msg cv-assistant">
      <div className="cv-who">Aider{msg.stopped ? " (stopped)" : ""}</div>
      <Segments segments={p.segments} />
      {p.segments.length === 0 && p.notes.length > 0 && (
        <div className="cv-notes">
          {p.notes.map((n, i) => (
            <div key={i}>{n}</div>
          ))}
        </div>
      )}
      {p.segments.length === 0 && p.notes.length === 0 && p.problems.length === 0 && !msg.stopped && (
        <div className="cv-prose cv-muted">Done.</div>
      )}
      {p.problems.length > 0 && (
        <div className="cv-problems">
          {p.problems.map((t, i) => (
            <div key={i}>{t}</div>
          ))}
        </div>
      )}
      {(p.appliedFiles.length > 0 || p.commits.length > 0) && (
        <div className="cv-result">
          {p.appliedFiles.map((f) => (
            <span key={f} className="cv-chip">
              edited {f}
            </span>
          ))}
          {p.commits.map((c) => (
            <button
              key={c.hash}
              type="button"
              className={`cv-chip cv-chip-commit ${activeRev === c.hash ? "active" : ""}`}
              onClick={() => onViewDiff(c.hash)}
              title="View this commit's diff"
            >
              <code>{c.hash.slice(0, 7)}</code> {c.message}
            </button>
          ))}
        </div>
      )}
      {p.tokens && <div className="cv-tokens">{p.tokens}</div>}
      <details className="cv-details">
        <summary>Details</summary>
        {p.notes.length > 0 && (
          <div className="cv-notes">
            {p.notes.map((n, i) => (
              <div key={i}>{n}</div>
            ))}
          </div>
        )}
        <pre className="cv-raw">{normalize(msg.record).trim()}</pre>
      </details>
    </div>
  );
}

export default function CodeView() {
  const [cwd, setCwd] = useState("");
  const [model, setModel] = useState("chat-default");
  const [models, setModels] = useState<string[]>(FALLBACK_MODELS);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [projectId, setProjectId] = useState("");
  const [sessions, setSessions] = useState<CodeSessionRow[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [live, setLive] = useState<LiveTurn | null>(null);
  const [now, setNow] = useState(Date.now());
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [changedFiles, setChangedFiles] = useState<ChangedFile[]>([]);
  const [showPanel, setShowPanel] = useState(false);
  const [diff, setDiff] = useState<{ rev: string; text: string; loading: boolean } | null>(null);
  const [mode, setMode] = useState<"chat" | "terminal">("chat");
  const [showHooks, setShowHooks] = useState(false);
  const [hooks, setHooks] = useState<HooksConfig>(EMPTY_HOOKS);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const unlistenRef = useRef<UnlistenFn[]>([]);

  function refreshSessions() {
    invoke<CodeSessionRow[]>("list_code_sessions").then(setSessions).catch(() => undefined);
  }

  useEffect(() => {
    invoke<SkillInfo[]>("list_skills").then(setSkills).catch(() => undefined);
    invoke<HooksConfig>("get_hooks_config").then(setHooks).catch(() => undefined);
    invoke<ProjectInfo[]>("list_projects").then(setProjects).catch(() => undefined);
    refreshSessions();
    listModels()
      .then((list) => {
        if (list.length > 0) setModels(list.map((m) => m.id));
      })
      .catch(() => undefined);
    return () => {
      for (const fn of unlistenRef.current) fn();
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, live?.raw]);

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);

  const commits = useMemo(() => {
    const out: { hash: string; message: string }[] = [];
    for (const m of messages) if (m.kind === "turn") out.push(...m.parsed.commits);
    return out.reverse();
  }, [messages]);

  const recentFolders = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of sessions) {
      const folder = s.cwd ?? (looksLikePath(s.title) ? s.title : "");
      if (folder && !seen.has(folder)) {
        seen.add(folder);
        out.push(folder);
      }
    }
    return out.slice(0, 5);
  }, [sessions]);

  function selectProject(id: string) {
    setProjectId(id);
    const project = projects.find((p) => p.id === id);
    if (project?.code_path) setCwd(project.code_path);
  }

  async function pickFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") setCwd(selected);
  }

  function toggleSkill(path: string) {
    setSelectedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function noteFile(path: string, kind: string) {
    setChangedFiles((prev) => {
      const i = prev.findIndex((f) => f.path === path);
      if (i < 0) return [...prev, { path, kind }];
      const next = [...prev];
      // A file created and then edited again during the session is still "new" to the project.
      next[i] = { path, kind: next[i].kind === "created" && kind === "modified" ? "created" : kind };
      return next;
    });
  }

  function addEdited(files: string[]) {
    for (const f of files) {
      setChangedFiles((prev) => (prev.some((x) => x.path === f) ? prev : [...prev, { path: f, kind: "modified" }]));
    }
  }

  async function closeCurrentSession() {
    if (sessionId && cwd && messages.length > 0) {
      await invoke("end_code_session", { cwd }).catch(() => undefined);
    }
  }

  async function newSession() {
    if (live) return;
    await closeCurrentSession();
    setSessionId(null);
    setMessages([]);
    setChangedFiles([]);
    setDiff(null);
    setError(null);
  }

  async function loadSession(row: CodeSessionRow) {
    if (live || row.id === sessionId) return;
    await closeCurrentSession();
    try {
      const rows = await invoke<{ role: string; content: string }[]>("get_session_messages", {
        sessionId: row.id,
      });
      const msgs = rows.map((r) => msgFromRow(r.role, r.content));
      setMessages(msgs);
      setSessionId(row.id);
      setCwd(row.cwd ?? (looksLikePath(row.title) ? row.title : ""));
      setProjectId(row.project_id ?? "");
      setChangedFiles([]);
      setDiff(null);
      setError(null);
      const files: string[] = [];
      for (const m of msgs) if (m.kind === "turn") files.push(...m.parsed.appliedFiles);
      addEdited(Array.from(new Set(files)));
    } catch (err) {
      setError(errText(err));
    }
  }

  async function deleteSession(row: CodeSessionRow, e: React.MouseEvent) {
    e.stopPropagation();
    if (live) return;
    await invoke("delete_session", { sessionId: row.id }).catch(() => undefined);
    await invoke("forget_code_session", { sessionId: row.id }).catch(() => undefined);
    if (row.id === sessionId) {
      setSessionId(null);
      setMessages([]);
      setChangedFiles([]);
      setDiff(null);
    }
    refreshSessions();
  }

  async function ensureSession(firstPrompt: string): Promise<string> {
    if (sessionId) return sessionId;
    const id = await invoke<string>("create_session", {
      view: "code",
      title: firstPrompt.replace(/\s+/g, " ").slice(0, 60),
      projectId: projectId || null,
    });
    await invoke("register_code_session", { sessionId: id, cwd });
    setSessionId(id);
    return id;
  }

  function persist(sid: string, role: string, content: string) {
    invoke("append_message", { sessionId: sid, role, content })
      .then(refreshSessions)
      .catch(() => undefined);
  }

  async function send(text: string) {
    const prompt = text.trim();
    if (!prompt || live) return;
    if (!cwd) {
      setError("Choose a project folder first.");
      return;
    }
    setError(null);

    let sid: string;
    try {
      sid = await ensureSession(prompt);
      await invoke("append_message", { sessionId: sid, role: "user", content: prompt });
    } catch (err) {
      setError(errText(err));
      return;
    }
    setMessages((prev) => [...prev, { id: newId(), kind: "user", text: prompt }]);
    setInput("");
    refreshSessions();

    const turnId = crypto.randomUUID();
    const unlisten: UnlistenFn[] = [];
    const cleanup = () => {
      for (const fn of unlisten) fn();
      unlistenRef.current = [];
    };
    setLive({ turnId, startedAt: Date.now(), raw: "" });
    setNow(Date.now());

    const finish = (p: EndedPayload) => {
      cleanup();
      setLive(null);
      const parsed = parseAiderRecord(p.record);
      const hasContent =
        parsed.segments.length > 0 || parsed.commits.length > 0 || parsed.appliedFiles.length > 0 || parsed.notes.length > 0;
      if (!p.stopped && p.exit_code !== 0 && !hasContent) {
        const tail = normalize(p.raw).trim().split("\n").slice(-25).join("\n");
        const hint = failureHint(p.raw, getGatewayUrl());
        const text = `${hint || `Aider exited with code ${p.exit_code}.`}${tail ? `\n\n${tail}` : ""}`;
        setMessages((prev) => [...prev, { id: newId(), kind: "error", text }]);
        persist(sid, "error", text);
        return;
      }
      if (!p.stopped && p.exit_code !== 0) parsed.problems.push(`Aider exited with code ${p.exit_code}.`);
      setMessages((prev) => [
        ...prev,
        { id: newId(), kind: "turn", record: p.record, parsed, stopped: p.stopped },
      ]);
      if (hasContent) persist(sid, "assistant", p.record);
      addEdited(parsed.appliedFiles);
      if (parsed.commits.length > 0 || parsed.appliedFiles.length > 0) setShowPanel(true);
    };

    try {
      unlisten.push(
        await listen<string>(`code-turn-output-${turnId}`, (e) =>
          setLive((l) => (l && l.turnId === turnId ? { ...l, raw: l.raw + e.payload } : l)),
        ),
      );
      unlisten.push(
        await listen<{ path: string; kind: string }>(`code-file-changed-${sid}`, (e) =>
          noteFile(e.payload.path, e.payload.kind),
        ),
      );
      unlisten.push(await listen<EndedPayload>(`code-turn-ended-${turnId}`, (e) => finish(e.payload)));
      unlistenRef.current = unlisten;
      await invoke("run_code_turn", {
        args: {
          turn_id: turnId,
          session_id: sid,
          cwd,
          gateway_url: getGatewayUrl(),
          model,
          prompt,
          skill_paths: Array.from(selectedSkills),
          project_id: projectId || null,
        },
      });
    } catch (err) {
      cleanup();
      setLive(null);
      const text = errText(err);
      setMessages((prev) => [...prev, { id: newId(), kind: "error", text }]);
      persist(sid, "error", text);
    }
  }

  async function stop() {
    if (!live) return;
    await invoke("stop_code_turn", { turnId: live.turnId }).catch(() => undefined);
  }

  async function viewDiff(hash: string) {
    setShowPanel(true);
    if (diff?.rev === hash) {
      setDiff(null);
      return;
    }
    setDiff({ rev: hash, text: "", loading: true });
    try {
      const text = await invoke<string>("git_show", { cwd, rev: hash });
      setDiff({ rev: hash, text, loading: false });
    } catch (err) {
      setDiff({ rev: hash, text: `Couldn't load diff: ${errText(err)}`, loading: false });
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  }

  function updateHookField(field: keyof HooksConfig, value: string) {
    setHooks((prev) => ({ ...prev, [field]: value.split("\n") }));
  }

  async function saveHooks() {
    await invoke("save_hooks_config", { config: hooks }).catch((err) => setError(errText(err)));
    setShowHooks(false);
  }

  const liveParts = live ? liveView(live.raw) : null;
  const elapsed = live ? Math.max(0, Math.round((now - live.startedAt) / 1000)) : 0;
  const hasTurns = messages.length > 0;

  return (
    <div className="cv-layout">
      <aside className="cv-sidebar">
        <button type="button" className="cv-new" onClick={newSession} disabled={!!live}>
          + New session
        </button>
        <div className="cv-session-list">
          {sessions.map((s) => {
            const folder = s.cwd ?? (looksLikePath(s.title) ? s.title : "");
            return (
              <div
                key={s.id}
                className={`cv-session ${s.id === sessionId ? "active" : ""}`}
                onClick={() => void loadSession(s)}
              >
                <div className="cv-session-text">
                  <span className="cv-session-title">{looksLikePath(s.title) ? baseName(s.title) : s.title}</span>
                  {folder && <span className="cv-session-sub">{baseName(folder)}</span>}
                </div>
                <button
                  type="button"
                  className="cv-session-del"
                  onClick={(e) => void deleteSession(s, e)}
                  title="Delete"
                >
                  ✕
                </button>
              </div>
            );
          })}
          {sessions.length === 0 && <div className="cv-empty-note">No sessions yet</div>}
        </div>
      </aside>

      <div className="cv-main">
        <div className="cv-toolbar">
          <select
            value={projectId}
            onChange={(e) => selectProject(e.target.value)}
            disabled={!!sessionId}
            title="Scope this session to a project - its instructions are read in alongside your prompt"
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
            className="cv-folder"
            onClick={() => void pickFolder()}
            disabled={!!sessionId}
            title={cwd || "Choose the folder Aider should work in"}
          >
            {cwd ? baseName(cwd) : "Choose folder..."}
          </button>
          <select value={model} onChange={(e) => setModel(e.target.value)} disabled={!!live}>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <details className="cv-skills">
            <summary>Skills{selectedSkills.size > 0 ? ` (${selectedSkills.size})` : ""}</summary>
            <div className="cv-skills-pop">
              {skills.length === 0 ? (
                <span className="cv-muted">No skills yet. Drop .md files in the skills folder.</span>
              ) : (
                skills.map((s) => (
                  <label key={s.path} title={s.description}>
                    <input
                      type="checkbox"
                      checked={selectedSkills.has(s.path)}
                      onChange={() => toggleSkill(s.path)}
                      disabled={!!live}
                    />
                    {s.name}
                  </label>
                ))
              )}
            </div>
          </details>
          <button
            type="button"
            className="cv-icon"
            onClick={() => setShowHooks((s) => !s)}
            title="Hooks"
          >
            ⚓
          </button>
          <span className="cv-spacer" />
          <button
            type="button"
            className={`cv-icon ${showPanel ? "active" : ""}`}
            onClick={() => setShowPanel((s) => !s)}
            title="Changes panel"
          >
            Changes{changedFiles.length > 0 ? ` ${changedFiles.length}` : ""}
          </button>
          <div className="cv-seg">
            <button type="button" className={mode === "chat" ? "active" : ""} onClick={() => setMode("chat")}>
              Chat
            </button>
            <button type="button" className={mode === "terminal" ? "active" : ""} onClick={() => setMode("terminal")}>
              Terminal
            </button>
          </div>
        </div>

        {showHooks && (
          <div className="cv-hooks">
            <div className="cv-hooks-field">
              <label>session-start (one shell command per line)</label>
              <textarea
                value={hooks.session_start.join("\n")}
                onChange={(e) => updateHookField("session_start", e.target.value)}
                rows={2}
              />
            </div>
            <div className="cv-hooks-field">
              <label>session-stop</label>
              <textarea
                value={hooks.session_stop.join("\n")}
                onChange={(e) => updateHookField("session_stop", e.target.value)}
                rows={2}
              />
            </div>
            <div className="cv-hooks-field">
              <label>post-file-change (runs on every file create/modify in the working dir)</label>
              <textarea
                value={hooks.post_file_change.join("\n")}
                onChange={(e) => updateHookField("post_file_change", e.target.value)}
                rows={2}
              />
            </div>
            <button type="button" className="cv-btn cv-btn-primary" onClick={() => void saveHooks()}>
              Save hooks
            </button>
          </div>
        )}

        {error && (
          <div className="cv-error">
            {error}
            <button type="button" onClick={() => setError(null)}>
              ✕
            </button>
          </div>
        )}

        <div className="cv-body" style={{ display: mode === "chat" ? "flex" : "none" }}>
          <div className="cv-chat">
            <div className="cv-scroll" ref={scrollRef}>
              {!cwd && !hasTurns && (
                <div className="cv-hero">
                  <h2>Build something</h2>
                  <p>Pick a project folder and describe what you want. Changes are made and committed for you.</p>
                  <button type="button" className="cv-btn cv-btn-primary" onClick={() => void pickFolder()}>
                    Choose folder...
                  </button>
                  {recentFolders.length > 0 && (
                    <div className="cv-recent">
                      <div className="cv-recent-label">Recent</div>
                      {recentFolders.map((f) => (
                        <button key={f} type="button" className="cv-recent-item" onClick={() => setCwd(f)} title={f}>
                          {baseName(f)} <span className="cv-muted">{f}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {cwd && !hasTurns && !live && (
                <div className="cv-hero">
                  <h2>What should we build in {baseName(cwd)}?</h2>
                  <p>Describe a change in plain language. You'll see each edit, and every change is committed so it can be undone.</p>
                  <div className="cv-suggestions">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => {
                          setInput(s);
                          inputRef.current?.focus();
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m) => {
                if (m.kind === "user") {
                  return (
                    <div key={m.id} className="cv-msg cv-user">
                      <div className="cv-bubble">{m.text === "/undo" ? "Undo the last change" : m.text}</div>
                    </div>
                  );
                }
                if (m.kind === "error") {
                  return (
                    <div key={m.id} className="cv-msg cv-assistant">
                      <div className="cv-problems cv-pre">{m.text}</div>
                    </div>
                  );
                }
                return <TurnCard key={m.id} msg={m} activeRev={diff?.rev ?? null} onViewDiff={(h) => void viewDiff(h)} />;
              })}

              {live && liveParts && (
                <div className="cv-msg cv-assistant">
                  <div className="cv-working">
                    <span className="cv-spinner" />
                    <span>{liveParts.phase ?? "Working..."}</span>
                    <span className="cv-muted">{elapsed}s</span>
                  </div>
                  <Segments segments={liveParts.segments} />
                </div>
              )}
            </div>

            <div className="cv-composer">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={cwd ? "Describe what to build or change..." : "Choose a project folder to begin"}
                rows={2}
                disabled={!cwd}
              />
              <div className="cv-composer-actions">
                <button
                  type="button"
                  className="cv-btn"
                  onClick={() => void send("/undo")}
                  disabled={!!live || !cwd || commits.length === 0}
                  title="Undo the last commit Aider made"
                >
                  Undo
                </button>
                {live ? (
                  <button type="button" className="cv-btn cv-btn-stop" onClick={() => void stop()}>
                    Stop
                  </button>
                ) : (
                  <button
                    type="button"
                    className="cv-btn cv-btn-primary"
                    onClick={() => void send(input)}
                    disabled={!input.trim() || !cwd}
                  >
                    Send
                  </button>
                )}
              </div>
            </div>
          </div>

          {showPanel && (
            <aside className="cv-panel">
              <div className="cv-panel-section">
                <div className="cv-panel-title">Files ({changedFiles.length})</div>
                {changedFiles.length === 0 && <div className="cv-empty-note">Nothing changed yet</div>}
                {changedFiles.map((f) => (
                  <div key={f.path} className="cv-file" title={f.path}>
                    <span className={`cv-badge cv-badge-${f.kind}`}>{f.kind === "created" ? "new" : f.kind === "removed" ? "del" : "edit"}</span>
                    <span className="cv-file-name">{f.path}</span>
                  </div>
                ))}
              </div>
              <div className="cv-panel-section">
                <div className="cv-panel-title">Commits ({commits.length})</div>
                {commits.length === 0 && <div className="cv-empty-note">No commits yet</div>}
                {commits.map((c) => (
                  <button
                    key={c.hash}
                    type="button"
                    className={`cv-commit ${diff?.rev === c.hash ? "active" : ""}`}
                    onClick={() => void viewDiff(c.hash)}
                  >
                    <code>{c.hash.slice(0, 7)}</code>
                    <span>{c.message}</span>
                  </button>
                ))}
              </div>
              {diff && (
                <div className="cv-panel-section cv-panel-diff">
                  <div className="cv-panel-title">Diff {diff.rev.slice(0, 7)}</div>
                  {diff.loading ? <div className="cv-empty-note">Loading...</div> : <DiffView text={diff.text} />}
                </div>
              )}
            </aside>
          )}
        </div>

        <CodeTerminal
          visible={mode === "terminal"}
          cwd={cwd}
          model={model}
          skillPaths={Array.from(selectedSkills)}
          projectId={projectId}
        />
      </div>
    </div>
  );
}
