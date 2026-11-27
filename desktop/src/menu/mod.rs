mod icon;

use std::{
    sync::atomic::{AtomicBool, Ordering},
    thread,
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    App, AppHandle, Manager,
};

use crate::{
    services::{self, Status},
    window::show_window,
};

struct MenuState {
    status: MenuItem<tauri::Wry>,
    busy: AtomicBool,
}

fn update_connection_status(app: &AppHandle, text: &str, busy: bool) {
    if let Some(window) = app.get_webview_window("connection") {
        let text = serde_json::to_string(text).expect("JSON string");
        let _ = window.eval(
            format!("document.getElementById('connection-status').textContent = {text};")
                + &format!(
            "document.getElementById('start-proxy').setAttribute('aria-disabled', '{busy}');"
        ),
        );
    }
}

#[cfg(target_os = "macos")]
pub fn is_busy(app: &AppHandle) -> bool {
    app.state::<MenuState>().busy.load(Ordering::Acquire)
}

pub fn run_action(app: &AppHandle, action: &str) {
    if crate::lifecycle::is_exiting() { return; }
    let state = app.state::<MenuState>();
    if state.busy.swap(true, Ordering::AcqRel) {
        return;
    }
    let panel = matches!(action, "panel" | "start");
    if action == "start" {
        update_connection_status(app, "正在启动 Whistle…", true);
    }
    let task = action.to_owned();
    let _ = state.status.set_text(match action {
        "start" => "正在启动 Whistle…",
        "stop" => "正在停止 Whistle…",
        _ => "正在检查…",
    });
    let app = app.clone();

    thread::spawn(move || {
        let result = {
            let _operation = crate::lifecycle::operation_lock();
            if crate::lifecycle::is_exiting() {
                Err("正在退出应用。".into())
            } else {
                match task.as_str() {
                    "start" => {
                        #[cfg(target_os = "macos")]
                        crate::system_proxy::resume();
                        services::resume_proxy()
                    }
                    "stop" => {
                        #[cfg(target_os = "macos")]
                        crate::system_proxy::pause();
                        services::stop_project_services().and_then(|_| {
                            #[cfg(target_os = "macos")]
                            crate::system_proxy::restore()?;
                            services::stop()
                        })
                    }
                    "test" => services::open_test().map(|_| Status::Ready),
                    _ => Ok(services::status()),
                }
            }
        };
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let state = handle.state::<MenuState>();
            state.busy.store(false, Ordering::Release);
            if crate::lifecycle::is_exiting() { return; }
            let text = match result {
                Ok(status) if panel => {
                    if task == "start" && status == Status::Ready {
                        if let Some(window) = handle.get_webview_window("panel") {
                            let _ = window.reload();
                        }
                    }
                    match show_window(&handle, &status) {
                        Ok(()) => status.description().to_owned(),
                        Err(error) => format!("打开面板失败：{error}"),
                    }
                }
                Ok(status) => {
                    if task == "stop" && status == Status::Offline {
                        if let Some(window) = handle.get_webview_window("panel") {
                            let _ = window.close();
                        }
                    }
                    status.description().to_owned()
                }
                Err(error) => {
                    if let Some(window) = handle.get_webview_window("panel") {
                        let message = serde_json::to_string(&error).expect("JSON error");
                        let _ = window.eval(format!("import('./shared/toast/toast.mjs').then(m => m.showError({message}))"));
                    }
                    if panel {
                        let _ = show_window(&handle, &Status::Offline);
                    }
                    error
                }
            };
            if task == "start" {
                update_connection_status(&handle, &text, false);
            }
            let _ = state.status.set_text(text);
        });
    });
}

pub fn setup(app: &App) -> tauri::Result<()> {
    let status = MenuItem::with_id(app, "status", "正在检查…", false, None::<&str>)?;
    let panel = MenuItem::with_id(app, "panel", "打开面板", true, None::<&str>)?;
    let start = MenuItem::with_id(app, "start", "开启代理 / 启动 Whistle", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop", "停止 Whistle", true, None::<&str>)?;
    let test = MenuItem::with_id(app, "test", "打开测试入口", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", "刷新连接状态", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出桌面应用", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &status, &panel, &start, &stop, &test, &refresh, &separator, &quit,
        ],
    )?;
    app.manage(MenuState {
        status,
        busy: AtomicBool::new(false),
    });

    TrayIconBuilder::new()
        .icon(icon::tray_icon())
        .icon_as_template(true)
        .tooltip("Cybercafe 本地调试")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "quit" => crate::lifecycle::request_exit(app),
            action => run_action(app, action),
        })
        .build(app)?;
    Ok(())
}
