use std::os::windows::process::CommandExt;
use std::{
    env,
    path::PathBuf,
    process::{Command, Output},
    sync::Mutex,
    thread,
    time::Duration,
};

pub const PANEL_URL: &str = "http://127.0.0.1:8899/plugin.cafe-projects/";
static OWNED_PID: Mutex<Option<u32>> = Mutex::new(None);

#[derive(PartialEq)]
pub enum Status {
    Offline,
    PanelUnavailable,
    Ready,
}
impl Status {
    pub fn description(&self) -> &'static str {
        match self {
            Self::Offline => "Whistle 未启动",
            Self::PanelUnavailable => "8899 已监听，面板不可用",
            Self::Ready => "Whistle 已连接",
        }
    }
}
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
fn request(route: &str, post: bool) -> Result<serde_json::Value, String> {
    let script = if post {
        format!("$ErrorActionPreference='Stop'; $b='{PANEL_URL}'; $t=(Invoke-RestMethod ($b+'api/token') -TimeoutSec 4).token; Invoke-RestMethod ($b+{}) -Method Post -Headers @{{'X-Cafe-Token'=$t}} -TimeoutSec 45 | ConvertTo-Json -Depth 12 -Compress", literal(route))
    } else {
        format!("$ErrorActionPreference='Stop'; Invoke-RestMethod {} -TimeoutSec 4 | ConvertTo-Json -Depth 12 -Compress", literal(&format!("{PANEL_URL}{route}")))
    };
    let script = format!(
        "try {{ {script} }} catch {{ $message = $_.Exception.Message; try {{ $body = $_.ErrorDetails.Message | ConvertFrom-Json -ErrorAction Stop; if ($body.message) {{ $message = $body.message }} }} catch {{}}; @{{ cafeRequestError = $message }} | ConvertTo-Json -Compress }}"
    );
    let data: serde_json::Value =
        serde_json::from_slice(&shell(&script)?.stdout).map_err(|e| e.to_string())?;
    if let Some(message) = data["cafeRequestError"].as_str() {
        return Err(message.to_owned());
    }
    Ok(data)
}
pub fn status() -> Status {
    if request("api/token", false).is_ok() {
        Status::Ready
    } else if std::net::TcpStream::connect_timeout(
        &"127.0.0.1:8899".parse().unwrap(),
        Duration::from_millis(300),
    )
    .is_ok()
    {
        Status::PanelUnavailable
    } else {
        Status::Offline
    }
}
pub fn proxy_paused() -> bool {
    env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|p| p.join("Cybercafe/data/proxy-disabled").is_file())
        .unwrap_or(false)
}
pub fn resume_proxy() -> Result<Status, String> {
    let mut owned = OWNED_PID.lock().map_err(|e| e.to_string())?;
    if status() == Status::Offline {
        let root = tools()?;
        let runtime = root.join("runtime");
        let bundled = runtime.join("node.exe");
        let cli = runtime.join("node_modules/whistle/bin/whistle.js");
        let script = format!(
            concat!(
                "$ErrorActionPreference='Stop'; ",
                "$node = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1; ",
                "$executable = {bundled}; ",
                "if ($node) {{ ",
                "  $version = & $node.Source --version 2>$null; ",
                "  if ($LASTEXITCODE -eq 0 -and $version -match '^v(\\d+)\\.') {{ ",
                "    if ([int]$Matches[1] -ge 22) {{ $executable = $node.Source }} ",
                "  }} ",
                "}}; ",
                "$env:PATH = (Split-Path -Parent $executable) + ';' + $env:PATH; ",
                "& $executable {cli} start -H 127.0.0.1 -p 8899 --addon {addon}; ",
                "if ($LASTEXITCODE -ne 0) {{ exit $LASTEXITCODE }}"
            ),
            bundled = literal(&bundled.to_string_lossy()),
            cli = literal(&cli.to_string_lossy()),
            addon = literal(&root.to_string_lossy()),
        );
        shell(&script)?;
        for _ in 0..20 {
            if status() == Status::Ready {
                break;
            }
            thread::sleep(Duration::from_millis(250));
        }
        let output = shell("(Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 8899 -State Listen -ErrorAction Stop | Select-Object -First 1).OwningProcess")?;
        *owned = String::from_utf8_lossy(&output.stdout).trim().parse().ok();
    }
    if status() != Status::Ready {
        return Err("无法连接本机 Whistle 面板".into());
    }
    if proxy_paused() {
        let projects = request("api/projects", false)?;
        if projects["workspace"]
            .as_str()
            .is_some_and(|path| !path.is_empty())
        {
            request("api/proxy/on", true)?;
        }
    }
    Ok(Status::Ready)
}
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
pub fn open_test() -> Result<(), String> {
    open_browser_url("https://cloudgametest2.migufun.com:18443/cybercafe-power/#/amsportal")
}
pub fn stop_project_services() -> Result<(), String> {
    if status() != Status::Offline {
        request("api/stop-all", true)?;
    }
    Ok(())
}
