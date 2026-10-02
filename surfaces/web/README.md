# Web surface — Open WebUI integration

Phase 1 of [the roadmap](../../docs/Integrated%20system%20development%20plan.md#5-phased-roadmap).
Status: **deployed** — `lxc-ui` (CT `104`, `192.168.1.43`) is running Open WebUI, pointed at
`lxc-gateway` (CT `102`/`odysseus`, `192.168.1.40`). Full chat responses still depend on `llm01`
finishing its model build-out (see [infra/llm01](../../infra/llm01/)).

## Deployment record

`lxc-ui` was built by cloning the `debian12-docker-base` baseline (Debian 12 + Docker CE + working
`vmbr1` network + DNS fix) directly from `odysseus`'s **snapshot**, not from the `pct template`
conversion of it (`103`) — cloning from that template reproducibly produced a container that
failed to boot (`Permission denied - Failed to exec "/sbin/init"`, empty rootfs on inspection).
Full root-cause and the working method are in [infra/README.md](../../infra/README.md). Use the
snapshot method for any future container needing this same baseline.

```bash
# Run on the Proxmox host:
pct clone 102 <new-id> --full --hostname lxc-ui --snapname clean-docker-baseline
pct set <new-id> --net0 name=eth0,bridge=vmbr1,ip=<new-ip>/24,gw=192.168.1.1,type=veth
pct set <new-id> --nameserver "1.1.1.1 8.8.8.8"
pct start <new-id>
```

Then, inside the container:

```bash
mkdir -p /opt/lxc-ui && cd /opt/lxc-ui

cat > docker-compose.yaml <<'EOF'
services:
  open-webui:
    image: ghcr.io/open-webui/open-webui:main
    ports: ["3000:8080"]
    environment:
      - OPENAI_API_BASE_URL=http://192.168.1.40:4000/v1
      - OPENAI_API_KEY=none
    volumes: ["open-webui-data:/app/backend/data"]
volumes: { open-webui-data: {} }
EOF

docker compose up -d
docker compose logs --tail=50
```

Visit `http://192.168.1.43:3000` to create the admin account and send a test chat message against
`chat-default`/`chat-fast`/`chat-batch`. Until `llm01` finishes its model build-out, expect the
chat request itself to error even with this container healthy — that's `llama-swap` not yet
serving those model names, not a problem with this container.

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
