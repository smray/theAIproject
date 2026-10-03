// Projects: named persistent workspaces, the pattern Claude Projects / ChatGPT Projects
// popularized - a set of standing instructions/context that every chat scoped to the project
// gets automatically, instead of re-explaining "this is about the homelab migration" every new
// chat. A session's project_id (see db.rs) links it back here. Deliberately just name +
// instructions for now, not a separate file-attachment store - chat sessions scoped to a project
// already share its instructions via the system-prompt injection the frontend does for
// agents/memory, so this reuses that same mechanism rather than inventing a second one.

use crate::db::Db;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Serialize, Deserialize, Clone)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub instructions: String,
    #[serde(default)]
    pub code_path: Option<String>,
    pub created_at: i64,
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn list_projects(db: State<Db>) -> Result<Vec<Project>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, name, instructions, code_path, created_at FROM projects ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                instructions: row.get(2)?,
                code_path: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_project(db: State<Db>, project: Project) -> Result<String, String> {
    let conn = db.0.lock().unwrap();
    let id = if project.id.is_empty() {
        uuid::Uuid::new_v4().to_string()
    } else {
        project.id.clone()
    };
    conn.execute(
        "INSERT INTO projects (id, name, instructions, code_path, created_at) VALUES (?1, ?2, ?3, ?4, ?5) \
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, instructions=excluded.instructions, \
         code_path=excluded.code_path",
        params![id, project.name, project.instructions, project.code_path, now()],
    )
    .map_err(|e| e.to_string())?;
    Ok(id)
}

/// Plain Rust helper (not a tauri::command) for other backend modules - code_session.rs calls
/// this directly to pull a project's instructions when starting an Aider session scoped to it,
/// without going through the IPC layer.
pub fn get_project_by_id(db: &Db, id: &str) -> Option<Project> {
    let conn = db.0.lock().unwrap();
    conn.query_row(
        "SELECT id, name, instructions, code_path, created_at FROM projects WHERE id = ?1",
        [id],
        |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                instructions: row.get(2)?,
                code_path: row.get(3)?,
                created_at: row.get(4)?,
            })
        },
    )
    .ok()
}

#[tauri::command]
pub fn delete_project(db: State<Db>, id: String) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    // Unscope rather than cascade-delete - a project going away shouldn't take its chat history
    // with it, same reasoning as sessions surviving MCP server removal.
    conn.execute(
        "UPDATE sessions SET project_id = NULL WHERE project_id = ?1",
        [&id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM projects WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
