mod code_session;

use code_session::CodeSessionState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(CodeSessionState::default())
        .invoke_handler(tauri::generate_handler![
            code_session::list_skills,
            code_session::get_hooks_config,
            code_session::save_hooks_config,
            code_session::start_code_session,
            code_session::write_to_code_session,
            code_session::resize_code_session,
            code_session::stop_code_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
