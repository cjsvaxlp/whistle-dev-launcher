mod menu;
mod services;
mod window;

use tauri::RunEvent;

fn main() {
    let app = tauri::Builder::default()
        .setup(|app| {
            menu::setup(app)?;
            menu::run_action(app.handle(), "start");
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("无法启动 Cybercafe 桌面应用");
    app.run(|app, event| match event {
        RunEvent::ExitRequested {
            code: None, api, ..
        } => api.prevent_exit(),
        RunEvent::Exit => {
            let _ = services::stop();
        }
        RunEvent::Reopen { .. } => menu::run_action(app, "panel"),
        _ => {}
    });
}
