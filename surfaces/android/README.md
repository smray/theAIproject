# Android surface — RikkaHub configuration

Phase 2 of [the roadmap](../../docs/Integrated%20system%20development%20plan.md#5-phased-roadmap).
Status: **in progress** — Phase 1 (web) is live (`lxc-gateway` + `lxc-ui` deployed), so the gateway
contract is already validated against a real client before this one depends on it.

Per the plan, this is adoption, not a build — nothing here runs on the homelab, it's entirely
configuration on your phone:

- [ ] Install [RikkaHub](https://github.com/rikkahub/rikkahub) (AGPL-3.0) — grab the latest APK
      from its [GitHub Releases](https://github.com/rikkahub/rikkahub/releases) (check F-Droid
      too, in case it's listed there now) and sideload it (Android will prompt to allow installs
      from that source the first time).
- [ ] Add a custom provider pointing at the gateway, not `llm01` directly — same rule as every
      other surface:
  - **Base URL**: `http://192.168.1.40:4000/v1`
  - **API key**: any placeholder (e.g. `none`) — the gateway has no master key configured yet, so
    nothing is actually checked. Revisit this once the gateway is ever exposed beyond the LAN.
  - **Models**: `chat-default`, `chat-fast`, `chat-batch` — the three aliases from
    `infra/lxc-gateway/litellm_config.yaml`. `chat-batch` (the heavy-batch/235B tier) will time
    out or error until `llm01` finishes that model's download — expected for now, not a RikkaHub
    problem.
- [ ] MCP tool integration — **blocked**, not yet actionable: no MCP servers are deployed anywhere
      in this project yet (`lxc-memory` from the requirements doc's Part 4 §4.2 doesn't exist).
      Revisit once at least one MCP server exists to point RikkaHub at.
- [ ] Custom HTTP auth headers — not needed yet; only relevant once the gateway is reachable
      beyond bare LAN access (see the Cloudflare Tunnel discussion — currently deferred).
- [ ] Match the [shared design tokens](../../design/design-tokens.md) as closely as RikkaHub's
      own theming allows (likely Material You / light-dark only — confirm what's actually exposed
      once the app is installed).
- [ ] Fallback if a gap matters in practice: Open WebUI's installable PWA, pointed at
      `http://192.168.1.43:3000` (`lxc-ui`) — zero additional build cost, less native feel — keep
      as backup, not default.

**If a RikkaHub fork ever becomes necessary**, that's a new ADR (see
[docs/adr/0001-repo-layout-and-stack.md](../../docs/adr/0001-repo-layout-and-stack.md)) and this
folder becomes a real Gradle/Kotlin project — read
[docs/GIT-AND-BUILD-LESSONS.md](../../docs/GIT-AND-BUILD-LESSONS.md) first. Remember: AGPL-3.0
means any modification distributed as a running network service must be released; irrelevant for
personal use, relevant the moment this is shared beyond the household.
