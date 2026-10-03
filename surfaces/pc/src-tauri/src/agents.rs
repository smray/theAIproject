// Agent personas: named system-prompt + tool-scope presets, so the user can switch between
// "a general assistant" and "a research-literature-grounded domain assistant" without retyping
// a system prompt and reconnecting MCP servers every time.
//
// Deliberately framed as research/advisory personas, not as agents that issue binding
// professional decisions - a "Medical Research Assistant" persona that searches peer-reviewed
// literature and summarizes it is genuinely useful and safe; an AI persona that presents itself
// as "a doctor" making diagnostic calls is not something to ship without a licensed professional
// in the loop. The seeded defaults below say so explicitly in their own system prompts.

use crate::db::Db;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Serialize, Deserialize, Clone)]
pub struct Agent {
    pub id: String,
    pub name: String,
    pub description: String,
    pub system_prompt: String,
    pub mcp_servers: Vec<String>,
    pub use_research_tool: bool,
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn seed_default_agents(db: &Db) {
    let conn = db.0.lock().unwrap();
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM agents", [], |r| r.get(0))
        .unwrap_or(0);
    if count > 0 {
        return;
    }

    let defaults: Vec<(&str, &str, &str, bool)> = vec![
        (
            "General Assistant",
            "No special tools - plain conversation.",
            "You are a helpful general-purpose assistant.",
            false,
        ),
        (
            "Research Analyst",
            "Searches real peer-reviewed journal articles (via CrossRef) and ranks them by citation count before answering.",
            "You are a research analyst. When asked a factual or scientific question, use the \
             search_journal_articles tool to find real peer-reviewed sources before answering. \
             Cite the papers you used (title, authors, journal, year) and note their citation \
             counts as a rough influence signal - make clear that citation count reflects \
             influence, not correctness. If the tool returns nothing relevant, say so rather \
             than fabricating a citation.",
            true,
        ),
        (
            "Medical Research Assistant",
            "Finds and summarizes peer-reviewed medical literature. Not a doctor - does not diagnose or prescribe.",
            "You help find and summarize peer-reviewed medical/health research using the \
             search_journal_articles tool. You are not a doctor, you do not diagnose conditions, \
             recommend treatment, or interpret someone's personal symptoms or test results. For \
             any of that, clearly say the user should consult a licensed clinician. Your job is \
             literature research and summarization only - always cite the actual papers you \
             found.",
            true,
        ),
        (
            "Legal Research Assistant",
            "Finds and summarizes peer-reviewed legal/policy literature. Not a lawyer - does not give legal advice.",
            "You help find and summarize peer-reviewed legal and policy research using the \
             search_journal_articles tool. You are not a lawyer, you do not give legal advice \
             about someone's specific situation, draft binding legal documents, or tell someone \
             what to do in an actual legal matter. For any of that, clearly say the user should \
             consult a licensed attorney in their jurisdiction. Your job is literature research \
             and summarization only.",
            true,
        ),
        (
            "Software Engineer",
            "Scoped for coding questions. Pair with the Code view (Aider) for actually writing/editing files.",
            "You are an experienced software engineer. Be concrete and specific - name actual \
             files, functions, and line numbers when discussing code the user shares. Prefer \
             working code over abstract advice. If a task involves actually editing files in a \
             project, suggest using the Code view instead of pasting large diffs into chat.",
            false,
        ),
    ];

    for (name, description, prompt, use_research) in defaults {
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO agents (id, name, description, system_prompt, mcp_servers, use_research_tool, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, name, description, prompt, "[]", use_research as i64, now()],
        )
        .ok();
    }
}

#[tauri::command]
pub fn list_agents(db: State<Db>) -> Result<Vec<Agent>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, name, description, system_prompt, mcp_servers, use_research_tool FROM agents ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let mcp_servers_json: String = row.get(4)?;
            let use_research: i64 = row.get(5)?;
            Ok(Agent {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                system_prompt: row.get(3)?,
                mcp_servers: serde_json::from_str(&mcp_servers_json).unwrap_or_default(),
                use_research_tool: use_research != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_agent(db: State<Db>, agent: Agent) -> Result<String, String> {
    let conn = db.0.lock().unwrap();
    let id = if agent.id.is_empty() {
        uuid::Uuid::new_v4().to_string()
    } else {
        agent.id.clone()
    };
    let mcp_json = serde_json::to_string(&agent.mcp_servers).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO agents (id, name, description, system_prompt, mcp_servers, use_research_tool, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) \
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, \
         system_prompt=excluded.system_prompt, mcp_servers=excluded.mcp_servers, \
         use_research_tool=excluded.use_research_tool",
        params![
            id,
            agent.name,
            agent.description,
            agent.system_prompt,
            mcp_json,
            agent.use_research_tool as i64,
            now()
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub fn delete_agent(db: State<Db>, id: String) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute("DELETE FROM agents WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
