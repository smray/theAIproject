# The AI Project

Three clients — web, Android, PC — against one shared backend contract (LiteLLM gateway,
orchestration, memory, MCP registry). See
[docs/Integrated system development plan.md](docs/Integrated%20system%20development%20plan.md)
for the full plan and phased roadmap.

- Engineering plan / roadmap: [docs/Integrated system development plan.md](docs/Integrated%20system%20development%20plan.md)
- Architecture decisions: [docs/adr/](docs/adr/)
- Git hygiene & build lessons (carried over from KiwiProductivity): [docs/GIT-AND-BUILD-LESSONS.md](docs/GIT-AND-BUILD-LESSONS.md)
- Design tokens (colour/type/spacing, sourced from the Threshold Consulting brand guidelines — see [ADR 0002](docs/adr/0002-design-system-source.md)): [design/design-tokens.md](design/design-tokens.md)

## Repo layout

```
docs/             Plan, ADRs, git/build lessons
design/           Shared design tokens (colour, type, spacing)
surfaces/web/     Open WebUI integration (Phase 1 — config, not new code)
surfaces/android/ RikkaHub configuration (Phase 2 — config, not new code)
surfaces/pc/      Tauri app: Chat view (Phase 3) + Code view (Phase 4) + hooks/skills (Phase 5)
```

Backend (Phase 0 — gateway, retrieval, memory, orchestration) is out of this repo's scope; it's
built per the requirements spec's Part 4 elsewhere. This repo starts at Phase 1.

## Status

Everything is pre-Phase-1. See each `surfaces/*/README.md` for that surface's checklist.

## Contributing

Solo-developer project; see [CONTRIBUTING.md](CONTRIBUTING.md) for branching and commit
conventions.
