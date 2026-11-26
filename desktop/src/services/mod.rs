//! Shared desktop service flow; only native environment/process operations vary.
#[cfg(not(target_os = "windows"))]
#[path = "macos.rs"]
mod platform;
#[cfg(target_os = "windows")]
#[path = "windows.rs"]
mod platform;

use std::{net::TcpStream, thread, time::Duration};
pub use platform::{open_browser_url, state_directory, stop, stop_owned, stop_project_services};

pub const PANEL_URL: &str = "http://127.0.0.1:8899/plugin.cafe-projects/";
const TEST_URL: &str = "https://cloudgametest2.migufun.com:18443/cybercafe-power/#/amsportal";

#[derive(PartialEq, Debug)]
pub enum Status { Offline, PanelUnavailable, Ready }
impl Status {
    pub fn description(&self) -> &'static str {
        match self {
            Self::Offline => "Whistle 未启动",
            Self::PanelUnavailable => "8899 已监听，面板不可用",
            Self::Ready => "Whistle 已连接",
        }
    }
}

fn valid_token(data: &serde_json::Value) -> bool {
    data["token"].as_str().is_some_and(|token|
        token.len() == 64 && token.bytes().all(|byte| byte.is_ascii_hexdigit()))
}

pub fn status() -> Status {
    if TcpStream::connect_timeout(&"127.0.0.1:8899".parse().unwrap(), Duration::from_millis(300)).is_err() {
        return Status::Offline;
    }
    match platform::request("api/token", false) {
        Ok(data) if valid_token(&data) => Status::Ready,
        _ => Status::PanelUnavailable,
    }
}

pub fn proxy_paused() -> bool {
    state_directory().map(|dir| dir.join("proxy-disabled").is_file()).unwrap_or(false)
}

pub fn resume_proxy() -> Result<Status, String> {
    let status = platform::start()?;
    if status != Status::Ready || !proxy_paused() { return Ok(status); }
    let projects = platform::request("api/projects", false)?;
    if !projects["workspace"].as_str().is_some_and(|path| !path.is_empty()) { return Ok(status); }
    for attempt in 0..3 {
        match platform::request("api/proxy/on", true) {
            Ok(_) => return Ok(status),
            Err(error) if error.contains("正在切换") => return Ok(status),
            Err(error) if attempt == 2 => return Err(error),
            Err(_) => thread::sleep(Duration::from_millis(500)),
        }
    }
    Ok(status)
}

pub fn open_test() -> Result<(), String> {
    if status() != Status::Ready { return Err("请先启动 Whistle 并确认面板已连接。".into()); }
    open_browser_url(TEST_URL)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_a_real_panel_token_counts_as_ready() {
        assert!(valid_token(&serde_json::json!({"token": "a".repeat(64)})));
        for token in ["", "not-a-token", &"z".repeat(64)] {
            assert!(!valid_token(&serde_json::json!({"token": token})));
        }
        assert!(!valid_token(&serde_json::json!({"ok": true})));
    }
}
