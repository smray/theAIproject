// Chat-first Code view backend. One Aider process per user turn, not a long-lived terminal:
//  - a turn finishes exactly when the process exits (no guessing from prompt text),
//  - Stop is a clean process-tree kill,
//  - memory / project / skill context is regenerated for every turn,
//  - conversation continuity comes from Aider's own --restore-chat-history, keyed per session.
// Cost: ~7s of Python/litellm startup per turn, small next to local-model generation time.
//
// Aider's chat-history file is the canonical record of what happened. The slice written during
// a turn is returned when the turn ends and parsed on the frontend (src/aiderRecord.ts); the raw
// stdout stream is only for the live "working..." view.

use crate::code_session::{config_dir, load_hooks, resolve_aider_path, run_hook_commands, HooksConfig};
use crate::db::{get_memory_context, Db};
use crate::projects::get_project_by_id;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

pub type Emit = Arc<dyn Fn(&str, Value) + Send + Sync>;
type Registry = Arc<Mutex<HashMap<String, u32>>>;

#[derive(Default)]
pub struct CodeTurnState(pub Registry);

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn hide_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}

pub struct TurnParams {
    pub turn_id: String,
    pub session_id: String,
    pub cwd: PathBuf,
    pub aider: PathBuf,
    pub gateway_url: String,
    pub model: String,
    pub message_file: PathBuf,
    pub context_files: Vec<PathBuf>,
    pub history_file: PathBuf,
    pub input_history_file: PathBuf,
    pub hooks: HooksConfig,
}

const RAW_CAP: usize = 128 * 1024;

fn utf8_valid_prefix_len(bytes: &[u8]) -> usize {
    match std::str::from_utf8(bytes) {
        Ok(_) => bytes.len(),
        // Incomplete multi-byte char at the end: hold it back until the next read completes it.
        Err(e) if e.error_len().is_none() => e.valid_up_to(),
        // Genuinely invalid bytes: let from_utf8_lossy replace them rather than stall forever.
        Err(_) => bytes.len(),
    }
}

fn pump<R: Read + Send + 'static>(mut reader: R, emit: Emit, event: String, raw: Arc<Mutex<String>>) -> JoinHandle<()> {
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let mut carry: Vec<u8> = Vec::new();
        let send = |bytes: &[u8]| {
            let chunk = String::from_utf8_lossy(bytes).to_string();
            if chunk.is_empty() {
                return;
            }
            {
                let mut r = raw.lock().unwrap();
                r.push_str(&chunk);
                if r.len() > RAW_CAP {
                    let mut cut = r.len() - RAW_CAP / 2;
                    while !r.is_char_boundary(cut) {
                        cut += 1;
                    }
                    r.drain(..cut);
                }
            }
            emit(&event, Value::String(chunk));
        };
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    carry.extend_from_slice(&buf[..n]);
                    let valid = utf8_valid_prefix_len(&carry);
                    let head: Vec<u8> = carry.drain(..valid).collect();
                    send(&head);
                }
            }
        }
        if !carry.is_empty() {
            send(&carry);
        }
    })
}

fn is_noise(rel: &Path) -> bool {
    const SKIP_DIRS: [&str; 9] = [
        ".git", "node_modules", "target", "__pycache__", ".venv", "venv", "dist", ".next", ".idea",
    ];
    for comp in rel.components() {
        let s = comp.as_os_str().to_string_lossy();
        if SKIP_DIRS.contains(&s.as_ref()) || s.starts_with(".aider") {
            return true;
        }
    }
    let name = rel.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    name.ends_with(".pyc") || name.ends_with(".swp") || name.ends_with('~') || name == ".DS_Store" || name.ends_with(".tmp")
}

fn start_watcher(cwd: &Path, session_id: &str, post_hooks: Vec<String>, emit: Emit) -> Option<RecommendedWatcher> {
    let root = std::fs::canonicalize(cwd).unwrap_or_else(|_| cwd.to_path_buf());
    let root_for_cb = root.clone();
    let event_name = format!("code-file-changed-{}", session_id);
    let recent: Arc<Mutex<HashMap<String, Instant>>> = Arc::new(Mutex::new(HashMap::new()));

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        let kind = if event.kind.is_create() {
            "created"
        } else if event.kind.is_modify() {
            "modified"
        } else if event.kind.is_remove() {
            "removed"
        } else {
            return;
        };
        for path in &event.paths {
            let Ok(rel) = path.strip_prefix(&root_for_cb) else { continue };
            if rel.as_os_str().is_empty() || is_noise(rel) {
                continue;
            }
            if kind != "removed" && path.is_dir() {
                continue;
            }
            let rel_s = rel.to_string_lossy().replace('\\', "/");
            let key = format!("{}:{}", kind, rel_s);
            {
                // One write usually produces several OS events; collapse bursts.
                let mut r = recent.lock().unwrap();
                if let Some(t) = r.get(&key) {
                    if t.elapsed() < Duration::from_millis(300) {
                        continue;
                    }
                }
                r.insert(key, Instant::now());
            }
            emit(&event_name, json!({ "path": rel_s, "kind": kind }));
            if kind != "removed" {
                let path_str = path.to_string_lossy().to_string();
                run_hook_commands(
                    &post_hooks,
                    &root_for_cb.to_path_buf(),
                    "post-file-change",
                    &[("AI_PROJECT_HOOK_FILE", path_str.as_str())],
                );
            }
        }
    })
    .ok()?;
    watcher.watch(&root, RecursiveMode::Recursive).ok()?;
    Some(watcher)
}

fn read_since(path: &Path, offset: u64) -> String {
    let Ok(mut f) = std::fs::File::open(path) else { return String::new() };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let start = if len >= offset { offset } else { 0 };
    if f.seek(SeekFrom::Start(start)).is_err() {
        return String::new();
    }
    let mut bytes = Vec::new();
    let _ = f.read_to_end(&mut bytes);
    String::from_utf8_lossy(&bytes).to_string()
}

fn tail_chars(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let mut cut = s.len() - max;
    while !s.is_char_boundary(cut) {
        cut += 1;
    }
    s[cut..].to_string()
}

fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        // The venv's aider.exe is a launcher that spawns python.exe; /T takes the whole tree.
        let mut c = Command::new("taskkill");
        c.args(["/PID", &pid.to_string(), "/T", "/F"]);
        hide_window(&mut c);
        let _ = c.output();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill").args(["-TERM", &pid.to_string()]).output();
    }
}

/// Starts one Aider turn. The caller picks the turn id so it can subscribe before launch;
/// progress and completion arrive through `emit` as `code-turn-output-<id>` (raw chunks),
/// `code-file-changed-<session>` and `code-turn-ended-<id>`.
pub fn start_turn(p: TurnParams, emit: Emit, registry: Registry) -> Result<String, String> {
    if let Some(parent) = p.history_file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let offset = std::fs::metadata(&p.history_file).map(|m| m.len()).unwrap_or(0);
    if offset == 0 {
        run_hook_commands(&p.hooks.session_start, &p.cwd, "session-start", &[]);
    }

    let mut cmd = Command::new(&p.aider);
    cmd.arg("--openai-api-base")
        .arg(&p.gateway_url)
        .arg("--openai-api-key")
        .arg("none")
        .arg("--model")
        .arg(format!("openai/{}", p.model))
        .arg("--message-file")
        .arg(&p.message_file)
        .args([
            "--yes-always",
            "--no-pretty",
            "--stream",
            "--no-fancy-input",
            "--no-check-update",
            "--analytics-disable",
            "--no-show-release-notes",
            // Without this, --yes-always auto-answers "open documentation url?" and pops a browser.
            "--no-show-model-warnings",
            "--no-detect-urls",
            "--no-suggest-shell-commands",
            "--restore-chat-history",
        ])
        .arg("--chat-history-file")
        .arg(&p.history_file)
        .arg("--input-history-file")
        .arg(&p.input_history_file);
    for f in &p.context_files {
        cmd.arg("--read").arg(f);
    }
    cmd.current_dir(&p.cwd)
        .env("PYTHONUNBUFFERED", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_window(&mut cmd);

    let mut child = cmd.spawn().map_err(|e| format!("Failed to start Aider: {}", e))?;
    let pid = child.id();
    let turn_id = p.turn_id.clone();
    registry.lock().unwrap().insert(turn_id.clone(), pid);

    let raw = Arc::new(Mutex::new(String::new()));
    let out_event = format!("code-turn-output-{}", turn_id);
    let mut readers = Vec::new();
    if let Some(out) = child.stdout.take() {
        readers.push(pump(out, emit.clone(), out_event.clone(), raw.clone()));
    }
    if let Some(err) = child.stderr.take() {
        readers.push(pump(err, emit.clone(), out_event, raw.clone()));
    }

    let watcher = start_watcher(&p.cwd, &p.session_id, p.hooks.post_file_change.clone(), emit.clone());

    let tid = turn_id.clone();
    let history_file = p.history_file.clone();
    std::thread::spawn(move || {
        let status = child.wait();
        for r in readers {
            let _ = r.join();
        }
        drop(watcher);
        // stop_code_turn removes the registry entry first, so a missing entry means "user stopped it".
        let stopped = registry.lock().unwrap().remove(&tid).is_none();
        let record = read_since(&history_file, offset);
        let raw_s = raw.lock().unwrap().clone();
        let exit_code = status.ok().and_then(|s| s.code()).unwrap_or(-1);
        emit(
            &format!("code-turn-ended-{}", tid),
            json!({
                "exit_code": exit_code,
                "stopped": stopped,
                "record": record,
                "raw": tail_chars(&raw_s, 20_000),
            }),
        );
    });

    Ok(turn_id)
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

#[derive(Deserialize)]
pub struct TurnArgs {
    pub turn_id: String,
    pub session_id: String,
    pub cwd: String,
    pub gateway_url: String,
    pub model: String,
    pub prompt: String,
    #[serde(default)]
    pub skill_paths: Vec<String>,
    #[serde(default)]
    pub project_id: Option<String>,
}

#[tauri::command]
pub fn run_code_turn(app: AppHandle, state: State<CodeTurnState>, args: TurnArgs) -> Result<String, String> {
    if !valid_id(&args.session_id) || !valid_id(&args.turn_id) {
        return Err("invalid session or turn id".to_string());
    }
    if args.prompt.trim().is_empty() {
        return Err("empty prompt".to_string());
    }
    let cwd = PathBuf::from(&args.cwd);
    if !cwd.is_dir() {
        return Err(format!("{} is not a directory", args.cwd));
    }

    let aider = resolve_aider_path()?;
    let cfg = config_dir(&app);
    let dir = cfg.join("code-history");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // Same standing context the terminal mode feeds Aider: memory notes, project instructions, skills.
    let mut context_files: Vec<PathBuf> = Vec::new();
    let memory = get_memory_context(app.state::<Db>()).unwrap_or_default();
    if !memory.is_empty() {
        let path = cfg.join("memory-context.md");
        std::fs::write(&path, &memory).map_err(|e| e.to_string())?;
        context_files.push(path);
    }
    if let Some(pid) = args.project_id.as_deref() {
        if let Some(project) = get_project_by_id(&app.state::<Db>(), pid) {
            let path = cfg.join("project-context.md");
            std::fs::write(&path, format!("# Project: {}\n\n{}", project.name, project.instructions))
                .map_err(|e| e.to_string())?;
            context_files.push(path);
        }
    }
    for s in &args.skill_paths {
        context_files.push(PathBuf::from(s));
    }

    let message_file = dir.join(format!("{}.msg.txt", args.session_id));
    std::fs::write(&message_file, &args.prompt).map_err(|e| e.to_string())?;

    let handle = app.clone();
    let emit: Emit = Arc::new(move |event, payload| {
        let _ = handle.emit(event, payload);
    });

    start_turn(
        TurnParams {
            turn_id: args.turn_id,
            session_id: args.session_id.clone(),
            cwd,
            aider,
            gateway_url: args.gateway_url,
            model: args.model,
            message_file,
            context_files,
            history_file: dir.join(format!("{}.md", args.session_id)),
            input_history_file: dir.join(format!("{}.input", args.session_id)),
            hooks: load_hooks(&app),
        },
        emit,
        state.0.clone(),
    )
}

#[tauri::command]
pub fn stop_code_turn(state: State<CodeTurnState>, turn_id: String) -> Result<(), String> {
    let pid = state.0.lock().unwrap().remove(&turn_id);
    if let Some(pid) = pid {
        kill_tree(pid);
    }
    Ok(())
}

#[tauri::command]
pub fn end_code_session(app: AppHandle, cwd: String) -> Result<(), String> {
    let path = PathBuf::from(&cwd);
    if path.is_dir() {
        run_hook_commands(&load_hooks(&app).session_stop, &path, "session-stop", &[]);
    }
    Ok(())
}

fn ensure_table(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS code_sessions (session_id TEXT PRIMARY KEY, cwd TEXT NOT NULL)",
        [],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn register_code_session(db: State<Db>, session_id: String, cwd: String) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    ensure_table(&conn)?;
    conn.execute(
        "INSERT INTO code_sessions (session_id, cwd) VALUES (?1, ?2) \
         ON CONFLICT(session_id) DO UPDATE SET cwd = excluded.cwd",
        rusqlite::params![session_id, cwd],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct CodeSessionRow {
    pub id: String,
    pub title: String,
    pub project_id: Option<String>,
    pub updated_at: i64,
    pub cwd: Option<String>,
}

#[tauri::command]
pub fn list_code_sessions(db: State<Db>) -> Result<Vec<CodeSessionRow>, String> {
    let conn = db.0.lock().unwrap();
    ensure_table(&conn)?;
    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.title, s.project_id, s.updated_at, c.cwd \
             FROM sessions s LEFT JOIN code_sessions c ON c.session_id = s.id \
             WHERE s.view = 'code' ORDER BY s.updated_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(CodeSessionRow {
                id: row.get(0)?,
                title: row.get(1)?,
                project_id: row.get(2)?,
                updated_at: row.get(3)?,
                cwd: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Cleans up what `delete_session` (generic, in db.rs) doesn't know about: the cwd row and
/// Aider's per-session history files.
#[tauri::command]
pub fn forget_code_session(app: AppHandle, db: State<Db>, session_id: String) -> Result<(), String> {
    if !valid_id(&session_id) {
        return Ok(());
    }
    {
        let conn = db.0.lock().unwrap();
        ensure_table(&conn)?;
        conn.execute("DELETE FROM code_sessions WHERE session_id = ?1", [&session_id])
            .map_err(|e| e.to_string())?;
    }
    let dir = config_dir(&app).join("code-history");
    for ext in ["md", "input", "msg.txt"] {
        let _ = std::fs::remove_file(dir.join(format!("{}.{}", session_id, ext)));
    }
    Ok(())
}

#[tauri::command]
pub fn git_show(cwd: String, rev: String) -> Result<String, String> {
    if !(4..=40).contains(&rev.len()) || !rev.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("invalid revision".to_string());
    }
    let mut c = Command::new("git");
    c.args(["-C", &cwd, "show", "--no-color", "--stat", "--patch", "--format=%h %s%n%an, %ar", &rev]);
    hide_window(&mut c);
    let out = c.output().map_err(|e| format!("git not available: {}", e))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    Ok(if text.len() > 300_000 { tail_chars(&text, 300_000) } else { text })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_prefix_holds_back_incomplete_char() {
        let bytes = "héllo".as_bytes(); // 'é' is 2 bytes
        assert_eq!(utf8_valid_prefix_len(&bytes[..2]), 1);
        assert_eq!(utf8_valid_prefix_len(bytes), bytes.len());
        assert_eq!(utf8_valid_prefix_len(&[0xff, 0xfe]), 2);
    }

    #[test]
    fn noise_filter() {
        assert!(is_noise(Path::new(".git/index")));
        assert!(is_noise(Path::new("a/node_modules/x/y.js")));
        assert!(is_noise(Path::new(".aider.chat.history.md")));
        assert!(is_noise(Path::new("src/__pycache__/m.cpython-312.pyc")));
        assert!(!is_noise(Path::new("src/main.py")));
        assert!(!is_noise(Path::new("README.md")));
    }

    #[test]
    fn read_since_returns_only_new_bytes() {
        let dir = std::env::temp_dir().join(format!("ai-proj-readsince-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("h.md");
        std::fs::write(&f, "old\n").unwrap();
        let off = std::fs::metadata(&f).unwrap().len();
        std::fs::write(&f, "old\nnew\n").unwrap();
        assert_eq!(read_since(&f, off), "new\n");
        assert_eq!(read_since(&f, 9999), "old\nnew\n");
        assert_eq!(read_since(&dir.join("missing"), 0), "");
    }

    #[test]
    fn id_validation() {
        assert!(valid_id("550e8400-e29b-41d4-a716-446655440000"));
        assert!(!valid_id("../evil"));
        assert!(!valid_id(""));
    }

    /// Real end-to-end turn: needs Aider plus an OpenAI-compatible mock on localhost.
    /// AI_PROJECT_TEST_MOCK_URL=http://127.0.0.1:18080/v1 AI_PROJECT_AIDER_PATH=...\aider.exe
    /// cargo test aider_turn_against_mock -- --ignored --nocapture
    #[test]
    #[ignore]
    fn aider_turn_against_mock() {
        let url = std::env::var("AI_PROJECT_TEST_MOCK_URL").expect("AI_PROJECT_TEST_MOCK_URL");
        let aider = resolve_aider_path().expect("aider");
        let root = std::env::temp_dir().join(format!("ai-proj-turn-{}", std::process::id()));
        let repo = root.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        let git = |args: &[&str]| {
            let s = Command::new("git").args(args).current_dir(&repo).output().unwrap();
            assert!(s.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&s.stderr));
        };
        git(&["init", "-q"]);
        git(&["config", "user.email", "t@t"]);
        git(&["config", "user.name", "t"]);
        std::fs::write(repo.join("README.md"), "# demo\n").unwrap();
        git(&["add", "-A"]);
        git(&["commit", "-qm", "init"]);

        let msg = root.join("m.txt");
        std::fs::write(&msg, "create a hello script").unwrap();
        let events: Arc<Mutex<Vec<(String, Value)>>> = Arc::new(Mutex::new(Vec::new()));
        let (tx, rx) = std::sync::mpsc::channel::<Value>();
        let ev = events.clone();
        let emit: Emit = Arc::new(move |name, payload| {
            if name.starts_with("code-turn-ended-") {
                let _ = tx.send(payload.clone());
            }
            ev.lock().unwrap().push((name.to_string(), payload));
        });
        let registry: Registry = Arc::new(Mutex::new(HashMap::new()));
        let turn_id = start_turn(
            TurnParams {
                turn_id: "test-turn".into(),
                session_id: "test-session".into(),
                cwd: repo.clone(),
                aider,
                gateway_url: url,
                model: "chat-default".into(),
                message_file: msg,
                context_files: vec![],
                history_file: root.join("hist.md"),
                input_history_file: root.join("in.txt"),
                hooks: HooksConfig::default(),
            },
            emit,
            registry.clone(),
        )
        .expect("start_turn");

        let ended = rx.recv_timeout(Duration::from_secs(180)).expect("turn did not end");
        let events = events.lock().unwrap();
        println!("record:\n{}", ended["record"].as_str().unwrap());
        assert_eq!(ended["exit_code"], 0, "raw: {}", ended["raw"]);
        assert_eq!(ended["stopped"], false);
        assert!(ended["record"].as_str().unwrap().contains("Applied edit to hello.py"));
        assert!(repo.join("hello.py").exists());
        assert!(events.iter().any(|(n, _)| n == &format!("code-turn-output-{}", turn_id)), "no live output");
        assert!(
            events.iter().any(|(n, p)| n == "code-file-changed-test-session" && p["path"] == "hello.py"),
            "no file-changed event for hello.py"
        );
        assert!(registry.lock().unwrap().is_empty(), "turn left in registry");
    }
}
