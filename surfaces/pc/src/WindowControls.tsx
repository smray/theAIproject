import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

// The native title bar is turned off (decorations: false in tauri.conf.json) so the app header
// doubles as the title bar. Closing hides to the tray - see the CloseRequested handler in lib.rs.
export default function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    try {
      const win = getCurrentWindow();
      const sync = () => {
        win.isMaximized().then(setMaximized).catch(() => undefined);
      };
      sync();
      win
        .onResized(sync)
        .then((fn) => {
          if (cancelled) fn();
          else unlisten = fn;
        })
        .catch(() => undefined);
    } catch {
      // Not running inside Tauri (e.g. a browser preview) - controls are inert.
    }
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  function run(action: "minimize" | "toggleMaximize" | "close") {
    try {
      getCurrentWindow()[action]().catch(() => undefined);
    } catch {
      // not in Tauri
    }
  }

  return (
    <div className="win-controls">
      <button type="button" className="win-btn" onClick={() => run("minimize")} title="Minimize" aria-label="Minimize">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5h10" stroke="currentColor" strokeWidth="1" fill="none" />
        </svg>
      </button>
      <button
        type="button"
        className="win-btn"
        onClick={() => run("toggleMaximize")}
        title={maximized ? "Restore" : "Maximize"}
        aria-label={maximized ? "Restore" : "Maximize"}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z" stroke="currentColor" strokeWidth="1" fill="none" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect x=".5" y=".5" width="9" height="9" stroke="currentColor" strokeWidth="1" fill="none" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="win-btn win-close"
        onClick={() => run("close")}
        title="Close (keeps running in the tray)"
        aria-label="Close"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" fill="none" />
        </svg>
      </button>
    </div>
  );
}
