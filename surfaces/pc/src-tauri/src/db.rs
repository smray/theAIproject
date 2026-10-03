// Local persistence: chat/code session history, and a typed memory store modeled directly on
// FR7 from the requirements doc (the Claude Code auto-memory schema: user/feedback/project/
// reference categories). SQLite, bundled (no system dependency), one file at
// <app-config-dir>/data.db.

use rusqlite::Connection;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

pub struct Db(pub Mutex<Connection>);

pub fn init(app: &AppHandle) -> Db {
    let dir = app
        .path()
        .app_config_dir()
        .expect("app config dir should be resolvable");
    std::fs::create_dir_all(&dir).ok();
    let conn = Connection::open(dir.join("data.db")).expect("failed to open local database");

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            view TEXT NOT NULL,
            title TEXT NOT NULL,
            project_id TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            instructions TEXT NOT NULL,
            code_path TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS agents (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            system_prompt TEXT NOT NULL,
            mcp_servers TEXT NOT NULL,
            use_research_tool INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS memories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        ",
    )
    .expect("failed to initialize database schema");

    // Migration for databases created before project scoping existed - no-op (duplicate column
    // error, ignored) on any fresh DB where CREATE TABLE above already included project_id.
    conn.execute("ALTER TABLE sessions ADD COLUMN project_id TEXT", [])
        .ok();
    conn.execute("ALTER TABLE projects ADD COLUMN code_path TEXT", [])
        .ok();

    Db(Mutex::new(conn))
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[derive(Serialize)]
pub struct SessionInfo {
    pub id: String,
    pub view: String,
    pub title: String,
    pub project_id: Option<String>,
    pub updated_at: i64,
}

#[derive(Serialize)]
pub struct MessageInfo {
    pub role: String,
    pub content: String,
    pub created_at: i64,
}

#[derive(Serialize)]
pub struct MemoryInfo {
    pub id: i64,
    pub category: String,
    pub content: String,
    pub created_at: i64,
}

// Agent CRUD lives in agents.rs, not here - see that file's header comment for why.

#[tauri::command]
pub fn list_sessions(db: State<Db>, view: String) -> Result<Vec<SessionInfo>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, view, title, project_id, updated_at FROM sessions WHERE view = ?1 ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&view], |row| {
            Ok(SessionInfo {
                id: row.get(0)?,
                view: row.get(1)?,
                title: row.get(2)?,
                project_id: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_session(
    db: State<Db>,
    view: String,
    title: String,
    project_id: Option<String>,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let ts = now();
    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT INTO sessions (id, view, title, project_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        rusqlite::params![id, view, title, project_id, ts],
    )
    .map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub fn rename_session(db: State<Db>, session_id: String, title: String) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "UPDATE sessions SET title = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![title, now(), session_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_session(db: State<Db>, session_id: String) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute("DELETE FROM messages WHERE session_id = ?1", [&session_id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM sessions WHERE id = ?1", [&session_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_session_messages(db: State<Db>, session_id: String) -> Result<Vec<MessageInfo>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT role, content, created_at FROM messages WHERE session_id = ?1 ORDER BY id ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&session_id], |row| {
            Ok(MessageInfo {
                role: row.get(0)?,
                content: row.get(1)?,
                created_at: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn append_message(
    db: State<Db>,
    session_id: String,
    role: String,
    content: String,
) -> Result<(), String> {
    let ts = now();
    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT INTO messages (session_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![session_id, role, content, ts],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE sessions SET updated_at = ?1 WHERE id = ?2",
        rusqlite::params![ts, session_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_memories(db: State<Db>) -> Result<Vec<MemoryInfo>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, category, content, created_at FROM memories ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(MemoryInfo {
                id: row.get(0)?,
                category: row.get(1)?,
                content: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_memory(db: State<Db>, category: String, content: String) -> Result<i64, String> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT INTO memories (category, content, created_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![category, content, now()],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn update_memory(db: State<Db>, id: i64, category: String, content: String) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "UPDATE memories SET category = ?1, content = ?2 WHERE id = ?3",
        rusqlite::params![category, content, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_memory(db: State<Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute("DELETE FROM memories WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Formats all stored memories as a system-prompt preamble, grouped by category - the same
/// shape Claude Code's own CLAUDE.md/auto-memory injection takes. Returns an empty string (not
/// injected) if there's nothing stored yet.
#[tauri::command]
pub fn get_memory_context(db: State<Db>) -> Result<String, String> {
    let memories = list_memories(db)?;
    if memories.is_empty() {
        return Ok(String::new());
    }
    let mut out = String::from("# Memory\n\nThings you've previously learned about this user and project:\n\n");
    for category in ["user", "project", "feedback", "reference"] {
        let items: Vec<&MemoryInfo> = memories.iter().filter(|m| m.category == category).collect();
        if items.is_empty() {
            continue;
        }
        out.push_str(&format!("## {}\n", category));
        for m in items {
            out.push_str(&format!("- {}\n", m.content));
        }
        out.push('\n');
    }
    Ok(out)
}
