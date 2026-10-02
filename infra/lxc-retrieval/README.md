# lxc-retrieval — Vane (formerly Perplexica), bundled SearxNG (FR1/FR4)

Source: requirements doc Part 4 §4.2, **corrected** — see below.

## The project renamed and simplified since the requirements doc was written

`ItzCrazyKns/Perplexica` is now `ItzCrazyKns/Vane` (confirmed via the GitHub API's redirect — the
old name/URL still works but 301s). More importantly, the architecture changed: the default
`itzcrazykns1337/vane:latest` image **bundles SearxNG inside the same container** — no separate
SearxNG service needed, contrary to the plan's assumption of `lxc-retrieval` running "its own
SearxNG instance" as a distinct piece. Configuration also moved from a `config.toml` file (edited
before first run) to a **web-based setup wizard** on first visit to the app itself.

This means deployment here is simpler than the plan describes: one container, one compose file,
configure via browser on first load — not a repo clone + config file edit + separate SearxNG
container.

(A slim image, `itzcrazykns1337/vane:slim-latest`, exists for pointing at an *external* SearxNG
instance instead — not used here since the bundled image is simpler and there's no other SearxNG
consumer in this project yet.)

## Deploy (run yourself)

Same proven method as the other LXCs — clone from `odysseus`'s snapshot, not the broken `103`
template (see [infra/README.md](../README.md)):

```bash
# Run on pve:
pct clone 102 <new-id> --full --hostname lxc-retrieval --snapname clean-docker-baseline
pct set <new-id> --net0 name=eth0,bridge=vmbr1,ip=192.168.1.45/24,gw=192.168.1.1,type=veth
pct set <new-id> --nameserver "1.1.1.1 8.8.8.8"
pct set <new-id> --cores 2 --memory 4096
pct resize <new-id> rootfs +20G
pct start <new-id>
```

Then inside the container:

```bash
mkdir -p /opt/lxc-retrieval && cd /opt/lxc-retrieval

cat > docker-compose.yaml <<'EOF'
services:
  vane:
    image: itzcrazykns1337/vane:latest
    ports: ["3000:3000"]
    volumes: ["vane-data:/home/vane/data"]
    restart: unless-stopped
volumes: { vane-data: {} }
EOF

docker compose up -d
docker compose logs --tail=50
```

## Configure (one-time, in browser)

Visit `http://192.168.1.45:3000` — first load shows a setup screen. Configure the AI provider:

- **Base URL**: `http://192.168.1.40:4000/v1` (the gateway, never `llm01` directly — same rule as
  every other surface)
- **API key**: `none` (no master key configured on the gateway yet — see
  [infra/README.md](../README.md)'s LiteLLM section)
- **Model**: `chat-fast` (per the plan's §4.2 recommendation — cheap/fast tier for search-query
  decomposition and synthesis, not the heavy-batch tier)

## Embedding into the web surface

Per [the integrated plan](../../docs/Integrated%20system%20development%20plan.md#2-surface-1--web-endpoint),
default to a separate bookmarked URL (`http://192.168.1.45:3000`) rather than embedding as a tab
inside Open WebUI — revisit only if the two-URL experience proves annoying in practice.
