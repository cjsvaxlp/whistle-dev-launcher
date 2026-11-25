//! macOS PAC ownership and recovery. Never replace a user's later proxy choice.
use std::{fs, path::PathBuf, process::Command, sync::{Mutex, atomic::{AtomicBool, AtomicU64, Ordering}}};
use serde_json::{json, Value};

const PAC: &str = "http://127.0.0.1:8899/plugin.cafe-projects/cybercafe.pac";
static LOCK: Mutex<()> = Mutex::new(());
static QUITTING: AtomicBool = AtomicBool::new(false);
static PAUSED: AtomicBool = AtomicBool::new(false);
static RETRY: AtomicU64 = AtomicU64::new(0);
static ACTIVE: AtomicBool = AtomicBool::new(false);

fn backup_path() -> Result<PathBuf, String> {
    Ok(crate::services::state_directory()?.join("system-proxy-backup.json"))
}
fn network(args: &[&str]) -> Result<String, String> {
    let out = Command::new("/usr/sbin/networksetup").args(args).env("LC_ALL", "C").output().map_err(|e| e.to_string())?;
    if !out.status.success() { return Err(String::from_utf8_lossy(&out.stderr).into_owned()); }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}
fn field(text: &str, name: &str) -> String {
    text.lines().find_map(|line| line.strip_prefix(name)).unwrap_or("").trim().to_owned()
}
fn quote(value: &str) -> String { format!("'{}'", value.replace('\'', "'\\''")) }
fn command(args: &[&str]) -> String {
    format!("/usr/sbin/networksetup {}", args.iter().map(|s| quote(s)).collect::<Vec<_>>().join(" "))
}
fn apply(commands: Vec<String>) -> Result<(), String> {
    if commands.is_empty() { return Ok(()); }
    let shell = format!("set -e\n{}", commands.join("\n"));
    // JSON string escaping is also valid for the AppleScript string used here.
    let script = format!("do shell script {} with administrator privileges", serde_json::to_string(&shell).unwrap());
    let out = Command::new("/usr/bin/osascript").args(["-e", &script]).output().map_err(|e| e.to_string())?;
    if out.status.success() { return Ok(()); }
    let detail = String::from_utf8_lossy(&out.stderr);
    eprintln!("系统代理命令失败：{detail}");
    Err(authorization_error(&detail))
}
fn authorization_error(detail: &str) -> String {
    if detail.contains("(-128)") || detail.contains("User canceled") {
        "已取消网络设置授权；可切换代理模式后重试。".into()
    } else {
        "无法更新系统代理，请检查网络设置权限后重试。".into()
    }
}

fn restore_file(path: &PathBuf) -> Result<(), String> {
    if !path.exists() { return Ok(()); }
    let rows: Value = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let services = network(&["-listallnetworkservices"])?;
    let mut needs_restore = false;
    for row in rows.as_array().ok_or("系统代理备份无效。")? {
        let service = row["service"].as_str().ok_or("代理备份缺少网络名称。")?;
        if !services.lines().any(|s| s.trim_start_matches('*') == service) { continue; }
        if field(&network(&["-getautoproxyurl", service])?, "URL:") == PAC { needs_restore = true; }
    }
    if needs_restore {
        // networksetup rejects an empty URL. Remove that field through the
        // supported preferences API instead, preserving all unrelated settings.
        let script = include_str!("restore.js");
        apply(vec![format!("/usr/bin/osascript -l JavaScript -e {} -- {} {}",
            quote(script), quote(&rows.to_string()), quote(PAC))])?;
    }
    fs::remove_file(path).map_err(|e| e.to_string())
}

pub fn enable() -> Result<(), String> {
    let _lock = LOCK.lock().map_err(|e| e.to_string())?;
    if QUITTING.load(Ordering::Acquire) || PAUSED.load(Ordering::Acquire) { return Ok(()); }
    let path = backup_path()?;
    if ACTIVE.load(Ordering::Acquire) { return Ok(()); }
    // Recover a previous interrupted session before taking a fresh snapshot.
    if path.exists() { restore_file(&path)?; }
    let services = network(&["-listallnetworkservices"])?;
    let mut rows = Vec::new();
    let mut commands = Vec::new();
    for service in services.lines().skip(1).filter(|s| !s.starts_with('*') && !s.is_empty()) {
        let pac = network(&["-getautoproxyurl", service])?;
        let web = network(&["-getwebproxy", service])?;
        let secureweb = network(&["-getsecurewebproxy", service])?;
        let discovery = network(&["-getproxyautodiscovery", service])?;
        let url = field(&pac, "URL:");
        let url = if url == "(null)" { String::new() } else { url };
        rows.push(json!({"service":service,"url":url,"pac":field(&pac,"Enabled:")=="Yes","web":field(&web,"Enabled:")=="Yes","secureweb":field(&secureweb,"Enabled:")=="Yes","discovery":field(&discovery,"Auto Proxy Discovery:")=="On"}));
        commands.push(command(&["-setautoproxyurl", service, PAC]));
        commands.push(command(&["-setautoproxystate", service, "on"]));
        for flag in ["-setwebproxystate", "-setsecurewebproxystate", "-setproxyautodiscovery"] { commands.push(command(&[flag, service, "off"])); }
    }
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    use std::os::unix::fs::OpenOptionsExt;
    use std::io::Write;
    let mut file = fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(&path).map_err(|e| e.to_string())?;
    file.write_all(serde_json::to_string_pretty(&rows).unwrap().as_bytes()).and_then(|_|file.sync_all()).map_err(|e| e.to_string())?;
    if let Err(error) = apply(commands) {
        if let Err(rollback) = restore_file(&path) { return Err(format!("{error}；恢复失败：{rollback}")); }
        return Err(error);
    }
    ACTIVE.store(true, Ordering::Release);
    Ok(())
}
pub fn restore() -> Result<(), String> {
    let _lock = LOCK.lock().map_err(|e| e.to_string())?;
    restore_file(&backup_path()?)?;
    ACTIVE.store(false, Ordering::Release);
    Ok(())
}


pub fn pause() { PAUSED.store(true, Ordering::Release); }
pub fn resume() {
    RETRY.fetch_add(1, Ordering::AcqRel);
    PAUSED.store(false, Ordering::Release);
}
pub fn finish_shutdown() { QUITTING.store(true, Ordering::Release); }

fn write_status(dir: &std::path::Path, value: Value) {
    if fs::create_dir_all(dir).is_err() { return; }
    let temporary = dir.join(format!("proxy-mode-status.{}.tmp", std::process::id()));
    if fs::write(&temporary, value.to_string()).is_ok() {
        let _ = fs::rename(temporary, dir.join("proxy-mode-status.json"));
    }
}

pub fn monitor(app: tauri::AppHandle) {
    use tauri::Manager;
    // Clear the previous session's error before opening the panel. A new
    // authorization prompt must not display an old cancellation toast.
    if let Ok(dir) = crate::services::state_directory() {
        write_status(&dir, serde_json::json!({"mode":null,"error":null,"pending":true,"message":"正在检查代理"}));
    }
    std::thread::spawn(move || {
        let mut previous_error = String::new();
        let mut failed_intent = None;
        while !QUITTING.load(Ordering::Acquire) {
            if PAUSED.load(Ordering::Acquire) {
                std::thread::sleep(std::time::Duration::from_millis(200));
                continue;
            }
            let result = (|| {
                let dir = crate::services::state_directory()?;
                let mode_file = dir.join("proxy-mode");
                let mode = fs::read_to_string(&mode_file).unwrap_or_default();
                let requested = mode.trim() == "system" && !crate::services::proxy_paused();
                let intent = (requested, fs::metadata(&mode_file).and_then(|m| m.modified()).ok(), RETRY.load(Ordering::Acquire));
                // An authorization cancellation belongs to the user selection,
                // never to a transient Whistle readiness check.
                if failed_intent == Some(intent) { return Ok(()); }
                let target = if requested {
                    match crate::services::status() {
                        crate::services::Status::Ready => true,
                        crate::services::Status::PanelUnavailable => return Ok(()),
                        crate::services::Status::Offline => false,
                    }
                } else { false };
                let changes = if target { !ACTIVE.load(Ordering::Acquire) } else { backup_path()?.exists() };
                if changes {
                    write_status(&dir, serde_json::json!({"mode":null,"error":null,"pending":true,"message":"等待系统授权"}));
                }
                let applied = if target { enable() } else { restore() };
                if applied.is_err() { failed_intent = Some(intent); } else { failed_intent = None; }
                let status = match &applied {
                    Ok(()) => serde_json::json!({"mode":if target {"system"} else {"browser"}, "error":null,"pending":false}),
                    Err(error) => serde_json::json!({"mode":null,"error":error,"pending":false}),
                };
                write_status(&dir, status);
                applied
            })();
            match result {
                Err(error) if error != previous_error => {
                    previous_error = error.clone();
                    let handle = app.clone();
                    let _ = app.run_on_main_thread(move || {
                        if let Some(window) = handle.get_webview_window("panel") {
                            let message = serde_json::to_string(&error).unwrap_or_default();
                            let _ = window.eval(format!("import('./shared/toast/toast.mjs').then(m => m.showError({message}))"));
                        }
                    });
                }
                Ok(()) => previous_error.clear(),
                _ => {}
            }
            std::thread::sleep(std::time::Duration::from_secs(2));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancellation_has_a_readable_message() {
        let message = authorization_error("0:1684: execution error: User canceled. (-128)");
        assert!(message.contains("已取消网络设置授权"));
        assert!(!message.contains("execution error"));
    }
}
