# Android surface — RikkaHub configuration

Phase 2 of [the roadmap](../../docs/Integrated%20system%20development%20plan.md#5-phased-roadmap).
Status: **verified end-to-end** — installed on a real Android emulator (`Pixel_6a`), configured a
custom provider pointed at the gateway, and got a real model response back through
`http://192.168.1.40:4000/v1` (see "Verification attempt" below). Not just documented blind.

Per the plan, this is adoption, not a build — nothing here runs on the homelab, it's entirely
configuration on your phone:

- [ ] Install [RikkaHub](https://github.com/rikkahub/rikkahub) (AGPL-3.0) — grab the latest APK
      from its [GitHub Releases](https://github.com/rikkahub/rikkahub/releases) (check F-Droid
      too, in case it's listed there now) and sideload it (Android will prompt to allow installs
      from that source the first time).
- [x] Add a custom provider pointing at the gateway, not `llm01` directly — same rule as every
      other surface:
  - **Base URL**: `http://192.168.1.40:4000/v1`
  - **API key**: any placeholder (e.g. `none`) — the gateway has no master key configured yet, so
    nothing is actually checked. Revisit this once the gateway is ever exposed beyond the LAN.
  - **Models**: `chat-default`, `chat-fast`, `chat-batch` — the three aliases from
    `infra/lxc-gateway/litellm_config.yaml`. `chat-batch` (the heavy-batch/235B tier) will time
    out or error until `llm01` finishes that model's download — expected for now, not a RikkaHub
    problem.
  - **Also required, separate from provider config**: add a model entry (e.g. `chat-default`) and
    set it as RikkaHub's global default **Chat Model** under its own model-selection setting — the
    provider alone isn't enough to actually send a message, confirmed by getting a "no model
    selected"-style block until this was done too.
- [ ] MCP tool integration — **blocked**, not yet actionable: no MCP servers are deployed anywhere
      in this project yet (`lxc-memory` from the requirements doc's Part 4 §4.2 doesn't exist).
      Revisit once at least one MCP server exists to point RikkaHub at.
- [ ] Custom HTTP auth headers — not needed yet; only relevant once the gateway is reachable
      beyond bare LAN access (see the Cloudflare Tunnel discussion — currently deferred).
- [x] Match the [shared design tokens](../../design/design-tokens.md) as closely as RikkaHub's
      own theming allows. **Checked against RikkaHub's actual source** (not the "likely Material
      You only" guess this item started as) — Settings → Theme has a real custom-theme editor
      (`CustomTheme` data class: `primaryColorArgb`/`secondaryColorArgb`/`tertiaryColorArgb`,
      Material 3 dynamic color generation from those three seeds) with JSON import/export of a
      single theme object. [rikkahub-theme.json](rikkahub-theme.json) is that exact format,
      mapping `--accent`/`--slate`/`--accent-light` from the design tokens onto
      primary/secondary/tertiary — paste its contents into Settings → Theme → Import to apply.
      Not yet actually applied on a device (same caveat as the rest of this doc — written against
      real source, not yet re-run through the emulator to confirm the import dialog behaves as
      read).
- [ ] Fallback if a gap matters in practice: Open WebUI's installable PWA, pointed at
      `http://192.168.1.43:3000` (`lxc-ui`) — zero additional build cost, less native feel — keep
      as backup, not default.

## Verification attempt (emulator)

This dev machine has a real Android SDK + emulators already set up (`Pixel_10_Pro`, `Pixel_6a` —
leftover from KiwiProductivity), so rather than leave this surface purely documented-but-untested
like everything Android-related had been all session, it got an actual test pass:

- ✅ **RikkaHub 2.5.6 (arm64-v8a) installed and launched cleanly** on `Pixel_6a` (an x86_64 Google
  Play image — its ARM translation layer handled the arm64-only APK fine, no separate x86 build
  needed).
- ✅ **The Settings → Providers → Add Provider screen matches this doc's assumptions exactly**:
  Name / API Key / API Base URL / API Path fields, OpenAI-compatible format selectable — confirms
  the configuration steps above are pointed at real, existing UI, not a guess.
- ✅ **Full end-to-end round trip confirmed, in a follow-up pass.** The provider was saved
  correctly (the earlier automation flakiness below was from an initial attempt, not a dead end),
  a `chat-default` model entry was added and set as RikkaHub's global default Chat Model (a
  separate, required step — see the checklist above), and a real message sent from RikkaHub on
  the emulator got a real response back from `chat-default` through the gateway
  (`http://192.168.1.40:4000/v1`, ~15 tokens in / 10 out, ~11.6s). This is the first genuine
  Android end-to-end verification this project has had — not just "the screen matches," an actual
  model response arrived.
- **Known cosmetic gap, not blocking**: RikkaHub also has a separate "Fast Model" setting (used
  for auto-generating chat titles) that's still unset. Doesn't affect normal chat use.
- Earlier in this verification, driving the Add Provider dialog via blind `adb shell input
  tap`/`text` coordinates was genuinely unreliable (it repositions vertically with keyboard
  visibility, so captured coordinates silently missed in a different state) — documented here
  since it's a real lesson for any future `adb`-coordinate automation attempt, even though the
  provider ended up saved correctly. Proper mobile UI automation would use a real framework
  (Espresso/UIAutomator with resource-id-based element matching, not raw pixel taps).
- **Known leftover**: a harmless duplicate, unconfigured "OpenAI" provider entry exists in the
  emulator's RikkaHub install from an earlier partial attempt (still showing default
  `api.openai.com`, "0 models"). Not connected to anything, doesn't affect the real setup above.
  Delete it manually if continuing from this emulator state.

**What this means in practice**: the written instructions above are now confirmed correct against
a real device, start to finish — provider config, model selection, and an actual response through
the gateway. The remaining gap is purely "a person still has to tap through these same steps on
their own phone," not "these steps might not work."

**If a RikkaHub fork ever becomes necessary**, that's a new ADR (see
[docs/adr/0001-repo-layout-and-stack.md](../../docs/adr/0001-repo-layout-and-stack.md)) and this
folder becomes a real Gradle/Kotlin project — read
[docs/GIT-AND-BUILD-LESSONS.md](../../docs/GIT-AND-BUILD-LESSONS.md) first. Remember: AGPL-3.0
means any modification distributed as a running network service must be released; irrelevant for
personal use, relevant the moment this is shared beyond the household.
