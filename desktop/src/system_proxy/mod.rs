//! macOS PAC ownership and recovery. Never replace a user's later proxy choice.
use std::{fs, path::PathBuf, process::Command, sync::{Mutex, atomic::{AtomicBool, Ordering}}};
use serde_json::{json, Value};

const PAC: &str = "http://127.0.0.1:8899/plugin.cafe-projects/cybercafe.pac";
static LOCK: Mutex<()> = Mutex::new(());
static QUITTING: AtomicBool = AtomicBool::new(false);
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
    if out.status.success() { Ok(()) } else { Err(format!("系统代理配置失败：{}", String::from_utf8_lossy(&out.stderr).trim())) }
}
fn restore_file(path: &PathBuf) -> Result<(), String> {
    if !path.exists() { return Ok(()); }
    let rows: Value = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let mut commands = Vec::new();
    let services = network(&["-listallnetworkservices"])?;
    for row in rows.as_array().ok_or("系统代理备份无效。")? {
        let service = row["service"].as_str().ok_or("代理备份缺少网络名称。")?;
        if !services.lines().any(|s| s.trim_start_matches('*') == service) { continue; }
        let current = network(&["-getautoproxyurl", service])?;
        if field(&current, "URL:") != PAC { continue; }
        let url = row["url"].as_str().unwrap_or("");
        commands.push(command(&["-setautoproxyurl", service, url]));
        for (key, flag) in [("pac", "-setautoproxystate"), ("web", "-setwebproxystate"), ("secureweb", "-setsecurewebproxystate"), ("discovery", "-setproxyautodiscovery")] {
            commands.push(command(&[flag, service, if row[key] == true { "on" } else { "off" }]));
        }
    }
    apply(commands)?;
    fs::remove_file(path).map_err(|e| e.to_string())
}
pub fn enable() -> Result<(), String> {
    let _lock = LOCK.lock().map_err(|e| e.to_string())?;
    if QUITTING.load(Ordering::Acquire) { return Ok(()); }
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


pub fn shutdown() -> Result<(), String> {
    QUITTING.store(true, Ordering::Release);
    restore()
}

pub fn monitor(app: tauri::AppHandle) {
    use tauri::Manager;
    std::thread::spawn(move || {
        let mut previous_error = String::new();
        let mut failed_target = None;
        while !QUITTING.load(Ordering::Acquire) {
            let result = (|| {
                let dir = crate::services::state_directory()?;
                let mode = fs::read_to_string(dir.join("proxy-mode")).unwrap_or_default();
                let target = mode.trim() == "system" && !crate::services::proxy_paused()
                    && crate::services::status() == crate::services::Status::Ready;
                // Retry after a mode change or app restart, never repeat authorization dialogs in a loop.
                if failed_target == Some(target) { return Ok(()); }
                let applied = if target { enable() } else { restore() };
                if applied.is_err() { failed_target = Some(target); } else { failed_target = None; }
                let status = match &applied {
                    Ok(()) => serde_json::json!({"mode":if target {"system"} else {"browser"}, "error":null}),
                    Err(error) => serde_json::json!({"mode":null,"error":error}),
                };
                let _ = fs::write(dir.join("proxy-mode-status.json"), status.to_string());
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
