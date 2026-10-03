import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { getGatewayUrl } from "./gateway";

interface Props {
  visible: boolean;
  cwd: string;
  model: string;
  skillPaths: string[];
  projectId: string;
}

// The original interactive Aider TUI in a real PTY. Kept as the "power user" escape hatch behind
// the Terminal toggle - the chat-first view is the default surface for Code.
export default function CodeTerminal({ visible, cwd, model, skillPaths, projectId }: Props) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const unlistenRef = useRef<UnlistenFn[]>([]);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    if (!containerRef.current || termRef.current) return;
    const term = new Terminal({
      fontFamily: "'Cascadia Code', 'Consolas', monospace",
      fontSize: 13,
      theme: {
        background: "#1a2332",
        foreground: "#fefcf9",
        cursor: "#7a6a52",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    termRef.current = term;
    fitRef.current = fit;

    term.onData((data) => {
      if (sessionIdRef.current) {
        invoke("write_to_code_session", { sessionId: sessionIdRef.current, data }).catch(() => undefined);
      }
    });

    const handleResize = () => {
      try {
        fit.fit();
      } catch {
        return;
      }
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
  }, []);

  // A terminal measured while display:none has no size; refit once it becomes visible.
  useEffect(() => {
    if (!visible) return;
    const id = requestAnimationFrame(() => {
      try {
        fitRef.current?.fit();
      } catch {
        // not laid out yet
      }
    });
    return () => cancelAnimationFrame(id);
  }, [visible]);

  async function start() {
    if (!cwd) {
      setError("Pick a working directory in the toolbar first.");
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
          skill_paths: skillPaths,
          project_id: projectId || null,
        },
      });
      setSessionId(id);
      const unlistenOutput = await listen<string>(`code-output-${id}`, (event) => {
        termRef.current?.write(event.payload);
      });
      const unlistenEnded = await listen(`code-session-ended-${id}`, () => {
        setSessionId(null);
      });
      unlistenRef.current = [unlistenOutput, unlistenEnded];
    } catch (err) {
      setError(typeof err === "string" ? err : err instanceof Error ? err.message : String(err));
    }
  }

  async function stop() {
    if (!sessionId) return;
    await invoke("stop_code_session", { sessionId }).catch(() => undefined);
    setSessionId(null);
  }

  return (
    <div className="cv-terminal" style={{ display: visible ? "flex" : "none" }}>
      <div className="cv-terminal-bar">
        <span className="cv-terminal-hint">
          Interactive Aider in a real terminal, in {cwd || "(no folder chosen)"}
        </span>
        {sessionId ? (
          <button type="button" className="cv-btn cv-btn-stop" onClick={stop}>
            Stop
          </button>
        ) : (
          <button type="button" className="cv-btn cv-btn-primary" onClick={start}>
            Start terminal
          </button>
        )}
      </div>
      {error && <div className="cv-error">{error}</div>}
      <div className="cv-terminal-host" ref={containerRef} />
    </div>
  );
}
