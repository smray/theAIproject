# Web surface — Open WebUI integration

Phase 1 of [the roadmap](../../docs/Integrated%20system%20development%20plan.md#5-phased-roadmap).
Status: **in progress.**

## Prerequisite

[`infra/lxc-gateway`](../../infra/lxc-gateway/) must be deployed first — Open WebUI points at the
gateway, never at `llm01` directly (requirements doc Part 4 §4.2). The gateway container can be
up before `llm01`'s model downloads finish; you just won't get a real chat response here until
both are ready — fine to deploy this now and test later.

## Deploy (run yourself, on the Proxmox host)

Same mechanics as `lxc-gateway` — see [infra/lxc-gateway/README.md](../../infra/lxc-gateway/README.md)
steps 1–5 for the full Debian-template/CT-creation/nesting/Docker-install walkthrough if you need
the detail again. Summarized for this container:

1. **Create the CT**: next free CT ID (e.g. `202`), hostname `lxc-ui`, 2 cores, 4096 MiB memory,
   20GB disk (per the requirements doc §4.2 sizing table), static IP on the same
   `192.168.100.0/24` subnet (e.g. one past whatever you picked for `lxc-gateway`).
2. **Enable nesting + keyctl** (Options → Features, or `pct set 202 --features nesting=1,keyctl=1`).
3. **Start it, get a shell** (`pct start 202` then `pct enter 202` or `ssh`).
4. **Install Docker**: `apt update && apt install -y docker.io docker-compose-plugin && systemctl enable --now docker`.
5. **Create the compose file directly** — replace `<lxc-gateway-ip>` with the gateway LXC's actual
   static IP from its own creation step before running this:

   ```bash
   mkdir -p /opt/lxc-ui && cd /opt/lxc-ui

   cat > docker-compose.yaml <<'EOF'
   services:
     open-webui:
       image: ghcr.io/open-webui/open-webui:main
       ports: ["3000:8080"]
       environment:
         - OPENAI_API_BASE_URL=http://<lxc-gateway-ip>:4000/v1
         - OPENAI_API_KEY=none
       volumes: ["open-webui-data:/app/backend/data"]
   volumes: { open-webui-data: {} }
   EOF
   ```

   (Or `git clone` this repo onto the LXC and use `surfaces/web/docker-compose.yaml` directly —
   same either way, just edit `<lxc-gateway-ip>` first.)
6. **Bring it up**: `docker compose up -d`, then `docker compose logs -f` to confirm it starts
   cleanly (first run pulls the image, can take a minute).
7. **Visit `http://<lxc-ui-ip>:3000`**, create the local admin account, and send a test chat
   message against `chat-default` (and `chat-fast`/`chat-batch` if you want to confirm all three
   aliases are selectable) — confirms the gateway contract end-to-end (the actual point of this
   phase, per the plan's §2). Until `llm01` finishes its own build-out, expect the chat request
   itself to error even once this container is healthy — that's `llama-swap` not yet serving
   those model names, not a problem with this container.

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
