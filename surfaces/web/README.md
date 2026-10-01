# Web surface — Open WebUI integration

Phase 1 of [the roadmap](../../docs/Integrated%20system%20development%20plan.md#5-phased-roadmap).
Status: **not started.**

Per the plan, this is integration work on an already-built UI, not new development:

- [ ] Point an Open WebUI instance at the LiteLLM gateway (`chat-default`/`chat-fast`/`chat-batch`
      aliases), not at the model host directly.
- [ ] Wire FR2's RAG (Qdrant) and FR9's MCP servers into Open WebUI's settings UI.
- [ ] Decide Perplexica/Vane embedding (tab inside Open WebUI vs. separate bookmarked URL) —
      default to the separate URL per the plan; only revisit if that proves annoying in practice.
- [ ] Apply the shared [design tokens](../../design/design-tokens.md) via Open WebUI's custom CSS
      setting.
- [ ] Note the [Open WebUI branding-clause caveat](../../docs/Integrated%20system%20development%20plan.md#2-surface-1--web-endpoint)
      if this ever moves beyond a single household (50-user/30-day threshold).

No application code is expected to live in this folder — deployment/config notes and any custom
CSS only.
