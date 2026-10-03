# PC surface — Tauri app (Chat + Code views)

Phases 3–5 of [the roadmap](../../docs/Integrated%20system%20development%20plan.md#5-phased-roadmap).
Status: **Chat view (Phase 3) and a working Code view (Phase 4) are both built.** A basic
hooks/skills layer (Phase 5) is built on top. This compresses what the plan scoped as three
separate phases — including an explicit one-week spike before Phase 4 even started — into one
overnight push, at the user's explicit direction to not stop at phase boundaries. Read the
"What was actually verified" section below before trusting any of this in a real workflow.

## What's here

- **Tauri 2 + React 19 + TypeScript**, two views sharing one window: **Chat** (unchanged from the
  original Phase 3 build) and **Code** (new).
- **Code view**: a real PTY-backed terminal (via the `portable-pty` Rust crate, rendered with
  xterm.js) running **Aider**, not a custom-built agentic loop. This is the plan's own documented
  fallback — §4 of the integrated plan says "if [the headless-mode spike] falls short, Aider via
  an embedded terminal pane is a known-working fallback that loses some polish but not
  functionality." The spike itself (verifying whether Pi/Zero's headless mode exposes what a GUI
  needs) was skipped entirely for time, not attempted and failed — going straight to the
  documented fallback was a deliberate choice, not a retreat from a failed attempt.
- **Hooks**: approximated, not a true re-implementation of Claude Code's pre/post-tool-use
  interception. Aider is a black-box interactive process — individual tool calls inside it aren't
  observable or interceptable. What's real: **session-start** (runs before Aider launches),
  **session-stop** (runs after it exits), and **post-file-change** (a filesystem watcher on the
  working directory, standing in for "post-tool-use" since file edits are Aider's dominant tool
  call). Configured via the ⚓ button in the Code view, stored as
  `<app-config-dir>/hooks.json`.
- **Skills**: a folder of `.md` files (`<app-config-dir>/skills/`, auto-created with a README on
  first run). Each one gets attached to an Aider session as read-only context via `--read` when
  selected in the UI — a reasonable approximation of "on-demand loaded instruction" but without
  Claude Code's actual progressive-disclosure mechanics (near-zero cost until invoked) — every
  selected skill's full content loads into context immediately, there's no lazy/partial loading.
- **Session persistence (Chat)**: every conversation is saved to a local SQLite database
  (`<app-config-dir>/data.db`, via `rusqlite`), with a sidebar to browse, resume, and delete past
  chats — added after the first build shipped with none of this and lost history on every
  restart. Code view gets a lighter version: a history *record* (working directory, model, when)
  is saved per session, but not a message-by-message transcript — Aider already writes its own
  `.aider.chat.history.md` inside the working directory, which is the actual conversation record
  for that surface, so this doesn't duplicate it.
- **Memory (FR7-lite)**: the same typed schema the requirements doc specifies for Claude Code's
  own auto-memory (`user` / `feedback` / `project` / `reference` categories), stored in the same
  SQLite database, with a **Memory** tab to view/add/delete entries by hand. Automatically
  injected as a system-prompt preamble into every new Chat message and every new Code session
  (via an extra `--read` file for Aider). **Auto-capture is a best-effort heuristic, not a real
  mechanism**: the system prompt asks the model to end a reply with a `[MEMORY:category] ...`
  line when it decides something's worth remembering, and the frontend detects and strips that
  line, saving it to the store — this depends entirely on the model actually following the
  instruction reliably, which hasn't been tested across many real conversations. The manual
  add/delete UI in the Memory tab is the reliable path; the auto-capture is a nice-to-have on top.

## What was actually verified (read this before trusting it)

- ✅ **Core engine confirmed working end-to-end, outside the GUI**: ran Aider directly
  (`aider --openai-api-base http://192.168.1.40:4000/v1 --model openai/chat-fast --message "..."`)
  against a scratch git repo. It connected through the gateway, got a real model response, wrote
  a file, and committed it. This is the single biggest risk the plan flagged, and it works.
- ✅ Rust backend (`cargo build`) and frontend (`tsc` + `vite build`) both compile clean.
- ❌ **The actual Tauri window — PTY terminal rendering, xterm.js input/output wiring, the
  Chat/Code tab switch, the skill picker, the hooks panel — has not been visually tested.** There
  is no way to drive a native GUI window from the environment this was built in. The individual
  pieces (Rust PTY spawning, event emission, xterm.js, the React state) are each a known,
  standard pattern, correctly wired as far as static review can confirm, but **"it compiles" is
  not "it works" for a GUI** — the same lesson this project's own
  [GIT-AND-BUILD-LESSONS.md](../../docs/GIT-AND-BUILD-LESSONS.md) already recorded from
  KiwiProductivity's Gradle work. **Actually opening the app and running a real Code session is
  the first real test.**

## Setting up Aider (required for the Code view — not bundled)

A Python venv isn't portable — it embeds absolute paths back to the Python installation that
created it (`pyvenv.cfg`), so copying one into the installer and running it on a different
machine/path would just break. Properly solving that means a frozen standalone build (e.g.
PyInstaller) — not attempted tonight. Instead, Aider is an external prerequisite, same as any
other CLI tool:

```bash
# This machine already has this set up at surfaces/pc/aider-env (Python 3.12 venv - 3.14 was
# too new, several of Aider's dependencies had no prebuilt wheels for it yet):
py -3.12 -m venv surfaces/pc/aider-env
surfaces/pc/aider-env/Scripts/python.exe -m pip install --upgrade pip setuptools wheel
surfaces/pc/aider-env/Scripts/python.exe -m pip install aider-chat
```

The Rust backend (`src-tauri/src/code_session.rs`, `resolve_aider_path()`) looks for it in order:
1. `AI_PROJECT_AIDER_PATH` env var, if set (exact path to `aider.exe`).
2. `aider-env/Scripts/aider.exe` next to the project root — works automatically in `tauri dev`.
3. `aider` on `PATH` — works for the packaged/installed app, if Aider is installed globally
   (`pip install aider-chat` without a venv) or `aider-env\Scripts` is added to `PATH` manually.

If none of these resolve, starting a Code session fails with a clear error in the UI rather than
a cryptic spawn failure.

## Run it (development)

```bash
cd surfaces/pc
npm install
npm run tauri dev
```

## Build a release installer

```bash
cd surfaces/pc
npm run tauri build
```

Output: `src-tauri/target/release/bundle/nsis/*.exe` and `.../bundle/msi/*.msi`.

## Capability scope — update this if the gateway's IP ever changes

`src-tauri/capabilities/default.json` explicitly allow-lists `http://192.168.1.40:*/*` for the
HTTP plugin (used by Chat). The Code view's gateway access goes through Aider's own process (a
separate OS process with its own network access, not subject to Tauri's capability system at
all), so this scope only affects Chat.

## Known limitations / explicitly not done

- **No true tool-call-level hooks** — see the Hooks section above for what's real vs.
  approximated.
- **Skills have no lazy-loading** — full content loads immediately on selection, not on-demand.
- **Auto-memory capture is a prompted heuristic, not a real mechanism** — see the Memory section
  above. Untested across real usage; may not fire reliably.
- **No multi-session support in Code view** — one Aider session at a time per app instance (the
  backend's `CodeSessionState` is a `HashMap` so it technically *could* hold several, but the UI
  only drives one).
- **Aider is not bundled** — external prerequisite, see above.
- **RAG, MCP tool use, web search** — not reimplemented here; those are Open WebUI/`lxc-retrieval`
  territory per the web surface, not duplicated in this app.
- **No actual GUI testing performed** — see "What was actually verified" above. This is the most
  important limitation to internalize before relying on this.
