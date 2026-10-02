# The AI Project

Three clients — web, Android, PC — against one shared backend contract (LiteLLM gateway,
orchestration, memory, MCP registry). See
[docs/Integrated system development plan.md](docs/Integrated%20system%20development%20plan.md)
for the full plan and phased roadmap.

- Engineering plan / roadmap: [docs/Integrated system development plan.md](docs/Integrated%20system%20development%20plan.md)
- Backend requirements spec (Parts 1–4, incl. the Proxmox/llm01 build order): [docs/Best LLM features system requirements.md](docs/Best%20LLM%20features%20system%20requirements.md)
- Architecture decisions: [docs/adr/](docs/adr/)
- Git hygiene & build lessons (carried over from KiwiProductivity): [docs/GIT-AND-BUILD-LESSONS.md](docs/GIT-AND-BUILD-LESSONS.md)
- Proxmox-specific infra lessons (templating bugs, actual network layout, known-good IPs): [infra/README.md](infra/README.md)
- Design tokens (colour/type/spacing, sourced from the Threshold Consulting brand guidelines — see [ADR 0002](docs/adr/0002-design-system-source.md)): [design/design-tokens.md](design/design-tokens.md)

## Repo layout

```
docs/             Plan, ADRs, git/build lessons
design/           Shared design tokens (colour, type, spacing)
infra/            Thin slice of Phase 0 backend config that Phase 1+ genuinely depends on
                  (llm01, lxc-gateway/LiteLLM, lxc-vectordb/Qdrant, lxc-retrieval/Vane) — ADR 0003
surfaces/web/     Open WebUI integration (Phase 1 — config, not new code)
surfaces/android/ RikkaHub configuration (Phase 2 — config, not new code)
surfaces/pc/      Tauri app: Chat view (Phase 3) + Code view (Phase 4) + hooks/skills (Phase 5)
```

Backend (Phase 0 — gateway, retrieval, memory, orchestration) is mostly out of this repo's scope;
it's built per the [requirements spec](docs/Best%20LLM%20features%20system%20requirements.md)'s
Part 4 elsewhere (`llm01`, the GPU VM, is already live). The exceptions are `infra/lxc-gateway`
(Open WebUI can't be configured without it) and `infra/lxc-vectordb` (RAG is a real capability
gap worth closing, not cosmetic) — see
[ADR 0003](docs/adr/0003-gateway-config-included-despite-phase-0-scope.md).

## Status

**Phase 1 (web) done** — confirmed working end-to-end (Open WebUI → LiteLLM gateway → `llm01`),
RAG (Qdrant) and web search (Vane) both deployed too, see
[surfaces/web/README.md](surfaces/web/README.md). Remaining extras there (MCP wiring, branding)
are optional polish, not blockers. **Phase 2 (Android)** has concrete steps written up in
[surfaces/android/README.md](surfaces/android/README.md) but hasn't been installed/tested yet.
**Phase 3 (PC app, Chat view)** is built and packaged. **Phase 4 (Code view)** is built too —
Aider in a real PTY terminal, confirmed working end-to-end outside the GUI (connected through the
gateway, wrote a file, committed it) — skipping the plan's one-week headless-mode spike for
Pi/Zero by going straight to the documented Aider fallback. **Phase 5 (hooks/skills)** has a
working approximation on top (process-lifecycle + filesystem-watch hooks, `--read`-attached
skill files). **None of this has been visually tested in the actual GUI** — see
[surfaces/pc/README.md](surfaces/pc/README.md)'s "What was actually verified" section before
trusting it further than that.

## Contributing

Solo-developer project; see [CONTRIBUTING.md](CONTRIBUTING.md) for branching and commit
conventions.
