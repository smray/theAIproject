# Integrated system development plan — web, Android, PC

This is a development plan for productizing the backend already specified in `Best LLM features system requirements.md` (Parts 2–4) across three client surfaces: a web endpoint, an Android app, and a PC app combining Claude-Code-like agentic coding with the web endpoint's chat functionality. It assumes that backend — LiteLLM gateway, llama-swap on the Tesla M40 box, retrieval/orchestration/memory services — is live per Part 4's build order. Nothing here duplicates that work; this plan is strictly about the three things that call it.

## 1. The one decision that governs everything else: a single shared backend contract

All three surfaces are clients of the same API, never three separate chat implementations. Concretely, each surface talks to:

- **Chat/completion** — the LiteLLM gateway's OpenAI-compatible endpoint (`chat-default`/`chat-fast`/`chat-batch` aliases from Part 4 §4.2), already vendor-neutral by construction.
- **Agentic task execution** — the orchestration service (`lxc-orchestration`, FR5/FR6), exposed as its own API rather than folded into the chat endpoint, because coding tasks need a different interaction shape (streaming tool-call events, not just token streams).
- **Memory/preferences** — FR7's store, so a preference set from the phone is visible from the PC app and vice versa.
- **MCP tool registry** — FR9, so any tool connected once is available to every surface, not re-registered per client.

Whichever surface is built first will, in practice, define the exact shape of this contract. Treat that as deliberate (§5, Phase 1) rather than letting it happen by accident in whichever codebase gets there first.

## 2. Surface 1 — Web endpoint

**Decision: Open WebUI, already selected in the requirements spec's Part 3 component design — this is integration work, not new development.** Its UX is explicitly modeled on ChatGPT's, so "similar feel to other LLMs" is satisfied by the choice itself rather than something to design.

Remaining work is narrow:
- Point it at the gateway, not at `llm01` directly (Part 4 §4.2 — already specified).
- Wire FR2's RAG (Qdrant) and FR9's MCP servers into its settings UI.
- Decide whether Perplexica/Vane (FR1/FR4) is embedded as a tab inside Open WebUI or left as a separate bookmarked URL — the latter is less work and is the recommended starting point; revisit only if the two-URL experience proves annoying in practice.
- **License note:** Open WebUI's license added a clause in April 2025 restricting branding changes above 50 individual users in a rolling 30-day window ([Open WebUI license](https://docs.openwebui.com/license/); [Aliteq: the 50-user branding clause](https://aliteq.com/open-webui-license-explained-2026)). A single-household deployment is nowhere near that threshold, so this is a non-issue now — but it's the reason to keep this in mind if "household" ever becomes "small team."

**Effort: low.** This phase exists mainly to validate the gateway contract end-to-end before the harder surfaces depend on it.

## 3. Surface 2 — Android app

**Decision: adopt RikkaHub rather than build.** It's a native Android client, open source (AGPL-3.0), with 7,400+ GitHub stars, that already does exactly what's being asked: it speaks OpenAI/Google/Anthropic-shaped APIs (so it talks to the gateway with no code changes on either side), supports MCP tool integration natively, handles multimodal input, and offers message branching and custom HTTP headers for auth — the last of which matters once the gateway is behind anything beyond bare LAN access.

- Configuration, not development: point RikkaHub at `http://<gateway-ip>:4000/v1`, same as Open WebUI.
- AGPL-3.0 means modifications distributed as a network service must be released — irrelevant for personal use, relevant only if this is ever shared beyond the household as a running service others connect to.
- Fallback if RikkaHub has a gap that matters in practice: Open WebUI's own installable PWA, at zero additional build cost but a less native feel — keep this as a backup, not the default plan.

**Effort: near-zero build**, same reasoning as Surface 1 — a second independent client exercising the same contract is valuable precisely because it's cheap, and it will surface any assumption Surface 1 accidentally baked in (e.g., a header or response shape Open WebUI tolerates but a stricter client doesn't).

## 4. Surface 3 — PC app (the one surface that's genuinely new development)

This is the only surface where "similar functionality to Claude Code" has no single drop-in answer, because it's two different jobs wrapped in one app: general chat (same contract as Surfaces 1–2) and agentic coding (file/shell tool-use, multi-step autonomous execution, the Claude Code analogue from the requirements spec's Part 1).

**Don't build the coding engine from scratch.** The requirements spec already found that the *core* agentic loop (gather-context → act → verify with tool use) is well-covered by existing open-source projects — it's specifically hooks and skills as named constructs that are the genuine gap (Part 2 §5), not the loop itself. Adopt an engine for the loop; build the hooks/skills layer on top of it as the one piece of real new engineering.

**Candidate engines**, compared on the dimension that actually matters for embedding inside a custom app — whether they can be driven programmatically (headless) versus requiring a terminal UI:

| Engine | License | Model-agnostic | Embeddable (headless) | Notes |
|---|---|---|---|---|
| **Aider** | Apache 2.0 | Yes — any OpenAI-compatible endpoint | Partial — CLI-first, scriptable but not designed as a library | Most proven/battle-tested; simplest path if an embedded terminal pane is acceptable instead of deep GUI integration |
| **Cline** | Apache 2.0 | Yes, incl. local Ollama/LM Studio-class endpoints | No — VS Code extension, not standalone | Plan/Act modes and MCP support are architecturally the closest match to Claude Code's model, but it brings VS Code as a dependency rather than fitting inside a custom shell |
| **OpenHands** (formerly OpenDevin) | Open source, self-hostable | Yes | No — runs as a platform (Docker/Kubernetes-isolated agents), not an embeddable process | Most autonomous/capable option; heaviest to integrate, better suited to a backend batch-agent role than a responsive desktop pane |
| **Pi** | MIT | Yes, 15+ providers incl. Ollama/OpenRouter | **Yes — explicit headless mode** | Tree-structured sessions, MCP support, minimal core |
| **Zero** | MIT | Yes, 25+ providers incl. local | **Yes — explicit headless mode** | Single Go binary, worktree isolation, no telemetry |

(All five per [OpenAlternative's Claude Code alternatives roundup](https://openalternative.co/alternatives/claude-code).)

**Recommendation: Pi or Zero as the embedded engine, Aider as the fallback.** Headless mode is what lets a custom GUI drive the engine's tool-use loop and render its own UI around the results, rather than shelling out to a terminal emulator inside the app (which works, but means re-deriving structured state — diffs, tool calls, plan steps — from terminal text rather than an API). Treat "does headless mode actually expose everything the GUI needs" as a one-week spike before committing, since neither has been verified firsthand in this research pass — if it falls short, Aider via an embedded terminal pane is a known-working fallback that loses some polish but not functionality.

**Shell: Tauri, not Electron.** Two views — Chat (thin client to the gateway, same contract as Surfaces 1–2, effectively a native-feeling re-implementation of Open WebUI's basic chat UX rather than its full feature set) and Code (embeds the chosen engine's headless mode). Tauri's Rust core and per-OS native webviews give a materially smaller binary and lower idle resource use than Electron, which matters more here than in a typical web-wrapper app because this one may run alongside an actual coding workload on the user's own machine, not just idle in the system tray.

**This is where FR8 (hooks/skills) actually gets built.** Hooks and skills are fundamentally about governing agentic tool-use — they have no meaning in the chat-only Web/Android surfaces, so building them there would be wasted generality. Scope that work to the Code view specifically (§5, Phase 5).

## 5. Phased roadmap

| Phase | Deliverable | Depends on | Why this order |
|---|---|---|---|
| 0 | Backend live (gateway, retrieval, memory, orchestration) | Part 4's build order | Prerequisite for everything below; not part of this plan's scope. |
| 1 | Web — Open WebUI integrated with the gateway | Phase 0 | Lowest-risk surface; validates the shared contract (§1) end-to-end with an already-built UI. |
| 2 | Android — RikkaHub pointed at the gateway | Phase 1 | Near-zero build cost; a second independent client catches contract assumptions Phase 1 baked in by accident, before the expensive surface (Phase 3+) inherits them. |
| 3 | PC app, Chat view only | Phase 2 | Proves the Tauri shell and the chat contract work together before adding the harder coding engine — deliberately split from Phase 4 so a shell bug isn't confused with an engine-integration bug. |
| 4 | PC app, Code view (chosen engine embedded) | Phase 3 | The genuinely new engineering in this plan; isolated to its own phase because it's the one piece with real integration risk (the headless-mode spike from §4). |
| 5 | Hooks/skills extensibility layer | Phase 4 | Builds on a working Code view; this is new engineering on top of an adopted engine, not a modification to it, so it can proceed independently of future engine upgrades. |

## 6. Risks and open questions

- **Headless-mode maturity (Pi/Zero) is unverified first-hand.** The one-week spike in §4 is load-bearing for the whole Phase 4 estimate; if it fails, replanning around Aider-in-a-terminal-pane changes Phase 4/5's scope, not just its difficulty.
- **Single-GPU contention (requirements spec Part 3 §3.1, FR6).** The PC app's Code view and the Web/Android chat surfaces all ultimately queue through the same one Tesla M40. This was already true before adding client surfaces; adding more simultaneous entry points makes the queuing more visible, not worse in kind. No fix beyond what Part 3 already specifies (serialize through llama-swap, treat concurrency as a UX/expectation-setting problem, not an engineering one to solve away).
- **Open WebUI's branding clause (§2)** is a non-issue at current scale and only needs revisiting if this ever moves beyond a single household.
- **RikkaHub's AGPL-3.0** similarly only matters if this is ever operated as a service others connect to, rather than a personal client.
- **This plan deliberately doesn't re-litigate Part 2's FR12 (Grok-style live social-data grounding) or FR3's video-overview cut** — both findings carry over unchanged; no client-surface decision here affects either.
