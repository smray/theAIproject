# lxc-gateway — LiteLLM model-abstraction layer

Source: requirements doc Part 4 §4.2/§4.4. This is the one piece of Phase 0 backend infra
included in this repo despite ADR 0001 scoping the backend out — see
[docs/adr/0003-gateway-config-included-despite-phase-0-scope.md](../../docs/adr/0003-gateway-config-included-despite-phase-0-scope.md)
for why. `llm01` itself (the GPU VM) is **not** covered here — that's already built and out of
scope; this is just the gateway that sits in front of it.

**Network correction:** the requirements doc assumes a dedicated `192.168.100.0/24` segment for
the backend. In reality `llm01` (`copernicus`) is on `vmbr01`, `192.168.1.8` — the main LAN, not a
separate backend-only subnet. `lxc-gateway` is deployed on the same `vmbr01`/`192.168.1.x` network
(needed for internet access during `apt`/`docker` setup anyway — see the troubleshooting notes
further down). All IPs below reflect this actual layout, not the doc's assumed one.

## Prerequisite (for testing, not deployment)

Deploying this doesn't require `llm01` to be fully ready — stand it up any time. But the step-6
test below only fully passes once `llm01` has finished its own build-out (model downloads,
llama.cpp rebuild, and the llama-swap config swap — see
[infra/llm01/README.md](../llm01/README.md)). Until then, expect `chat-default`/`chat-fast`/
`chat-batch` to fail or 404, since `llama-swap` isn't yet serving those exact model names.

## Deploy (run yourself, on the Proxmox host)

### 1. Make sure a Debian 12 template is available

```bash
pveam update
pveam available | grep debian-12
```

(An `unable to open file '.../releases.turnkeylinux.org'` error from `pveam update` is unrelated
to Debian templates — one of several appliance catalogs it refreshes, harmless if it fails.)

**Copy the exact filename the `grep` just printed** — don't reuse a version number from this doc
or a prior run, the point release changes over time (e.g. `12.7-1` vs `12.12-1`) and `pveam
download` rejects anything that doesn't match exactly:

```bash
pveam download local <exact-filename-from-grep-output>
```

### 2. Create the container

Pick a free CT ID first (`pct list` shows what's taken). GUI path, step by step:

- **Datacenter → [your node] → Create CT**
- **General**: CT ID (e.g. `201`), Hostname `lxc-gateway`, set a root password (or paste an SSH
  public key under "SSH Public Key" so you can `ssh` straight in instead of using `pct enter`).
- **Template**: the `debian-12-standard` template from step 1.
- **Disks**: 8GB is plenty (per the sizing table in the requirements doc §4.2).
- **CPU**: 1 core.
- **Memory**: 2048 MiB.
- **Network**: bridge `vmbr0` (adjust if your homelab uses a different bridge name — check
  Datacenter → [node] → Network for the actual name). Set a **static IPv4** on the same subnet as
  `llm01` (`192.168.100.0/24` per the requirements doc) rather than DHCP — the compose files below
  reference this LXC's IP directly, so a DHCP-assigned address that changes later would break
  them. Pick an address you know isn't in use (check your router's DHCP lease list or an existing
  IP-allocation note, don't guess).
- **DNS**: defaults are fine.
- **Confirm → Finish**.

Equivalent one-shot CLI version, if you prefer (adjust every placeholder in angle brackets):

```bash
pct create 201 local:vztmpl/<exact-filename-from-grep-output> \
  --hostname lxc-gateway --cores 1 --memory 2048 --rootfs local-lvm:8 \
  --net0 name=eth0,bridge=vmbr0,ip=<chosen-static-ip>/24,gw=<your-lan-gateway-ip>
```

### 3. Enable nesting + keyctl (needed for Docker inside an unprivileged LXC)

GUI: select the CT → **Options → Features → Edit** → tick **Nesting** and **keyctl** → OK.
CLI equivalent: `pct set 201 --features nesting=1,keyctl=1`.

### 4. Start it and get a shell

```bash
pct start 201
pct enter 201          # root shell directly from the Proxmox host, or:
ssh root@<chosen-static-ip>   # if you set an SSH key in step 2
```

### 5. Install Docker inside the container

Debian's own repos don't carry `docker-compose-plugin` — that comes from Docker's official APT
repo, which also gives you `docker-ce` (a more current engine than Debian's bundled `docker.io`):

```bash
apt update
apt install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
docker compose version   # confirm the plugin is actually present before moving on
```

### 6. Create the deployment files directly (no file transfer needed)

These are small enough to paste straight into the container's shell — replace `<llm01-ip>` with
`copernicus`'s actual LAN IP before running the second block:

```bash
mkdir -p /opt/lxc-gateway && cd /opt/lxc-gateway

cat > docker-compose.yaml <<'EOF'
services:
  litellm:
    image: ghcr.io/berriai/litellm:main-latest
    ports: ["4000:4000"]
    volumes: ["./litellm_config.yaml:/app/config.yaml"]
    command: ["--config", "/app/config.yaml"]
EOF

cat > litellm_config.yaml <<'EOF'
model_list:
  - model_name: chat-default
    litellm_params: { model: openai/interactive, api_base: "http://<llm01-ip>:8080/v1", api_key: "none" }
  - model_name: chat-fast
    litellm_params: { model: openai/fast, api_base: "http://<llm01-ip>:8080/v1", api_key: "none" }
  - model_name: chat-batch
    litellm_params: { model: openai/heavy-batch, api_base: "http://<llm01-ip>:8080/v1", api_key: "none" }
EOF
```

(If you'd rather not retype these at all, `git clone` this repo onto the LXC instead — it's
public at `github.com/smray/theAIproject` — and use the files straight from
`infra/lxc-gateway/`. Either way, edit `<llm01-ip>` before step 7.)

### 7. Bring it up and watch for errors

```bash
docker compose up -d
docker compose logs -f   # watch startup; Ctrl-C to stop following once it looks settled
```

### 8. Test

```bash
curl http://localhost:4000/v1/chat/completions -H "Content-Type: application/json" \
  -d '{"model":"chat-fast","messages":[{"role":"user","content":"hi"}]}'
```

Repeat with `chat-default` and `chat-batch` to confirm all three aliases resolve. Until `llm01`
finishes its own build-out (see the prerequisite note above), expect these to fail or 404 — that's
expected, not a sign anything here is misconfigured.

## Firewall

Per the doc's §4.3: LAN-only `ufw` rule for port 4000, no external exposure needed (only
`lxc-ui`/Open WebUI is a candidate for external access later).

## Next

Once this responds correctly, deploy `surfaces/web`'s Open WebUI compose and point it at this
gateway's IP — see [surfaces/web/README.md](../../surfaces/web/README.md).
