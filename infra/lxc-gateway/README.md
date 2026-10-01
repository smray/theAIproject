# lxc-gateway — LiteLLM model-abstraction layer

Source: requirements doc Part 4 §4.2/§4.4. This is the one piece of Phase 0 backend infra
included in this repo despite ADR 0001 scoping the backend out — see
[docs/adr/0003-gateway-config-included-despite-phase-0-scope.md](../../docs/adr/0003-gateway-config-included-despite-phase-0-scope.md)
for why. `llm01` itself (the GPU VM) is **not** covered here — that's already built and out of
scope; this is just the gateway that sits in front of it.

## Prerequisite

`llm01` must already be reachable with all three model tiers responding — see
[infra/llm01/README.md](../llm01/README.md) for that checklist (only the `fast` tier is confirmed
working from the original build; `interactive` and `heavy-batch` are new). Confirm its `curl` loop
passes before deploying this.

## Deploy (run yourself, on the Proxmox host)

1. Create the LXC (Debian 12 template), enable **nesting** and **keyctl** under
   Datacenter → container → Options → Features (needed since this runs as a Docker container
   inside an unprivileged LXC).
2. Inside the LXC: `apt install -y docker.io docker-compose-plugin`.
3. Copy this folder's two files (`docker-compose.yaml`, `litellm_config.yaml`) onto the LXC.
4. **Edit `litellm_config.yaml`: replace `<llm01-ip>` with `llm01`'s actual LAN IP** (check this
   on the Proxmox host or `llm01` itself, e.g. `ip a` on `llm01` — not something to infer or
   probe for from elsewhere).
5. `docker compose up -d`
6. Test directly before anything else depends on it (per the doc's build order, step 3):
   ```bash
   curl http://localhost:4000/v1/chat/completions -H "Content-Type: application/json" \
     -d '{"model":"chat-fast","messages":[{"role":"user","content":"hi"}]}'
   ```
   Repeat with `chat-default` and `chat-batch` to confirm all three aliases resolve.

## Firewall

Per the doc's §4.3: LAN-only `ufw` rule for port 4000, no external exposure needed (only
`lxc-ui`/Open WebUI is a candidate for external access later).

## Next

Once this responds correctly, deploy `surfaces/web`'s Open WebUI compose and point it at this
gateway's IP — see [surfaces/web/README.md](../../surfaces/web/README.md).
