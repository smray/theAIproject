# Git & build lessons carried over from KiwiProductivity

This project is a solo-developer monorepo, same as
[KiwiProductivity](https://github.com/smray/KiwiProductivity). Rather than re-discover the same
git-hygiene and Gradle/build pitfalls, this records what that project's history already paid for.
Read this before starting `surfaces/android` work in particular — that's the one surface where a
real Gradle/Kotlin build could enter this repo (see ADR 0001).

## Git workflow (adopted as-is — see CONTRIBUTING.md)

- **Trunk-based, no PRs.** `main` always deployable, branches named `<surface>/<short-description>`
  (e.g. `pc/tauri-shell-scaffold`, `android/rikkahub-theme-config`), short-lived, deleted on merge.
- **Conventional Commits, enforced by commitlint + a husky `commit-msg` hook.** Not optional —
  KiwiProductivity ran this from commit one and it kept `git log` useful for a year-plus of
  solo-dev history (`feat(app): ...`, `fix(api): ...`, `chore(infra): ...`). Scope the commit to
  the surface, e.g. `feat(pc): ...`, `fix(android): ...`.
- **ADRs for anything with more than one reasonable option**, or when build reveals something the
  plan didn't anticipate. Copy `docs/adr/0000-template.md`. Don't skip this because it's "just
  you" — the ADRs are what let future-you (or an agent) avoid re-litigating a decision.
- **CI gates `main`, nothing else does.** No review step needed solo, but don't merge past a red
  or still-running check.

## Gradle / Android build lessons (apply if/when `surfaces/android` becomes a real build)

These are concrete failures KiwiProductivity's Flutter/Android build hit, not generic advice:

1. **A transitive package's own Gradle build can be broken in a way that has nothing to do with
   your code.** KiwiProductivity pulled in `flutter_timezone` for local-notification scheduling;
   that package's Kotlin compile task targeted a different JVM version than its own Java compile
   task, which broke the Gradle build. Real time was spent trying to force-align JVM target
   versions at the *root* Gradle level before concluding it wasn't worth it — the actual fix was
   dropping the package and computing a fixed UTC offset in app code instead. **Lesson: when a
   dependency's own build is internally inconsistent, check whether you can route around the
   package entirely before trying to patch Gradle config to accommodate it.**
2. **Plugin version ordering matters and isn't always visible from a version number.**
   `flutter_plugin_android_lifecycle` had to be pinned *below* `file_picker`'s expected Android
   build — a transitive-dependency ordering issue, not a straightforward "bump to latest."
   **Lesson: a Gradle build failure after adding/upgrading one plugin is often caused by a
   different, already-present plugin's version expectations — check the full dependency graph,
   not just the package you just touched.**
3. **Release signing: debug-key fallback, never commit the real keystore.** The pattern used was
   `android/key.properties` (gitignored) read from `build.gradle.kts`, with a
   `key.properties.example` committed to document the shape and the `keytool` invocation needed
   to generate one. No behavior change until a real `key.properties` exists. Known tradeoff:
   switching signing keys later forces existing users through a one-time uninstall/reinstall and
   loses local-only data — decide the signing identity early if this ever ships to real users,
   not after.
4. **Static analysis is not proof the Gradle build works.** `flutter analyze` and unit tests
   passing did **not** catch the JVM-mismatch build break above — only a real `flutter build apk`
   did. **Lesson: any change touching `AndroidManifest.xml` or a `build.gradle(.kts)` file needs
   a real build run before calling it verified, not just analyze/test.** The same principle
   applies to a Tauri build on `surfaces/pc` touching `tauri.conf.json` or `Cargo.toml` — `cargo
   check` is not proof `tauri build` succeeds.
5. **`.gitignore` the generated/local Gradle state, not just `node_modules`:**
   `android/.gradle/`, `android/local.properties`, plus Flutter-specific generated files
   (`**/*.g.dart`, `**/*.freezed.dart`, `.dart_tool/`). This repo's own `.gitignore` (root)
   mirrors the equivalent for whatever ends up in `surfaces/android` — update it when that
   surface gets real content rather than assuming the current generic entries are sufficient.

## Tauri (`surfaces/pc`) lessons from building tray/global-shortcut/Projects

1. **Verify capability/permission identifiers against the installed plugin's own files, don't
   guess the ACL string.** `src-tauri/capabilities/*.json` identifiers (`core:tray:default`,
   `global-shortcut:allow-register`, etc.) aren't documented in one obvious place and a wrong one
   fails silently at runtime, not at `cargo check` time (capability JSON isn't validated by
   `cargo check` at all — see lesson 4 above, which already warns `cargo check` isn't proof a
   Tauri build works). The reliable way: find the plugin's crate in
   `~/.cargo/registry/src/*/<plugin>-<version>/permissions/`, read its `default.toml` and
   `autogenerated/reference.md` for the exact identifiers it actually defines, and only use those.
2. **A `?` on a plugin's own error type inside a `setup()` closure needs its target type lined
   up.** `tauri_plugin_global_shortcut`'s `on_shortcut()` returns that plugin's own `Error`, which
   has no `From` impl into `tauri::Error`. Easiest fix: make the containing function return
   `Result<(), Box<dyn std::error::Error>>` (what `tauri::Builder::setup()` actually expects) and
   `.map_err(|e| Box::new(e) as Box<dyn std::error::Error>)` on the one call that doesn't
   auto-convert, rather than reaching for `anyhow`/`tauri::Error::Anyhow` (which may not even be a
   real variant — don't guess at error-enum shapes either, let the compiler tell you).
3. **A Tauri command parameter typed `Option<T>` is genuinely optional from the JS side** — the
   IPC layer resolves a missing key to `null` before deserializing, it does not require
   `#[serde(default)]` the way a plain `serde_json::from_str` of a whole struct would. Confirmed
   by this project's own `create_session`/`start_code_session` commands gaining a new
   `Option<String>` param without updating every existing frontend call site, and everything
   still compiled and worked.

## Multi-session collaboration on one working directory

Discovered mid-session, not by design: a "forked" Claude Code session from the same conversation
shares this repo's actual working directory and `.git` in real time — it is not a separate
worktree or clone. A commit either session makes is immediately visible to `git log` in the
other's next command, with no `git pull` needed. This makes it a genuine shared-filesystem race,
not just a shared-repo one: two sessions editing the same file at the same time will corrupt each
other's in-progress edit (hit once this session — see commit history around
`f427bf0`/`11b8bbe`). What worked: send a `SendMessage` naming the exact file before editing it,
state what you're about to change, and default to picking *different* files to work in rather
than waiting for a reply — `git status`/`git log` after the fact confirms whether a collision
actually happened, which is cheap enough to check liberally.

## What this means for `surfaces/android` right now

Per the plan and ADR 0001, Android starts as RikkaHub **configuration**, not a fork — so none of
the Gradle items above are live yet. They become relevant only if/when a fork is actually needed;
at that point, treat "fork RikkaHub" itself as a new ADR decision, and re-read this file before
touching its `build.gradle.kts`.
