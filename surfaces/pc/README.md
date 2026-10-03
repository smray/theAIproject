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
- **Borderless window**: the native title bar is off (`decorations: false`); the app header is the
  title bar (drag to move, double-click to maximize) with its own minimize / maximize / close.
  Close still hides to the tray. Costs the Windows 11 snap-layouts flyout on the maximize button.
  Page-level scrollbars are gone (the old default body margin pushed the page past 100vh);
  inner scrollbars stay hidden until you hover the scrollable area.
- **Code view**: chat-first ("vibe coding") front end on **Aider**, not a custom-built agentic
  loop (the plan's own documented fallback — §4 says "if [the headless-mode spike] falls short,
  Aider ... is a known-working fallback"; the spike itself was skipped for time, not attempted
  and failed). Pick a folder, describe a change in a composer, and get a transcript with
  rendered prose, per-file **diff cards** for each edit, result chips (files edited, commits
  made), token usage, and a **Changes panel** (live files-changed list from a filesystem watcher,
  commit list, click a commit for its `git show` diff). **Undo** sends Aider's `/undo`. Sessions
  are real now: each is saved (prompt + Aider's record of the turn) and reopening one rebuilds
  the whole transcript. A **Terminal** toggle keeps the original interactive Aider TUI
  (PTY + xterm.js) for power use.
  - *How it runs*: one Aider process **per turn** (`src-tauri/src/code_turn.rs`), not a
    long-lived terminal. A turn ends exactly when the process exits, Stop is a process-tree kill,
    and memory/project/skill context is regenerated every turn. Continuity comes from Aider's
    `--restore-chat-history` with a per-session history file under
    `<app-config-dir>/code-history/`. Cost: roughly 7 seconds of Python/litellm startup per
    turn on the dev machine, small next to local-model generation time.
  - *Where the transcript comes from*: Aider's own chat-history file, not its stdout. Stdout is
    noisy (banner, auto-answered prompts, the reply repeated when Aider auto-adds a file and
    re-asks), so it only drives the transient "working..." view; the final turn is parsed from the
    history record (`src/aiderRecord.ts`) and that same record is what gets stored.
  - *Flags that matter*: `--no-show-model-warnings` is mandatory — with `--yes-always`, Aider
    auto-answers "open documentation url?" and would pop a browser tab every turn.
  - *Edit format*: left at Aider's default for the model. For unknown gateway model names that
    is `whole` (the model rewrites whole files); `diff` is cheaper on big files but weak local
    models often fail at it. Not exposed in the UI yet.
  - *Side effect inherited from Aider*: on first use in a repo Aider adds `.aider*` to
    `.gitignore` (same as the terminal mode always did).
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
  restart. Code view sessions persist too (prompt + Aider's per-turn record, plus the working
  folder in a small `code_sessions` table owned by `code_turn.rs`); the terminal toggle's
  interactive sessions are not recorded.
- **System tray + global shortcut**: closing the window hides it instead of quitting (so an
  in-flight Code session or MCP connection survives an accidental click), a left tray-icon click
  or `Ctrl+Shift+Space` toggles the window from anywhere, and right-click gives Show/Hide + Quit.
  Verified by `cargo check` and by checking every new capability identifier
  (`core:tray:default`, `core:window:allow-hide/show/set-focus`, `global-shortcut:allow-register/
  unregister`) against the installed plugin's own permission manifests — not visually tested (see
  below).
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
- **Agents**: named system-prompt + tool-scope presets (five seeded: General Assistant, Research
  Analyst, Medical/Legal Research Assistant, Software Engineer — all framed as research/advisory,
  explicitly not as a licensed professional making binding decisions), selectable from a dropdown
  in Chat, with a full CRUD **Agents** tab to create/edit/delete custom ones. An agent with
  `use_research_tool` set gets a CrossRef journal-search tool merged into the chat's tool-calling
  loop alongside any connected MCP tools. The MCP-server checklist on an agent scopes which
  connected MCP tools it can see — leave it empty for no restriction (every default agent ships
  that way), or check specific servers to limit an agent to only those.
- **Projects**: named standing instructions ("this chat is about the homelab migration"), with a
  **Projects** tab to create/edit them and an optional working directory. Scoping a Chat session
  to a project injects its instructions as a leading system message; scoping a Code session to
  one auto-fills the working directory and reads the same instructions in via `--read`
  (`project-context.md`), the same mechanism memory context already uses — one unique-intersection
  feature shared by both views instead of being Chat-only.
- **File attachments (Chat)**: drag a text/code file onto the Chat pane (or use the paperclip
  button) to attach it as context for the next message. Deliberately text-only — read via the
  browser's own `FileReader`, no Tauri fs permission or vision/base64 plumbing involved — and
  capped at ~50k characters per file with a truncation note rather than silently blowing out the
  context window. Binary extensions are rejected with an error rather than being read as garbled
  text.
- **Autonomous mode (Chat)**: a 🧠 toolbar toggle that raises the tool-calling loop's turn cap
  from 8 to 25 and adds a system instruction to keep calling tools until the task is actually
  done rather than stopping after one call. Mostly a thinner feature than it sounds — the
  tool-calling loop already supported a configurable turn cap, this just exposes it — and it only
  changes anything when at least one tool (an agent's research tool, or a connected MCP server)
  is actually available; with no tools, Chat still falls back to a single-turn streamed answer
  regardless of this toggle.

## What was actually verified (read this before trusting it)

- ✅ **Core engine confirmed working end-to-end, outside the GUI**: ran Aider directly
  (`aider --openai-api-base http://192.168.1.40:4000/v1 --model openai/chat-fast --message "..."`)
  against a scratch git repo. It connected through the gateway, got a real model response, wrote
  a file, and committed it. This is the single biggest risk the plan flagged, and it works.
- ✅ Rust backend: `cargo build` (not just `check`) completed a real dev build and linked
  `target/debug/tauri-app.exe` successfully, including the new tray-icon/global-shortcut code
  paths. Frontend (`tsc` + `vite build`) also compiles clean.
- ✅ **Chat-first Code view, checked without touching the home network**: (1) the output parser
  (`aiderRecord.ts`) was run against real Aider 0.86.2 output, including a failure case (lint
  reflection loop); (2) Rust unit tests for the helpers, plus an `#[ignore]`d integration test
  (`aider_turn_against_mock`) that spawns **real Aider** in a temp git repo against a throwaway
  localhost mock of the OpenAI endpoint and asserts exit code 0, the edit applied, a commit made,
  live output events and a file-changed event (`cargo test aider_turn_against_mock -- --ignored`
  with `AI_PROJECT_TEST_MOCK_URL` and `AI_PROJECT_AIDER_PATH` set); (3) the React view was
  rendered in a real browser against a fake Tauri backend replaying that captured output —
  empty states, live streaming, diff cards, Changes panel, commit diff, session reload, New
  session, the unreachable-gateway error, and the Terminal toggle all behaved. This verifies the
  view and the Rust turn runner separately; it is not the same as using the installed app.
- ❌ **Not verified for the chat-first Code view**: the packaged Tauri window driving a real
  turn through the real gateway and model (including how well your local models cope with Aider's
  edit formats), and the Stop button killing a real process tree.
- ❌ **The actual Tauri window — PTY terminal rendering, xterm.js input/output wiring, the
  Chat/Code tab switch, the skill picker, the hooks panel — has not been visually tested.** There
  is no way to drive a native GUI window from the environment this was built in. The individual
  pieces (Rust PTY spawning, event emission, xterm.js, the React state) are each a known,
  standard pattern, correctly wired as far as static review can confirm, but **"it compiles" is
  not "it works" for a GUI** — the same lesson this project's own
  [GIT-AND-BUILD-LESSONS.md](../../docs/GIT-AND-BUILD-LESSONS.md) already recorded from
  KiwiProductivity's Gradle work. **Actually opening the app and running a real Code session is
  the first real test.**
- This environment does have a computer-use tool capable of driving a real desktop window (it's
  how the Android emulator verification in [the Android surface's
  README](../android/README.md) got done), so this is no longer a hard blocker, just not done
  yet — it requires an explicit on-screen permission grant from whoever is at the keyboard, which
  isn't appropriate to force through unattended. Next session with the user present: `npm run
  tauri dev` from this folder, then grant computer-use access to drive the actual window.

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
2. The path saved by the Code view's **Locate aider.exe** button (`<app-config-dir>/aider-path.txt`;
   the file is validated by running `aider --version` before it is saved). This is the setting to
   use for an installed app — the Code view shows a banner with the button whenever nothing is
   found, instead of failing on the first prompt.
3. `aider-env/Scripts/aider.exe` next to the folder the app was **built** from (`CARGO_MANIFEST_DIR`
   is baked in at compile time) — works in `tauri dev`, but an installer built from some other
   folder (e.g. a clean checkout) points at a path that doesn't have the venv.
4. `aider` on `PATH` — works if Aider is installed globally (`pip install aider-chat` without a
   venv) or `aider-env\Scripts` is added to `PATH` manually.

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
- **Code view runs one turn at a time** — you can keep many saved sessions and switch between
  them, but a running turn must finish (or be stopped) before starting or switching.
- **Aider is not bundled** — external prerequisite, see above.
- **RAG, MCP tool use, web search** — not reimplemented here; those are Open WebUI/`lxc-retrieval`
  territory per the web surface, not duplicated in this app.
- **No actual GUI testing performed** — see "What was actually verified" above. This is the most
  important limitation to internalize before relying on this.
