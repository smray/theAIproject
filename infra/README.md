# Infra — Proxmox lessons

Operational lessons specific to this project's Proxmox host (`pve`), separate from
[docs/GIT-AND-BUILD-LESSONS.md](../docs/GIT-AND-BUILD-LESSONS.md) (which covers git/Gradle
pitfalls, not infra ones). See [infra/llm01](llm01/) and [infra/lxc-gateway](lxc-gateway/) for the
actual deployment configs.

## `pct clone --full` from a `pct template`-converted container can silently produce an empty rootfs

**Symptom:** container fails to start with `Permission denied - Failed to exec "/sbin/init"` in
`lxc-start`'s debug log (`lxc-start -n <ID> -F -l DEBUG -o /tmp/debug.log`), despite `pct clone`
itself reporting a full, successful rsync transfer (correct byte counts, no errors). Mounting the
new container's rootfs (`pct mount <ID>`) shows it genuinely empty or missing core paths like
`/sbin` — not a permissions issue, the content just isn't there.

**Root cause (as reproduced on this host):** converting a container to a template with
`pct template <ID>` repoints its storage volume into a thin-provisioned "base" image for linked
clones. On this host's storage backend, a subsequent `pct clone --full` *from that template*
doesn't reliably materialize the base volume's actual filesystem content before rsyncing from it —
reproduced twice in a row, both times identically. Mounting the template directly (`pct mount
<template-ID>`) shows its content is completely fine; the bug is specifically in cloning *from*
a templated volume, not in the template's own data.

**Fix: skip `pct template` entirely for cloning purposes.** Take a snapshot of the source
container instead, and clone from the snapshot every time, rather than converting to a template:

```bash
# One-time, on the source container (replace 102/clean-docker-baseline with your own):
pct snapshot 102 clean-docker-baseline --description "whatever baseline this represents"

# Every subsequent clone, from the snapshot - NOT from a pct template conversion:
pct clone 102 <new-id> --full --hostname <new-hostname> --snapname clean-docker-baseline
pct set <new-id> --net0 name=eth0,bridge=vmbr1,ip=<new-ip>/24,gw=192.168.1.1,type=veth
pct start <new-id>
```

This reproduced cleanly as a working container on the first try, versus two failed attempts
cloning from the equivalent template.

**A template conversion (`103`/`debian12-docker-base` in this project) still exists** as a record
of the attempt and in case this is a version-specific bug worth re-testing after a Proxmox
upgrade — but don't clone from it. Use the snapshot-based method above for any new container that
needs this baseline (Debian 12 + Docker CE + working `vmbr1` network + DNS fix).

## Network layout differs from the requirements doc's assumption

The requirements doc assumes a dedicated `192.168.100.0/24` segment for backend services. In
reality: `llm01`/`copernicus` and the LXCs built in this repo (`lxc-gateway`/`odysseus`,
`lxc-ui`) are all on `vmbr1`, `192.168.1.0/24` — the main LAN, not a separate backend subnet. The
`192.168.100.0/24` segment that does exist on this network (visible in the Cisco switch's
`ADSL_LAN_IN` ACL) is a separate, more restrictive management segment, not where these containers
live. See [docs/adr/0003-gateway-config-included-despite-phase-0-scope.md](../docs/adr/0003-gateway-config-included-despite-phase-0-scope.md).

## Docker's `daemon.json` `"dns"` setting does not affect image-pull DNS resolution

`daemon.json`'s `"dns"` key only configures DNS *inside containers Docker creates* — it has no
effect on how the Docker daemon itself resolves registry hostnames (e.g. `ghcr.io`) when pulling
an image. That resolution happens in the host's own network namespace using the host's system
resolver config. If `docker pull`/`docker compose up` fails on DNS while `nslookup`/`getent`
succeed against the same server from the host, the fix is changing the actual host-level DNS
config (on this project, via `pct set <CTID> --nameserver "<ip> <ip>"` on the Proxmox host, since
Proxmox manages LXC `resolv.conf` and will overwrite a manual edit) — not `daemon.json`.

## Known-good static IPs in use on `vmbr1`/`192.168.1.0/24`

| Host | IP | Role |
|---|---|---|
| `copernicus` (`llm01`) | `192.168.1.42` | GPU VM, llama.cpp + llama-swap on :8080 |
| `odysseus` (`lxc-gateway`) | `192.168.1.40` | LiteLLM gateway on :4000 |
| `lxc-ui` | `192.168.1.43` | Open WebUI on :3000 |

Gateway for this subnet is `192.168.1.1` (**not** `192.168.1.2`/`NSW01` — that's the Cisco
switch's management address, which only permits narrow admin traffic per its `ADSL_LAN_IN` ACL,
not general routing).
