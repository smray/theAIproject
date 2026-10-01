# 0003 — `lxc-gateway` config included in this repo despite Phase 0 being out of scope

Status: accepted

## Context

[ADR 0001](0001-repo-layout-and-stack.md) scoped Phase 0 (backend: gateway, retrieval, memory,
orchestration) entirely out of this repo — "Prerequisite for everything below; not part of this
plan's scope." In practice, starting Phase 1 (Open WebUI) surfaced a gap: `llm01` (the GPU VM) is
already built per the requirements doc's Part 4, but `lxc-gateway` (LiteLLM) — also nominally
"Phase 0" — had never been deployed, and Open WebUI cannot be meaningfully configured without it,
since the requirements doc is explicit that Open WebUI points at the gateway, never at `llm01`
directly.

## Decision

- Include `infra/lxc-gateway/` (a `docker-compose.yaml` + `litellm_config.yaml`, copied near-
  verbatim from the requirements doc's Part 4 §4.2) in this repo, as the minimum backend
  component genuinely load-bearing for Phase 1.
- Do **not** pull in the rest of Phase 0 (`lxc-vectordb`, `lxc-retrieval`, `lxc-studio`,
  `lxc-orchestration`, `lxc-memory`) the same way — those are only needed by later Phase 1
  checklist items (RAG, Perplexica/Vane) or later phases entirely, and pulling them in now would
  re-expand this repo's scope back to the whole backend, which ADR 0001 deliberately avoided.
- `llm01` itself (the GPU-passthrough VM and its three-tier model config) stays fully out of
  scope — it's already built, and rebuilding/documenting it here would duplicate the requirements
  doc rather than reference it.
- All infra files here are deployed by the user directly on the Proxmox host, not by an agent
  session connecting to the homelab — see
  [docs/GIT-AND-BUILD-LESSONS.md](../GIT-AND-BUILD-LESSONS.md) for why (no automated/SSH-driven
  deployment to infrastructure outside this repo's own working directory, without the user's
  explicit per-action go-ahead).

## Consequences

- `infra/` now exists as a top-level folder (not anticipated in ADR 0001) specifically for the
  thin slice of backend config that Phase 1+ genuinely depends on. Expect it to grow one LXC at a
  time, pulled in only when a specific surface checklist item needs it (e.g. `lxc-vectordb` when
  RAG wiring starts), not all at once.
- This slightly blurs ADR 0001's "backend is out of scope" line — worth remembering that the line
  was never "zero backend config ever," it was "don't duplicate Part 4's engineering effort here."
  Config files that are just copies of what Part 4 already specifies don't violate that; writing
  new backend logic in this repo would.
