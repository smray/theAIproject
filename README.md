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
                  (llm01 expansion steps, lxc-gateway/LiteLLM) — see ADR 0003
surfaces/web/     Open WebUI integration (Phase 1 — config, not new code)
surfaces/android/ RikkaHub configuration (Phase 2 — config, not new code)
surfaces/pc/      Tauri app: Chat view (Phase 3) + Code view (Phase 4) + hooks/skills (Phase 5)
```

Backend (Phase 0 — gateway, retrieval, memory, orchestration) is mostly out of this repo's scope;
it's built per the [requirements spec](docs/Best%20LLM%20features%20system%20requirements.md)'s
Part 4 elsewhere (`llm01`, the GPU VM, is already live). The one exception is `infra/lxc-gateway`,
which this repo does include because Open WebUI can't be configured without it — see
[ADR 0003](docs/adr/0003-gateway-config-included-despite-phase-0-scope.md).

## Status

**Phase 1 (web) done** — confirmed working end-to-end (Open WebUI → LiteLLM gateway → `llm01`),
see [surfaces/web/README.md](surfaces/web/README.md). Remaining Phase 1 extras (RAG/MCP wiring,
branding) are optional polish, not blockers — see that file's checklist. **Phase 2 (Android)** has
concrete steps written up in [surfaces/android/README.md](surfaces/android/README.md) but hasn't
been installed/tested yet. **Phase 3+ (PC app)** hasn't started.

## Contributing

Solo-developer project; see [CONTRIBUTING.md](CONTRIBUTING.md) for branching and commit
conventions.
