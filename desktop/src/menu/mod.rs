use std::{
    sync::atomic::{AtomicBool, Ordering},
    thread,
};
use tauri::{
    image::Image,
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

pub fn run_action(app: &AppHandle, action: &str) {
    let state = app.state::<MenuState>();
    if state.busy.swap(true, Ordering::AcqRel) {
        return;
    }
    let panel = matches!(action, "panel" | "start");
    let task = action.to_owned();
    let _ = state.status.set_text(match action {
        "start" => "正在启动 Whistle…",
        "stop" => "正在停止 Whistle…",
        _ => "正在检查…",
    });
    let app = app.clone();

    thread::spawn(move || {
        let result = match task.as_str() {
            "start" => services::start(),
            "stop" => services::stop(),
            "test" => services::open_test().map(|_| Status::Ready),
            _ => Ok(services::status()),
        };
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let state = handle.state::<MenuState>();
            state.busy.store(false, Ordering::Release);
            let text = match result {
                Ok(status) if panel => match show_window(&handle, &status) {
                    Ok(()) => status.description().to_owned(),
                    Err(error) => format!("打开面板失败：{error}"),
                },
                Ok(status) => {
                    if task == "stop" && status == Status::Offline {
                        if let Some(window) = handle.get_webview_window("panel") {
                            let _ = window.close();
                        }
                    }
                    status.description().to_owned()
                }
                Err(error) => {
                    if panel {
                        let _ = show_window(&handle, &Status::Offline);
                    }
                    error
                }
            };
            let _ = state.status.set_text(text);
        });
    });
}

pub fn setup(app: &App) -> tauri::Result<()> {
    let status = MenuItem::with_id(app, "status", "正在检查…", false, None::<&str>)?;
    let panel = MenuItem::with_id(app, "panel", "打开面板", true, None::<&str>)?;
    let start = MenuItem::with_id(app, "start", "启动 Whistle", true, None::<&str>)?;
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

    let icon = app
        .default_window_icon()
        .cloned()
        .unwrap_or_else(|| Image::new_owned(vec![255; 16 * 16 * 4], 16, 16));
    TrayIconBuilder::new()
        .icon(icon)
        .icon_as_template(true)
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "quit" => app.exit(0),
            action => run_action(app, action),
        })
        .build(app)?;
    Ok(())
}
