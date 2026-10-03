# Web surface — Open WebUI integration

Phase 1 of [the roadmap](../../docs/Integrated%20system%20development%20plan.md#5-phased-roadmap).
Status: **done — confirmed working end-to-end.** `lxc-ui` (CT `104`, `192.168.1.43`) → `lxc-gateway`
(CT `102`/`odysseus`, `192.168.1.40`) → `llm01`/`copernicus` round-trips real chat responses for
`chat-default` and `chat-fast`. `chat-batch` (the 235B heavy-batch tier) will work once its model
download finishes on `llm01` — not a web-surface issue, see [infra/llm01](../../infra/llm01/).

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
      # Without this, first boot hangs indefinitely on the default embedding model download
      # via HuggingFace's Xet CDN backend, which doesn't complete on this network.
      - HF_HUB_DISABLE_XET=1
      # Vector DB backend is selected at container startup via env var, not in the admin UI.
      - VECTOR_DB=qdrant
      - QDRANT_URI=http://192.168.1.44:6333
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

### Gotchas hit during first setup

- **Disk too small.** A full clone inherits the *source* container's disk size — `odysseus` was
  sized for a lightweight gateway, not Open WebUI's larger image + embedding-model cache. Hit
  "no space left on device" mid-deploy; fixed live with `pct resize <id> rootfs +20G` on the
  Proxmox host, no restart needed.
- **"No models available" in the chat UI despite the connection existing and being enabled** under
  Admin → Settings → Connections. If this happens, re-save the connection entry (even unchanged)
  to force it to re-fetch the model list, and independently verify the gateway itself is actually
  serving the list: `curl http://192.168.1.40:4000/v1/models` from anywhere on the LAN.
- **Entire Admin Settings UI showing raw i18n keys** (`settings.admin.connections.title` instead
  of real text) — **not** a corrupted Docker image (a full image re-pull didn't fix it). Actual
  cause: Open WebUI couldn't find a translation file matching the browser's reported locale (e.g.
  `en-AU`/`en-GB`/`en-NZ` instead of `en-US`) and fell back to showing raw keys instead of
  gracefully defaulting to English. Fixed via the user's own Settings → General → Language,
  forcing it explicitly rather than relying on browser auto-detection.
- **Duplicate connection entry under "Ollama API"** showing the gateway's own URL
  (`http://192.168.1.40:4000/v1`) — wrong, since LiteLLM speaks the OpenAI API shape, not Ollama's.
  Harmless but confusing; remove it, keep only the entry under "OpenAI API".
- **The actual final blocker was on `lxc-gateway`, not here**: LiteLLM silently crash-looped with
  no master key configured (a newer `main-latest` added a startup refusal for this). See
  [infra/README.md](../../infra/README.md)'s LiteLLM section — this is why `curl
  http://192.168.1.40:4000/v1/models` returning nothing was the real signal to chase, not anything
  in Open WebUI's own config.

## Remaining checklist

- [x] Point Open WebUI at the LiteLLM gateway (not `llm01` directly).
- [x] Wire FR2's RAG (Qdrant / `lxc-vectordb`) — deployed at `192.168.1.44:6333` (`hubble`), see
      [infra/lxc-vectordb](../../infra/lxc-vectordb/README.md), wired via `VECTOR_DB`/`QDRANT_URI`
      env vars (not an admin-UI setting). **Confirmed working** — test document indexed via
      Workspace → Knowledge without error.
- [ ] Wire FR9's MCP servers into Open WebUI's settings UI — blocked, no MCP servers deployed
      anywhere in this project yet (`lxc-memory` from the requirements doc §4.2 doesn't exist).
- [x] Deploy FR1's web search (Vane, formerly Perplexica — [the project renamed and
      simplified](../../infra/lxc-retrieval/README.md), bundled SearxNG, no separate search
      container needed as the plan assumed). Deployed at `192.168.1.45:3000`. Embedding: separate
      bookmarked URL, not a tab inside Open WebUI, per the plan's default — revisit only if the
      two-URL experience proves annoying in practice.
- [x] ~~Apply custom.css via Open WebUI's custom CSS setting~~ — **checked against the actual
      source, no such setting exists.** See "Branding reality check" below;
      [custom.css](custom.css) is kept as a reference of intended tokens only, not something you
      can paste in anywhere yet.
- [x] Set `WEBUI_NAME=The AI Project` (the one branding hook that's real — see below).
- [ ] Note the [Open WebUI branding-clause caveat](../../docs/Integrated%20system%20development%20plan.md#2-surface-1--web-endpoint)
      if this ever moves beyond a single household (50-user/30-day threshold).

### Branding reality check

The original plan to paste [custom.css](custom.css) into an admin "Custom CSS" setting was never
actually verified against Open WebUI's code — checked tonight by reading its current source
(`src/app.css`, `admin/Settings/{General,Interface}.svelte`, `chat/Settings/{General,
Personalization}.svelte`, `backend/open_webui/env.py`) and **no such setting exists**: no admin
UI field, no user-settings field, no environment variable, and no theme-overridable CSS custom
properties beyond a handful of internal `--pm-*`/`--app-text-scale` variables unrelated to brand
color. The theme system manipulates Tailwind's own `--color-gray-*` variables programmatically,
not through anything user-facing.

What's actually available, confirmed from the same source read: `WEBUI_NAME` (plain app name,
now set above) and `WEBUI_FAVICON_URL` (needs a web-reachable icon URL — not set, since nothing
in this repo is hosted anywhere the container can fetch from yet; `surfaces/pc/src-tauri/icons/`
has an app icon that could be adapted if this becomes worth the effort later). Real color/font
theming would need a reverse-proxy CSS injection (e.g. nginx `sub_filter`) or a maintained fork —
disproportionate effort for what the plan already calls optional polish, not a blocker. Not
pursued further; this note exists so the next pass doesn't re-attempt the admin-setting route.
