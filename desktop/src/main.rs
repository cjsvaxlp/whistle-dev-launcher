#![cfg_attr(all(target_os = "windows", not(debug_assertions)), windows_subsystem = "windows")]

mod menu;
mod lifecycle;
#[cfg(target_os = "macos")]
mod system_proxy;
mod services;
mod window;

use tauri::RunEvent;

fn main() {
    let app = tauri::Builder::default()
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
