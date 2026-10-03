// Code view backend: spawns Aider in a real PTY (so its interactive TUI works correctly),
// streams its output to the frontend, and runs a best-effort hooks system around it.
//
// Aider's own tool-calls (file reads/writes/shell commands it runs internally) are NOT
// individually interceptable - it's a black-box interactive process, not something we drive
// via a structured tool-use API. So "hooks" here are approximated at the two boundaries we can
// actually observe from outside that process: session lifecycle (start/stop) and filesystem
// changes in the working directory (a stand-in for "post-tool-use", since the most common tool
// Aider uses is "edit a file"). This is documented as an intentional approximation, not a bug.

use crate::db::{get_memory_context, Db};
use crate::projects::get_project_by_id;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::Command as StdCommand;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Clone, Serialize)]
pub struct SkillInfo {
    pub name: String,
    pub description: String,
    pub path: String,
}

#[derive(Clone, Serialize, Deserialize, Default)]
pub struct HooksConfig {
    #[serde(default)]
    pub session_start: Vec<String>,
    #[serde(default)]
    pub session_stop: Vec<String>,
    #[serde(default)]
    pub post_file_change: Vec<String>,
}

pub struct ActiveSession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    _watcher: Option<RecommendedWatcher>,
    cwd: PathBuf,
}

#[derive(Default)]
pub struct CodeSessionState(pub Mutex<HashMap<String, ActiveSession>>);

pub(crate) fn config_dir(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .expect("app config dir should be resolvable");
    std::fs::create_dir_all(&dir).ok();
    dir
}

fn skills_dir(app: &AppHandle) -> PathBuf {
    let dir = config_dir(app).join("skills");
    if !dir.exists() {
        std::fs::create_dir_all(&dir).ok();
        let readme = dir.join("README.md");
        if !readme.exists() {
            let _ = std::fs::write(
                &readme,
                "# Skills\n\n\
                 Drop `.md` files in this folder. Each one is a skill: a packaged set of \
                 instructions that gets attached as read-only context to a Code session when \
                 selected in the app.\n\n\
                 First line starting with `# ` is used as the skill's display name. The rest of \
                 the file is the instruction content Aider will read.\n",
            );
        }
    }
    dir
}

fn hooks_config_path(app: &AppHandle) -> PathBuf {
    config_dir(app).join("hooks.json")
}

pub(crate) fn load_hooks(app: &AppHandle) -> HooksConfig {
    let path = hooks_config_path(app);
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub(crate) fn run_hook_commands(commands: &[String], cwd: &PathBuf, event: &str, extra_env: &[(&str, &str)]) {
    for cmd in commands {
        if cmd.trim().is_empty() {
            continue;
        }
        let mut c = if cfg!(target_os = "windows") {
            let mut c = StdCommand::new("cmd");
            c.arg("/C").arg(cmd);
            c
        } else {
            let mut c = StdCommand::new("sh");
            c.arg("-c").arg(cmd);
            c
        };
        c.current_dir(cwd);
        c.env("AI_PROJECT_HOOK_EVENT", event);
        for (k, v) in extra_env {
            c.env(k, v);
        }
        // Fire-and-forget, deliberately - a hook failing shouldn't block the session.
        // Errors are swallowed here but the hook's own stderr still goes to its own process.
        let _ = c.spawn();
    }
}

#[tauri::command]
pub fn list_skills(app: AppHandle) -> Vec<SkillInfo> {
    let dir = skills_dir(&app);
    let mut skills = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            if path.file_name().and_then(|n| n.to_str()) == Some("README.md") {
                continue;
            }
            let content = std::fs::read_to_string(&path).unwrap_or_default();
            let name = content
                .lines()
                .find(|l| l.starts_with("# "))
                .map(|l| l.trim_start_matches("# ").to_string())
                .unwrap_or_else(|| {
                    path.file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("skill")
                        .to_string()
                });
            let description = content
                .lines()
                .find(|l| !l.trim().is_empty() && !l.starts_with('#'))
                .unwrap_or("")
                .to_string();
            skills.push(SkillInfo {
                name,
                description,
                path: path.to_string_lossy().to_string(),
            });
        }
    }
    skills
}

#[tauri::command]
pub fn get_hooks_config(app: AppHandle) -> HooksConfig {
    load_hooks(&app)
}

#[tauri::command]
pub fn save_hooks_config(app: AppHandle, config: HooksConfig) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(hooks_config_path(&app), json).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
pub struct StartSessionArgs {
    pub cwd: String,
    pub gateway_url: String,
    pub model: String,
    pub skill_paths: Vec<String>,
    #[serde(default)]
    pub project_id: Option<String>,
}

/// Aider is not bundled into the installer - a Python venv isn't portable (it embeds absolute
/// paths back to the Python install that created it via pyvenv.cfg), so copying one into an
/// installer and running it on a different machine/path would just break. Properly solving that
/// needs a frozen standalone build (e.g. PyInstaller) - not attempted here; see
/// surfaces/pc/README.md's Code view section. Instead: resolve it the normal CLI-tool way.
pub(crate) fn aider_path_file(app: &AppHandle) -> PathBuf {
    config_dir(app).join("aider-path.txt")
}

pub(crate) fn resolve_aider_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(override_path) = std::env::var("AI_PROJECT_AIDER_PATH") {
        let p = PathBuf::from(override_path);
        if p.exists() {
            return Ok(p);
        }
    }

    // Path chosen in the UI ("Locate aider.exe"). Beats the build-folder guess below, which only
    // works when the app was built from the folder that contains aider-env.
    if let Ok(saved) = std::fs::read_to_string(aider_path_file(app)) {
        let p = PathBuf::from(saved.trim());
        if p.is_file() {
            return Ok(p);
        }
    }

    // Sibling venv next to the dev project (surfaces/pc/aider-env) - works when running via
    // `tauri dev` from the repo, since CARGO_MANIFEST_DIR is src-tauri/ at compile time.
    let dev_sibling = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("aider-env/Scripts/aider.exe"));
    if let Some(p) = dev_sibling {
        if p.exists() {
            return Ok(p);
        }
    }

    // Otherwise, rely on it being on PATH - e.g. `pip install aider-chat` globally/pipx, or the
    // user added aider-env\Scripts to PATH themselves (documented in surfaces/pc/README.md).
    let on_path = if cfg!(target_os = "windows") {
        StdCommand::new("where").arg("aider").output()
    } else {
        StdCommand::new("which").arg("aider").output()
    };
    if let Ok(output) = on_path {
        if output.status.success() {
            return Ok(PathBuf::from("aider"));
        }
    }

    Err(
        "Aider not found. Use \"Locate aider.exe\" in the Code view, or install it with          `pip install aider-chat` and add it to your PATH (or set AI_PROJECT_AIDER_PATH).          See surfaces/pc/README.md."
            .to_string(),
    )
}

#[tauri::command]
pub fn start_code_session(
    app: AppHandle,
    state: State<CodeSessionState>,
    db: State<Db>,
    args: StartSessionArgs,
) -> Result<String, String> {
    let cwd = PathBuf::from(&args.cwd);
    if !cwd.is_dir() {
        return Err(format!("{} is not a directory", args.cwd));
    }

    let hooks = load_hooks(&app);
    run_hook_commands(&hooks.session_start, &cwd, "session-start", &[]);

    // Same memory store Chat uses (FR7-style user/project/feedback/reference notes), written to
    // a file so it can ride along as another --read context source for Aider.
    let project = args.project_id.as_deref().and_then(|id| get_project_by_id(db.inner(), id));
    let memory_context = get_memory_context(db).unwrap_or_default();
    let memory_file_path = if !memory_context.is_empty() {
        let path = config_dir(&app).join("memory-context.md");
        std::fs::write(&path, &memory_context).ok();
        Some(path)
    } else {
        None
    };

    // Project instructions (Chat's own agent/project system-prompt injection, mirrored here) -
    // the same "standing context for this workspace" concept applied to a Code session.
    let project_file_path = project.as_ref().map(|p| {
        let path = config_dir(&app).join("project-context.md");
        std::fs::write(&path, format!("# Project: {}\n\n{}", p.name, p.instructions)).ok();
        path
    });

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 30,
            cols: 100,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let aider_exe = resolve_aider_path(&app)?;

    let mut cmd = CommandBuilder::new(aider_exe);
    cmd.arg("--openai-api-base");
    cmd.arg(&args.gateway_url);
    cmd.arg("--openai-api-key");
    cmd.arg("none");
    cmd.arg("--model");
    cmd.arg(format!("openai/{}", args.model));
    if let Some(mem_path) = &memory_file_path {
        cmd.arg("--read");
        cmd.arg(mem_path);
    }
    if let Some(proj_path) = &project_file_path {
        cmd.arg("--read");
        cmd.arg(proj_path);
    }
    for skill_path in &args.skill_paths {
        cmd.arg("--read");
        cmd.arg(skill_path);
    }
    cmd.cwd(&cwd);

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| e.to_string())?;

    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    let session_id = uuid::Uuid::new_v4().to_string();
    let emit_id = session_id.clone();
    let app_for_thread = app.clone();

    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_for_thread.emit(&format!("code-output-{}", emit_id), chunk);
                }
                Err(_) => break,
            }
        }
        let _ = app_for_thread.emit(&format!("code-session-ended-{}", emit_id), ());
    });

    // Best-effort post-tool-use approximation: watch the working directory for file changes
    // while this session is active, and run the configured hook for each one.
    let watcher = if hooks.post_file_change.is_empty() {
        None
    } else {
        let cwd_for_watch = cwd.clone();
        let post_hooks = hooks.post_file_change.clone();
        let watcher_result: notify::Result<RecommendedWatcher> =
            notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
                if let Ok(event) = res {
                    if event.kind.is_modify() || event.kind.is_create() {
                        for path in &event.paths {
                            let path_str = path.to_string_lossy().to_string();
                            run_hook_commands(
                                &post_hooks,
                                &cwd_for_watch,
                                "post-file-change",
                                &[("AI_PROJECT_HOOK_FILE", path_str.as_str())],
                            );
                        }
                    }
                }
            });
        match watcher_result {
            Ok(mut watcher) => {
                watcher.watch(&cwd, RecursiveMode::Recursive).ok();
                Some(watcher)
            }
            Err(_) => None,
        }
    };

    state.0.lock().unwrap().insert(
        session_id.clone(),
        ActiveSession {
            writer,
            master: pair.master,
            child,
            _watcher: watcher,
            cwd,
        },
    );

    Ok(session_id)
}

#[tauri::command]
pub fn write_to_code_session(
    state: State<CodeSessionState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let mut sessions = state.0.lock().unwrap();
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "session not found".to_string())?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn resize_code_session(
    state: State<CodeSessionState>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let sessions = state.0.lock().unwrap();
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| "session not found".to_string())?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn stop_code_session(
    app: AppHandle,
    state: State<CodeSessionState>,
    session_id: String,
) -> Result<(), String> {
    let mut sessions = state.0.lock().unwrap();
    if let Some(mut session) = sessions.remove(&session_id) {
        let hooks = load_hooks(&app);
        run_hook_commands(&hooks.session_stop, &session.cwd, "session-stop", &[]);
        let _ = session.child.kill();
    }
    Ok(())
}
