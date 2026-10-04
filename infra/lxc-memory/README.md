# lxc-memory — Postgres (FR7's shared typed memory store)

Astronomer name: `kepler` (CT `107`, `192.168.1.46`).

Source: requirements doc Part 4 §4.2. Scoped deliberately narrow here: the plan says "Postgres
(FR7) + MCP servers (FR9)," but which MCP servers FR9 actually needs was left open in the plan
itself ("whichever MCP servers FR9 needs running as sidecar processes"). This deploy covers just
the Postgres half — a real, concrete, well-specified piece — rather than guessing at MCP server
choices that are a real decision for later, not something to invent silently.

**This is a separate store from the PC app's local memory.** The PC app (`surfaces/pc`) already
has its own per-device SQLite memory table (`db.rs`, the Memory tab) and keeps using it — nothing
here changes that. `lxc-memory` exists so a *shared* store becomes possible later (something every
surface, not just one device, can read/write), but nothing is wired to it yet; that's follow-up
work once there's an actual consumer (e.g. an MCP server fronting this DB that Chat/Open
WebUI/RikkaHub can all call).

Status: **not yet deployed** — this doc was written to deploy it; update this line once it's live.

## Deploy (run yourself)

Same proven method as the other LXCs — clone from `odysseus`'s snapshot, not the broken `103`
template (see [infra/README.md](../README.md)). Sized per the requirements doc's own table (1
core, 4GB RAM, 30GB disk):

```bash
# Run on pve:
pct clone 102 107 --full --hostname kepler --snapname clean-docker-baseline
pct set 107 --net0 name=eth0,bridge=vmbr1,ip=192.168.1.46/24,gw=192.168.1.1,type=veth
pct set 107 --nameserver "1.1.1.1 8.8.8.8"
pct set 107 --cores 1 --memory 4096
pct start 107
```

Then inside the container (`pct enter 107`):

```bash
mkdir -p /opt/lxc-memory && cd /opt/lxc-memory

cat > docker-compose.yaml <<'EOF'
services:
  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      - POSTGRES_USER=memory
      - POSTGRES_PASSWORD=CHANGE_ME
      - POSTGRES_DB=memory
    ports: ["5432:5432"]
    volumes: ["memory-data:/var/lib/postgresql/data"]
volumes: { memory-data: {} }
EOF

docker compose up -d
docker compose logs --tail=20
```

**Change `CHANGE_ME` to a real password before running this** — unlike the LiteLLM gateway (which
doesn't check its API key at all on this LAN-trust setup), Postgres actually enforces its
password, and this file shouldn't carry a real secret once it's something other than a local
placeholder. Don't commit the real password into this repo if you edit this file later with the
actual value — keep `CHANGE_ME` here and set the real one only in the container's own
`docker-compose.yaml`, same pattern as `infra/lxc-gateway/litellm_config.yaml`'s
`dangerously_permit_weak_or_unset_master_key` note.

Create the typed-memory schema (same four categories the PC app's local store already uses —
`user` / `feedback` / `project` / `reference` — so the shape is consistent if/when something
syncs between the two):

```bash
docker compose exec postgres psql -U memory -d memory -c "
CREATE TABLE memories (
    id SERIAL PRIMARY KEY,
    category TEXT NOT NULL CHECK (category IN ('user','feedback','project','reference')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"
```

Test:

```bash
docker compose exec postgres psql -U memory -d memory -c "\dt"
```

Should list the `memories` table.

## Firewall (LAN-only, per §4.3)

No external exposure needed — same as every other backend piece in this stack:

```bash
ufw allow from 192.168.1.0/24 to any port 5432
```

## Scope note

Postgres only, deliberately. The MCP-server half of FR9 (which servers, what they expose, whether
they run as sidecars in this same container or get their own) is a real design decision for a
separate pass — see the top of this doc. Once that's decided, this file should grow a "Wire it
into Chat/MCP" section the way [lxc-vectordb](../lxc-vectordb/README.md) has one for Open WebUI.
