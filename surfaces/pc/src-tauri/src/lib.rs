mod agents;
mod code_session;
mod db;
mod mcp;
mod research;

use code_session::CodeSessionState;
use mcp::McpState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(CodeSessionState::default())
        .manage(McpState::default())
        .setup(|app| {
            let database = db::init(&app.handle());
            agents::seed_default_agents(&database);
            app.manage(database);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            code_session::list_skills,
            code_session::get_hooks_config,
            code_session::save_hooks_config,
            code_session::start_code_session,
            code_session::write_to_code_session,
            code_session::resize_code_session,
            code_session::stop_code_session,
            db::list_sessions,
            db::create_session,
            db::rename_session,
            db::delete_session,
            db::get_session_messages,
            db::append_message,
            db::list_memories,
            db::add_memory,
            db::delete_memory,
            db::get_memory_context,
            mcp::get_mcp_servers_config,
            mcp::save_mcp_servers_config,
            mcp::connect_mcp_server,
            mcp::disconnect_mcp_server,
            mcp::list_mcp_tools,
            mcp::call_mcp_tool,
            research::search_journal_articles,
            agents::list_agents,
            agents::save_agent,
            agents::delete_agent,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
