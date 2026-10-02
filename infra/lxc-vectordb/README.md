# lxc-vectordb — Qdrant (FR2's RAG store)

Source: requirements doc Part 4 §4.2. Unblocks the "Wire FR2's RAG" item in
[surfaces/web](../../surfaces/web/README.md)'s checklist.

Status: **deployed.** CT `105`, hostname `hubble`, `192.168.1.44`, port `6333`.

## Deploy (run yourself)

Same proven method as `lxc-ui` — clone from `odysseus`'s snapshot, **not** the broken `103`
template (see [infra/README.md](../README.md) for why). Sized per the requirements doc's own
table (2 cores, 8GB RAM, 50GB+ disk — more than the gateway baseline this is cloned from, so
resize proactively rather than waiting for "no space left on device" again):

```bash
# Run on pve:
pct clone 102 <new-id> --full --hostname lxc-vectordb --snapname clean-docker-baseline
pct set <new-id> --net0 name=eth0,bridge=vmbr1,ip=<new-ip>/24,gw=192.168.1.1,type=veth
pct set <new-id> --nameserver "1.1.1.1 8.8.8.8"
pct set <new-id> --cores 2 --memory 8192
pct resize <new-id> rootfs +40G
pct start <new-id>
```

Then inside the container:

```bash
mkdir -p /opt/lxc-vectordb && cd /opt/lxc-vectordb

cat > docker-compose.yaml <<'EOF'
services:
  qdrant:
    image: qdrant/qdrant
    ports: ["6333:6333"]
    volumes: ["qdrant-data:/qdrant/storage"]
volumes: { qdrant-data: {} }
EOF

docker compose up -d
docker compose logs --tail=50
```

Test:

```bash
curl http://localhost:6333/collections
```

Should return `{"result":{"collections":[]},"status":"ok",...}` on first run.

## Wire it into Open WebUI

Admin Panel → Settings → Documents → **Vector Database**: Qdrant, **Qdrant URL**:
`http://192.168.1.44:6333`. Verify with Workspace → Knowledge → create a collection → upload a
test document and confirm it indexes without error.

## Scope note

This is the only other piece of Phase 0 backend pulled into this repo beyond `lxc-gateway` (see
[ADR 0003](../../docs/adr/0003-gateway-config-included-despite-phase-0-scope.md) for why that
exception exists) — pulled in because RAG (FR2) is a real capability gap, not because this repo's
scope has silently expanded back to the whole backend. `lxc-retrieval` (Perplexica/SearxNG, for
FR1 web search) is the next candidate if/when that becomes the priority, same reasoning.
