# Web surface — Open WebUI integration

Phase 1 of [the roadmap](../../docs/Integrated%20system%20development%20plan.md#5-phased-roadmap).
Status: **in progress.**

## Prerequisite

[`infra/lxc-gateway`](../../infra/lxc-gateway/) must be deployed first — Open WebUI points at the
gateway, never at `llm01` directly (requirements doc Part 4 §4.2). The gateway container can be
up before `llm01`'s model downloads finish; you just won't get a real chat response here until
both are ready — fine to deploy this now and test later.

## Deploy (run yourself, on the Proxmox host)

1. Create the `lxc-ui` LXC (same nesting/keyctl setup as `lxc-gateway`), install Docker.
2. Copy this folder's `docker-compose.yaml` onto it.
3. **Edit it: replace `<lxc-gateway-ip>` with the gateway LXC's actual LAN IP.**
4. `docker compose up -d`
5. Visit `http://<lxc-ui-ip>:3000`, create the local admin account, and send a test chat message
   against `chat-default` (and `chat-fast`/`chat-batch` if you want to confirm all three aliases
   are selectable) — confirms the gateway contract end-to-end (the actual point of this phase,
   per the plan's §2).

## Remaining checklist

- [x] Point Open WebUI at the LiteLLM gateway (not `llm01` directly).
- [ ] Wire FR2's RAG (Qdrant / `lxc-vectordb`) and FR9's MCP servers into Open WebUI's settings UI
      — depends on `lxc-vectordb` existing (not yet deployed; separate infra step, see the
      requirements doc §4.2/§4.4 build order).
- [ ] Decide Perplexica/Vane embedding (tab inside Open WebUI vs. separate bookmarked URL) —
      default to the separate URL per the plan; only revisit if that proves annoying in practice.
      Depends on `lxc-retrieval` (not yet deployed).
- [ ] Apply [custom.css](custom.css) (the shared [design tokens](../../design/design-tokens.md))
      via Open WebUI's custom CSS setting, once the base instance is confirmed working.
- [ ] Note the [Open WebUI branding-clause caveat](../../docs/Integrated%20system%20development%20plan.md#2-surface-1--web-endpoint)
      if this ever moves beyond a single household (50-user/30-day threshold).
