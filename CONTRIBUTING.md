# Contributing

Solo-developer project. Process below is adopted as-is from
[KiwiProductivity](https://github.com/smray/KiwiProductivity) — see
[docs/GIT-AND-BUILD-LESSONS.md](docs/GIT-AND-BUILD-LESSONS.md) for why it's worth keeping even
solo.

## Branching

Trunk-based. `main` is always deployable.

Branch naming: `<surface>/<short-description>`, e.g.

- `web/open-webui-gateway-config`
- `android/rikkahub-pointed-at-gateway`
- `pc/tauri-shell-scaffold`
- `pc/code-view-engine-spike`

Keep branches short-lived (days, not weeks). Delete on merge.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), enforced by commitlint via a husky
`commit-msg` hook:

```
feat(pc): scaffold Tauri shell with Chat view
fix(web): correct custom CSS variable for accent colour
chore(docs): record Pi vs Zero headless-mode spike result in ADR
docs(adr): record RikkaHub fork decision
```

Scope by surface (`web`, `android`, `pc`) or by cross-cutting area (`docs`, `design`, `infra`).

## Merging

No PR required — merge feature branches to `main` directly once CI is green. Delete the feature
branch immediately after merging.

## Architecture decisions

Write an ADR (`docs/adr/NNNN-title.md`) whenever a decision has more than one reasonable option,
or when build reveals something the plan didn't anticipate. Copy `docs/adr/0000-template.md` to
start one.

## Before starting `surfaces/android` build work (if a RikkaHub fork becomes necessary)

Read [docs/GIT-AND-BUILD-LESSONS.md](docs/GIT-AND-BUILD-LESSONS.md) first — it records specific
Gradle/Kotlin build failures KiwiProductivity already paid for (transitive-dependency JVM
mismatches, plugin version ordering, release-signing setup) so they don't get rediscovered here.

## Before starting `surfaces/pc` Phase 4 (Code view / engine embedding)

Re-read the plan's §6 risks section — the headless-mode spike (Pi/Zero) is load-bearing for the
whole phase's scope; confirm it actually passed before building the rest of the Code view on top
of it.
