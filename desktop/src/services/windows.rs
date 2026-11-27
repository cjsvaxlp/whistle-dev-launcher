use std::os::windows::process::CommandExt;
use std::{
    env,
    path::PathBuf,
    process::{Command, Output},
    sync::Mutex,
    thread,
    time::Duration,
};

use super::{status, Status, PANEL_URL};
static OWNED_PID: Mutex<Option<u32>> = Mutex::new(None);

fn shell(script: &str) -> Result<Output, String> {
    let script =
        format!("[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); {script}");
    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(output)
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_owned())
    }
}
fn literal(value: &str) -> String {
    format!("'{}'", value.replace(char::from(39), "''"))
}
fn tools() -> Result<PathBuf, String> {
    Ok(env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or("找不到应用目录")?
        .join("tools"))
}
pub(super) fn request(route: &str, post: bool) -> Result<serde_json::Value, String> {
    let timeout = if route == "api/stop-all" { 5 } else { 45 };
    let script = if post {
        format!("$ErrorActionPreference='Stop'; $b='{PANEL_URL}'; $t=(Invoke-RestMethod ($b+'api/token') -TimeoutSec 4).token; Invoke-RestMethod ($b+{}) -Method Post -Headers @{{'X-Cafe-Token'=$t}} -TimeoutSec {timeout} | ConvertTo-Json -Depth 12 -Compress", literal(route))
    } else {
        format!("$ErrorActionPreference='Stop'; Invoke-RestMethod {} -TimeoutSec 4 | ConvertTo-Json -Depth 12 -Compress", literal(&format!("{PANEL_URL}{route}")))
    };
    let script = format!(
        "try {{ {script} }} catch {{ $message = $_.Exception.Message; try {{ $body = $_.ErrorDetails.Message | ConvertFrom-Json -ErrorAction Stop; if ($body.message) {{ $message = $body.message }} }} catch {{}}; @{{ cafeRequestError = $message }} | ConvertTo-Json -Compress }}; exit 0"
    );
    let data: serde_json::Value =
        serde_json::from_slice(&shell(&script)?.stdout).map_err(|e| e.to_string())?;
    if let Some(message) = data["cafeRequestError"].as_str() {
        return Err(message.to_owned());
    }
    Ok(data)
}
pub fn state_directory() -> Result<PathBuf, String> {
    if let Some(dir) = env::var_os("CAFE_STATE_DIR") { return Ok(PathBuf::from(dir)); }
    env::var_os("LOCALAPPDATA").map(PathBuf::from)
        .map(|path| path.join("Cybercafe/data"))
        .ok_or_else(|| "无法读取本机应用数据目录。".into())
}
pub fn start() -> Result<Status, String> {
    let mut owned = OWNED_PID.lock().map_err(|e| e.to_string())?;
    if status() == Status::Offline {
        let root = tools()?;
        let output = shell(&format!(
            "& {{ {} }} -ToolsRoot {}",
            include_str!("windows-environment.ps1"),
            literal(&root.to_string_lossy()),
        ))?;
        let started = String::from_utf8_lossy(&output.stdout)
            .lines()
            .any(|line| line.contains("Whistle@") && line.trim_end().ends_with(" started"));
        for _ in 0..20 {
            if status() == Status::Ready {
                break;
            }
            thread::sleep(Duration::from_millis(250));
        }
        if started && status() == Status::Ready {
            let output = shell("(Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 8899 -State Listen -ErrorAction Stop | Select-Object -First 1).OwningProcess")?;
            *owned = String::from_utf8_lossy(&output.stdout).trim().parse().ok();
        }
    }
    if status() != Status::Ready {
        return Err("无法连接本机 Whistle 面板".into());
    }
    Ok(Status::Ready)
}
pub fn stop_owned() -> Result<(), String> { stop().map(|_| ()) }

pub fn stop() -> Result<Status, String> {
    let mut owned = OWNED_PID.lock().map_err(|e| e.to_string())?;
    if let Some(pid) = *owned {
        shell(&format!("$ErrorActionPreference='Stop'; $p=Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 8899 -State Listen -ErrorAction SilentlyContinue; if($p.OwningProcess -contains {pid}){{Stop-Process -Id {pid} -ErrorAction Stop}}"))?;
        *owned = None;
    }
    Ok(status())
}
pub fn open_browser_url(url: &str) -> Result<(), String> {
    shell(&format!("Start-Process {}", literal(url))).map(|_| ())
}
pub fn stop_project_services() -> Result<(), String> {
    if status() != Status::Offline {
        request("api/stop-all", true)?;
    }
    Ok(())
}
