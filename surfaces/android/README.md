# Android surface — RikkaHub configuration

Phase 2 of [the roadmap](../../docs/Integrated%20system%20development%20plan.md#5-phased-roadmap).
Status: **not started.** Depends on Phase 1 (web) being live first, so the gateway contract is
already validated against a real client before a second one depends on it.

Per the plan, this is adoption, not a build:

- [ ] Install [RikkaHub](https://github.com/rikkahub/rikkahub) (AGPL-3.0).
- [ ] Point it at `http://<gateway-ip>:4000/v1`, same contract as the web surface.
- [ ] Configure MCP tool integration and any custom HTTP headers the gateway needs for auth.
- [ ] Match the [shared design tokens](../../design/design-tokens.md) as closely as RikkaHub's
      own theming allows (likely Material You / light-dark only — confirm when this phase
      starts).
- [ ] Fallback if a gap matters in practice: Open WebUI's installable PWA (zero additional build
      cost, less native feel) — keep as backup, not default.

**If a RikkaHub fork ever becomes necessary**, that's a new ADR (see
[docs/adr/0001-repo-layout-and-stack.md](../../docs/adr/0001-repo-layout-and-stack.md)) and this
folder becomes a real Gradle/Kotlin project — read
[docs/GIT-AND-BUILD-LESSONS.md](../../docs/GIT-AND-BUILD-LESSONS.md) first. Remember: AGPL-3.0
means any modification distributed as a running network service must be released; irrelevant for
personal use, relevant the moment this is shared beyond the household.
