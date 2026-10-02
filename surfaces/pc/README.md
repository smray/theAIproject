# PC surface — Tauri app (Chat view)

Phases 3–5 of [the roadmap](../../docs/Integrated%20system%20development%20plan.md#5-phased-roadmap).
Status: **Phase 3 (Chat view) built** — Tauri + React + TypeScript, scaffolded and functional.
Phases 4 (Code view/agentic engine) and 5 (hooks/skills) are not started — see those sections of
the plan for why they're bigger, riskier pieces of work (the Phase 4 headless-mode spike in
particular is explicitly flagged as load-bearing for that phase's whole estimate).

## What's here

- **Tauri 2 + React 19 + TypeScript**, scaffolded via `create-tauri-app` (`react-ts` template).
- **Chat view only** — a thin client to the gateway, same contract as the web/Android surfaces,
  streaming responses via SSE. Not a re-implementation of Open WebUI's full feature set (RAG,
  Knowledge, admin settings) — just chat, per the plan's explicit scope for this phase.
- **`src/gateway.ts`** — the gateway client. Uses `@tauri-apps/plugin-http`'s `fetch`, not the
  browser's own `fetch`, specifically because Tauri's HTTP plugin runs the request through the
  Rust backend rather than the webview — this sidesteps CORS entirely (LiteLLM's default CORS
  config is unknown/untested for a bare webview origin, so this avoids depending on it) but means
  the target URL must be explicitly allow-listed in `src-tauri/capabilities/default.json`.
- **`src/tokens.css`** — the shared [design tokens](../../design/design-tokens.md), duplicated
  here (not a shared import, since this is a separate build pipeline from Open WebUI's) — keep
  the two in sync by hand if the palette changes.
- Gateway URL is configurable at runtime (gear icon → Settings panel), persisted to
  `localStorage`, defaulting to `http://192.168.1.40:4000/v1` (`odysseus`/`lxc-gateway` — see
  [infra/README.md](../../infra/README.md)'s known-good IP table). Model list is fetched from the
  gateway's `/v1/models` on load; falls back to the three known aliases
  (`chat-default`/`chat-fast`/`chat-batch`) if the gateway isn't reachable yet.

## Capability scope — update this if the gateway's IP ever changes

`src-tauri/capabilities/default.json` explicitly allow-lists `http://192.168.1.40:*/*` for the
HTTP plugin. This is intentionally narrow (not a LAN-wide wildcard) since the exact wildcard
behavior for raw IP-address hostname patterns wasn't verified against this Tauri version — see
the plugin's own `scope.rs` test suite if this needs revisiting. **If `odysseus`'s IP changes,
this file needs updating and the app rebuilt** — the in-app Settings panel only changes where
`fetch` calls are *sent*, not what the Rust-side scope permits sending them *to*.

## Run it (development)

Prerequisites: Node.js, Rust (`rustup`), and on Windows — MSVC Build Tools + WebView2 (both were
already present on this machine; see `rustup`/`cargo` install notes in
[docs/GIT-AND-BUILD-LESSONS.md](../../docs/GIT-AND-BUILD-LESSONS.md) if setting up fresh).

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

Output lands in `src-tauri/target/release/bundle/` — on Windows, both an NSIS `.exe` installer
and an MSI are produced by default (`bundle.targets: "all"` in `tauri.conf.json`). This is the
actual "double-click to install" artifact — not `npm run tauri dev`, which just runs it directly
without producing anything installable.

## Known limitations (Phase 3 scope, not bugs)

- No Code view (Phase 4) — chat only.
- No message persistence across app restarts — each launch starts a fresh conversation. Adding
  local history storage is natural Phase 3 follow-up work, not scoped into this initial build.
- No RAG/Knowledge, no MCP tool use, no web search — those are Open WebUI-specific features (or
  Phase 4/5 territory for this surface), not reimplemented here.
- Error handling is minimal: a dismissable banner on request failure, no retry logic.

## Phase 4 — Code view (not started)

Per the plan's §4: one-week spike first, load-bearing for this whole phase's estimate — verify
whether Pi or Zero's headless mode actually exposes what a custom GUI needs (structured tool
calls, diffs, plan steps — not just terminal text to re-parse) before embedding either. Aider via
an embedded terminal pane is the documented fallback if that spike fails.

## Phase 5 — Hooks/skills layer (not started)

Builds on a working Code view. The one piece of genuinely new engineering this plan calls out
explicitly (per the requirements doc's Part 2 §5 gap analysis) — not available off-the-shelf in
any surveyed orchestration framework.
