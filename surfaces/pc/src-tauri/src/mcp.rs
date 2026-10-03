// MCP (Model Context Protocol) client - FR9 from the requirements doc, and per research done
// before building this, the single most emblematic Claude Desktop feature ("Anthropic
// open-sourced MCP and shipped it in Claude Desktop first"). stdio transport only (the common
// case - `npx <package>` style servers); HTTP/SSE transport not implemented.
//
// Protocol mechanics (line-delimited JSON-RPC 2.0 over stdin/stdout) verified directly against
// a real server (@modelcontextprotocol/server-everything) before writing this, not assumed from
// the spec alone - see the session notes for the verification transcript.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

#[derive(Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
}

#[derive(Clone, Serialize)]
pub struct McpTool {
    pub server: String,
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

struct Connection {
    child: Child,
    stdin: std::process::ChildStdin,
    pending: std::sync::Arc<Mutex<HashMap<u64, mpsc::Sender<Value>>>>,
    next_id: AtomicU64,
    tools: Vec<McpTool>,
}

#[derive(Default)]
pub struct McpState(Mutex<HashMap<String, Connection>>);

fn config_path(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .expect("app config dir should be resolvable");
    std::fs::create_dir_all(&dir).ok();
    dir.join("mcp_servers.json")
}

#[tauri::command]
pub fn get_mcp_servers_config(app: AppHandle) -> Vec<McpServerConfig> {
    std::fs::read_to_string(config_path(&app))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn save_mcp_servers_config(app: AppHandle, servers: Vec<McpServerConfig>) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&servers).map_err(|e| e.to_string())?;
    std::fs::write(config_path(&app), json).map_err(|e| e.to_string())
}

fn send_request(
    conn: &mut Connection,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let id = conn.next_id.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = mpsc::channel();
    conn.pending.lock().unwrap().insert(id, tx);

    let req = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
    let line = serde_json::to_string(&req).map_err(|e| e.to_string())? + "\n";
    conn.stdin
        .write_all(line.as_bytes())
        .map_err(|e| e.to_string())?;
    conn.stdin.flush().map_err(|e| e.to_string())?;

    rx.recv_timeout(Duration::from_secs(15))
        .map_err(|_| format!("MCP server did not respond to {} within 15s", method))
}

fn send_notification(conn: &mut Connection, method: &str, params: Value) -> Result<(), String> {
    let note = json!({ "jsonrpc": "2.0", "method": method, "params": params });
    let line = serde_json::to_string(&note).map_err(|e| e.to_string())? + "\n";
    conn.stdin
        .write_all(line.as_bytes())
        .map_err(|e| e.to_string())?;
    conn.stdin.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn connect_mcp_server(
    state: State<McpState>,
    config: McpServerConfig,
) -> Result<Vec<McpTool>, String> {
    let mut child = Command::new(&config.command)
        .args(&config.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("failed to spawn '{}': {}", config.command, e))?;

    let stdin = child.stdin.take().ok_or("no stdin handle")?;
    let stdout = child.stdout.take().ok_or("no stdout handle")?;

    let pending: std::sync::Arc<Mutex<HashMap<u64, mpsc::Sender<Value>>>> =
        std::sync::Arc::new(Mutex::new(HashMap::new()));
    let pending_for_reader = pending.clone();

    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            if line.trim().is_empty() {
                continue;
            }
            let Ok(value) = serde_json::from_str::<Value>(&line) else { continue };
            if let Some(id) = value.get("id").and_then(|v| v.as_u64()) {
                if let Some(tx) = pending_for_reader.lock().unwrap().remove(&id) {
                    let _ = tx.send(value);
                }
            }
            // Notifications from the server (no "id") are ignored - logging/progress updates
            // aren't surfaced in this implementation.
        }
    });

    let mut conn = Connection {
        child,
        stdin,
        pending,
        next_id: AtomicU64::new(1),
        tools: Vec::new(),
    };

    let init_result = send_request(
        &mut conn,
        "initialize",
        json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": { "name": "the-ai-project-pc", "version": "0.1.0" }
        }),
    )?;
    if init_result.get("error").is_some() {
        return Err(format!("MCP initialize failed: {}", init_result));
    }

    send_notification(&mut conn, "notifications/initialized", json!({}))?;

    let tools_result = send_request(&mut conn, "tools/list", json!({}))?;
    let tools: Vec<McpTool> = tools_result
        .get("result")
        .and_then(|r| r.get("tools"))
        .and_then(|t| t.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|t| {
                    Some(McpTool {
                        server: config.name.clone(),
                        name: t.get("name")?.as_str()?.to_string(),
                        description: t
                            .get("description")
                            .and_then(|d| d.as_str())
                            .unwrap_or("")
                            .to_string(),
                        input_schema: t.get("inputSchema").cloned().unwrap_or(json!({})),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    conn.tools = tools.clone();
    state.0.lock().unwrap().insert(config.name.clone(), conn);

    Ok(tools)
}

#[tauri::command]
pub fn disconnect_mcp_server(state: State<McpState>, name: String) -> Result<(), String> {
    if let Some(mut conn) = state.0.lock().unwrap().remove(&name) {
        let _ = conn.child.kill();
    }
    Ok(())
}

#[tauri::command]
pub fn list_mcp_tools(state: State<McpState>) -> Vec<McpTool> {
    state
        .0
        .lock()
        .unwrap()
        .values()
        .flat_map(|c| c.tools.clone())
        .collect()
}

#[tauri::command]
pub fn call_mcp_tool(
    state: State<McpState>,
    server: String,
    tool: String,
    arguments: Value,
) -> Result<Value, String> {
    let mut connections = state.0.lock().unwrap();
    let conn = connections
        .get_mut(&server)
        .ok_or_else(|| format!("MCP server '{}' is not connected", server))?;
    let result = send_request(
        conn,
        "tools/call",
        json!({ "name": tool, "arguments": arguments }),
    )?;
    if let Some(err) = result.get("error") {
        return Err(format!("{}", err));
    }
    Ok(result.get("result").cloned().unwrap_or(json!(null)))
}
