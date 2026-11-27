//! A single, serialized shutdown path for the panel, tray menu and OS quit.
use std::sync::{atomic::{AtomicBool, Ordering}, Mutex, MutexGuard};
use tauri::{AppHandle, Manager};
#[cfg(any(target_os = "windows", test))]
mod windows;

static EXITING: AtomicBool = AtomicBool::new(false);
static EXIT_READY: AtomicBool = AtomicBool::new(false);
static OPERATIONS: Mutex<()> = Mutex::new(());

pub fn is_exiting() -> bool { EXITING.load(Ordering::Acquire) }
pub fn exit_ready() -> bool { EXIT_READY.load(Ordering::Acquire) }
pub fn operation_lock() -> MutexGuard<'static, ()> {
    OPERATIONS.lock().unwrap_or_else(|error| error.into_inner())
}

fn clean_up(
    stop_projects: impl FnOnce() -> Result<(), String>,
    restore_proxy: impl FnOnce() -> Result<(), String>,
    stop_whistle: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let mut errors = Vec::new();
    if let Err(error) = stop_projects() { errors.push(format!("停止项目服务失败：{error}")); }
    // Restore connectivity even when stopping a project fails. Keep Whistle
    // alive on failure so the panel can show the reason and retry cleanup.
    if let Err(error) = restore_proxy() { errors.push(format!("恢复代理配置失败：{error}")); }
    if !errors.is_empty() { return Err(errors.join("；")); }
    stop_whistle().map_err(|error| format!("停止 Whistle 失败：{error}"))
}

#[cfg(target_os = "windows")]
pub fn request_exit(app: &AppHandle) {
    if EXITING.swap(true, Ordering::AcqRel) { return; }
    let app = app.clone();
    std::thread::spawn(move || {
        let result = windows::bounded_cleanup(std::time::Duration::from_secs(15), || {
            let _operation = operation_lock();
            let projects = crate::services::stop_project_services();
            // A failed API must never prevent attempting owned Whistle cleanup.
            let whistle = crate::services::stop_owned();
            projects.and(whistle)
        });
        if let Err(error) = result { eprintln!("退出清理未完成：{error}"); }
        EXIT_READY.store(true, Ordering::Release);
        app.exit(0);
    });
}

#[cfg(not(target_os = "windows"))]
pub fn request_exit(app: &AppHandle) {
    if EXITING.swap(true, Ordering::AcqRel) { return; }
    #[cfg(target_os = "macos")]
    crate::system_proxy::pause();
    let app = app.clone();
    std::thread::spawn(move || {
        let result = {
            let _operation = operation_lock();
            clean_up(
                crate::services::stop_project_services,
                || {
                    #[cfg(target_os = "macos")]
                    crate::system_proxy::restore()?;
                    Ok(())
                },
                crate::services::stop_owned,
            )
        };
        match result {
            Ok(()) => {
                #[cfg(target_os = "macos")]
                crate::system_proxy::finish_shutdown();
                EXIT_READY.store(true, Ordering::Release);
                app.exit(0);
            }
            Err(error) => {
                // Leave the monitor paused: it must not replace the restored
                // settings while the user handles a failed exit.
                EXITING.store(false, Ordering::Release);
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || {
                    if let Some(window) = handle.get_webview_window("panel") {
                        let _ = window.show();
                        let _ = window.set_focus();
                        let message = serde_json::to_string(&error).unwrap_or_default();
                        let _ = window.eval(format!("import('./shared/toast/toast.mjs').then(m => m.showError({message}))"));
                    } else if let Some(window) = handle.get_webview_window("connection") {
                        let message = serde_json::to_string(&error).unwrap_or_default();
                        let _ = window.eval(format!("document.getElementById('connection-status').textContent = {message};"));
                    }
                    eprintln!("退出未完成：{error}");
                });
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[test]
    fn cleanup_restores_proxy_before_stopping_whistle() {
        let order = RefCell::new(Vec::new());
        clean_up(
            || { order.borrow_mut().push("projects"); Ok(()) },
            || { order.borrow_mut().push("proxy"); Ok(()) },
            || { order.borrow_mut().push("whistle"); Ok(()) },
        ).unwrap();
        assert_eq!(order.into_inner(), vec!["projects", "proxy", "whistle"]);
    }

    #[test]
    fn failure_restores_connectivity_but_keeps_whistle_for_retry() {
        let restored = RefCell::new(false);
        let error = clean_up(
            || Err("still running".into()),
            || { *restored.borrow_mut() = true; Ok(()) },
            || panic!("Whistle must remain available"),
        ).unwrap_err();
        assert!(*restored.borrow());
        assert!(error.contains("still running"));
    }

    #[test]
    fn proxy_restore_failure_prevents_exit() {
        assert!(clean_up(|| Ok(()), || Err("cancelled".into()),
            || panic!("must not stop Whistle before restoring proxy")).is_err());
    }
}
