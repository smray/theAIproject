# 0001 — Repo layout, surface boundaries, git hosting

Status: accepted

## Context

[Integrated system development plan](../Integrated%20system%20development%20plan.md) defines
three client surfaces (web, Android, PC) against one shared backend contract, with each surface
at a different point on the build-vs-adopt spectrum: Web and Android are integration work against
existing open-source clients (Open WebUI, RikkaHub); the PC app is the only surface with genuine
new engineering (Tauri shell + embedded coding-agent engine + the hooks/skills layer). The repo
layout needs to keep that asymmetry visible rather than forcing all three into one shape.

[KiwiProductivity](https://github.com/smray/KiwiProductivity) (a prior solo-developer project by
the same author) already worked through the git-hygiene and monorepo questions this project would
otherwise re-litigate — see
[docs/GIT-AND-BUILD-LESSONS.md](../GIT-AND-BUILD-LESSONS.md) for what carries over.

## Decision

- **Repo layout:** single monorepo, one top-level folder per surface
  (`surfaces/web`, `surfaces/android`, `surfaces/pc`), plus shared `docs/` (plans, ADRs) and
  `design/` (the shared design-token system, §see ADR 0002). Not split repos — there is one
  shared backend contract (gateway, orchestration, memory, MCP registry) and three thin clients;
  splitting repos now would just create cross-repo version drift for a solo-developer project,
  same reasoning as KiwiProductivity's ADR 0001.
- **Surface contents reflect the plan's own build-vs-adopt split:**
  - `surfaces/web/` — Open WebUI configuration (pointed at the gateway) + Perplexica/Vane
    integration notes. No application code expected here.
  - `surfaces/android/` — RikkaHub configuration notes now; becomes a Gradle/Kotlin project only
    if a fork becomes necessary (e.g. to patch a gap RikkaHub doesn't cover). Treat that as a new
    ADR when/if it happens, not a default.
  - `surfaces/pc/` — the Tauri shell (Rust core + webview, two views: Chat and Code) and, inside
    it, the embedded coding-agent engine (Pi or Zero per the plan's §4 recommendation) plus the
    hooks/skills layer. This is where real application code lives.
- **Git hosting:** GitHub, `github.com/smray/theAIproject`, same trunk-based workflow as
  KiwiProductivity (see CONTRIBUTING.md): `main` always deployable, short-lived branches, no PR
  required for a solo-developer project but CI must be green before merging to `main`.
- **Commit convention:** Conventional Commits, enforced by commitlint + a husky `commit-msg`
  hook, at the repo root — applies across all three surfaces regardless of each surface's
  language (TS/JS, Kotlin, Rust), same as KiwiProductivity.

## Consequences

- Phase 0 (backend: gateway, retrieval, memory, orchestration) is explicitly out of this repo's
  scope — it lives wherever Part 4 of the requirements spec builds it, not here. This repo starts
  at Phase 1.
- Because `surfaces/web` and `surfaces/android` are integration/config rather than from-scratch
  apps, they won't have their own CI jobs until there's actual code to lint/test. `surfaces/pc`
  gets CI (lint/typecheck/test, and eventually a Tauri build check) as soon as it has a scaffold.
- An Android Gradle/Kotlin build only enters this repo if `surfaces/android` stops being pure
  configuration (i.e. a RikkaHub fork). The lessons in
  [docs/GIT-AND-BUILD-LESSONS.md](../GIT-AND-BUILD-LESSONS.md) should be read before that work
  starts, not discovered by repeating KiwiProductivity's Gradle debugging.
