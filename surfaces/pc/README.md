# PC surface — Tauri app (Chat + Code views)

Phases 3–5 of [the roadmap](../../docs/Integrated%20system%20development%20plan.md#5-phased-roadmap).
Status: **not started.** This is the only surface with genuine new engineering — see the plan's
§4 for why (adopted agentic-coding engine + a from-scratch hooks/skills layer on top of it).

## Phase 3 — Chat view only

- [ ] Scaffold a [Tauri](https://tauri.app) app (Rust core, native per-OS webview — chosen over
      Electron for binary size / idle resource use, since this may run alongside an actual coding
      workload, not just idle in the tray).
- [ ] Chat view: thin client to the gateway, same contract as the web/Android surfaces — a
      native-feeling re-implementation of Open WebUI's basic chat UX, not its full feature set.
- [ ] Apply the [shared design tokens](../../design/design-tokens.md) as the webview's base
      stylesheet.
- [ ] Deliberately proves the shell + chat contract work together *before* Phase 4 adds the
      coding engine, so a shell bug is never confused with an engine-integration bug.

## Phase 4 — Code view

- [ ] One-week spike (load-bearing for this phase's whole estimate, per the plan's §6 risks):
      verify Pi or Zero's headless mode actually exposes what a custom GUI needs (structured tool
      calls, diffs, plan steps — not just terminal text to re-parse).
- [ ] Embed the chosen engine (Pi or Zero preferred; Aider via an embedded terminal pane as the
      known-working fallback if the spike fails).
- [ ] Any change touching `tauri.conf.json` or `Cargo.toml` needs a real `tauri build`/`cargo
      build` run before calling it verified — `cargo check` alone is not proof, same principle as
      the Gradle lesson in [docs/GIT-AND-BUILD-LESSONS.md](../../docs/GIT-AND-BUILD-LESSONS.md)
      item 4.

## Phase 5 — Hooks/skills layer

- [ ] Build FR8 (hooks/skills as named constructs) on top of the working Code view. This is the
      one piece of real new engineering the plan calls out explicitly — the agentic *loop* is
      covered by the adopted engine; hooks/skills as governance over that loop are not.

No scaffold exists yet. When Phase 3 starts, this folder gets its own `package.json`/`Cargo.toml`
and its own CI job (lint/typecheck/test, eventually a Tauri build check) — see
[docs/adr/0001-repo-layout-and-stack.md](../../docs/adr/0001-repo-layout-and-stack.md).
