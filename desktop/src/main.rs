#![cfg_attr(all(target_os = "windows", not(debug_assertions)), windows_subsystem = "windows")]

mod menu;
mod lifecycle;
#[cfg(target_os = "macos")]
mod system_proxy;
mod services;
mod window;

use tauri::RunEvent;

#[tauri::command]
#[cfg(target_os = "windows")]
async fn select_project_folder() -> Option<String> {
    rfd::AsyncFileDialog::new()
        .set_title("选择包含 cybercafe-* 子项目的目录")
        .pick_folder()
        .await
        .map(|folder| folder.path().to_string_lossy().into_owned())
}

#[tauri::command]
#[cfg(not(target_os = "windows"))]
fn select_project_folder() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("选择包含 cybercafe-* 子项目的目录")
        .pick_folder()
        .map(|path| path.to_string_lossy().into_owned())
}

fn main() {
    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![select_project_folder])
        .setup(|app| {
            menu::setup(app)?;
            menu::run_action(
                app.handle(),
                if services::proxy_paused() {
                    "panel"
                } else {
                    "start"
                },
            );
            #[cfg(target_os = "macos")]
            system_proxy::monitor(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("无法启动 Cybercafe 桌面应用");
    app.run(|_app, event| match event {
        RunEvent::ExitRequested { api, .. } => {
            if !lifecycle::exit_ready() {
                api.prevent_exit();
                lifecycle::request_exit(_app);
            }
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => menu::run_action(_app, "panel"),
        _ => {}
    });
}
