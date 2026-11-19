use std::{
    env, fs,
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    thread,
    time::Duration,
};

pub const PANEL_URL: &str = "http://127.0.0.1:8899/plugin.cafe-projects/";

fn app_contents() -> Result<PathBuf, String> {
    env::current_exe()
        .ok()
        .and_then(|path| path.parent()?.parent().map(Path::to_path_buf))
        .filter(|path| path.join("Info.plist").is_file())
        .ok_or_else(|| "请通过启动桌面端脚本运行 Cybercafe.app。".into())
}

fn tools_directory(contents: &Path) -> Result<&Path, String> {
    // The launcher keeps the local app bundle inside the repository’s .cafe-tools directory.
    contents
        .ancestors()
        .nth(3)
        .filter(|path| path.join("whistle.cafe-projects").is_dir())
        .ok_or_else(|| "找不到工具目录，请通过仓库中的启动脚本打开应用。".into())
}

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

pub fn status() -> Status {
    let address = SocketAddr::from(([127, 0, 0, 1], 8899));
    if TcpStream::connect_timeout(&address, Duration::from_millis(300)).is_err() {
        return Status::Offline;
    }
    let result = Command::new("/usr/bin/curl")
        .args(["--noproxy", "*", "--fail", "--silent", "--max-time", "2"])
        .arg(format!("{PANEL_URL}api/token"))
        .output();
    let has_token = result
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| serde_json::from_slice::<serde_json::Value>(&output.stdout).ok())
        .and_then(|data| {
            data["token"]
                .as_str()
                .map(|token| token.len() == 64 && token.bytes().all(|b| b.is_ascii_hexdigit()))
        })
        .unwrap_or(false);
    if has_token {
        Status::Ready
    } else {
        Status::PanelUnavailable
    }
}

fn error_output(output: std::process::Output, fallback: &str) -> Result<(), String> {
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(stderr
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or(fallback)
        .to_owned())
}

static OWNED_WHISTLE: Mutex<Option<u32>> = Mutex::new(None);

fn listener_pid() -> Option<u32> {
    let output = Command::new("/usr/sbin/lsof")
        .args(["-nP", "-a", "-iTCP:8899", "-sTCP:LISTEN", "-Fp"])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut pids = stdout
        .lines()
        .filter_map(|line| line.strip_prefix('p')?.parse().ok());
    let pid = pids.next()?;
    pids.next().is_none().then_some(pid)
}

pub fn start() -> Result<Status, String> {
    let mut owned = OWNED_WHISTLE.lock().expect("Whistle lifecycle lock");
    let current = status();
    if current != Status::Offline {
        return Ok(current);
    }
    let contents = app_contents()?;
    let configured = fs::read_to_string(contents.join("Resources/w2-path")).unwrap_or_default();
    let executable = PathBuf::from(configured.trim_end_matches('\n'));
    if !executable.is_absolute() || !executable.is_file() {
        return Err("找不到 w2。配置 Whistle 后，请运行启动桌面端.command --rebuild。".into());
    }
    let bin = executable.parent().expect("w2 parent");
    let path = env::join_paths(
        std::iter::once(bin.to_path_buf())
            .chain(env::split_paths(&env::var_os("PATH").unwrap_or_default())),
    )
    .map_err(|error| error.to_string())?;
    let output = Command::new(executable)
        .args(["start", "-H", "127.0.0.1", "-p", "8899"])
        .current_dir(tools_directory(&contents)?)
        .env("PATH", path)
        .output()
        .map_err(|error| format!("启动 Whistle 失败：{error}"))?;
    let started = String::from_utf8_lossy(&output.stdout)
        .lines()
        .any(|line| line.contains("Whistle@") && line.trim_end().ends_with(" started"));
    error_output(output, "启动 Whistle 失败")?;
    for _ in 0..12 {
        let current = status();
        if current != Status::Offline {
            if started {
                *owned = listener_pid();
            }
            return Ok(current);
        }
        thread::sleep(Duration::from_millis(250));
    }
    Err("Whistle 启动后未监听 8899。".into())
}

pub fn stop() -> Result<Status, String> {
    let mut owned = OWNED_WHISTLE.lock().expect("Whistle lifecycle lock");
    let Some(pid) = *owned else {
        return if status() == Status::Offline {
            Ok(Status::Offline)
        } else {
            Err("当前 Whistle 由其他程序启动，请在原启动位置停止。".into())
        };
    };
    if listener_pid() != Some(pid) {
        *owned = None;
        return if status() == Status::Offline {
            Ok(Status::Offline)
        } else {
            Err("Whistle 实例已变更，请在原启动位置停止。".into())
        };
    }
    let output = Command::new("/bin/kill")
        .arg("-TERM")
        .arg(pid.to_string())
        .output()
        .map_err(|error| format!("停止 Whistle 失败：{error}"))?;
    error_output(output, "停止 Whistle 失败")?;
    for _ in 0..20 {
        if listener_pid() != Some(pid) {
            *owned = None;
            return Ok(status());
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err("Whistle 尚未停止，请稍后重试。".into())
}

pub fn open_test() -> Result<(), String> {
    if status() != Status::Ready {
        return Err("请先启动 Whistle 并确认面板已连接。".into());
    }
    let contents = app_contents()?;
    let output = Command::new("/bin/zsh")
        .arg(tools_directory(&contents)?.join("打开测试环境.command"))
        .output()
        .map_err(|error| format!("打开开发 Chrome 失败：{error}"))?;
    error_output(output, "打开开发 Chrome 失败")
}
