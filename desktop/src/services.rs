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

fn find_w2(contents: &Path) -> Result<PathBuf, String> {
    let configured = fs::read_to_string(contents.join("Resources/w2-path")).unwrap_or_default();
    let path = PathBuf::from(configured.trim());
    if path.is_absolute() && path.is_file() {
        return Ok(path);
    }
    // 换机器或重装 Node 后，构建时记录的路径会失效；用登录 shell 重新找一次。
    if let Ok(output) = Command::new("/bin/zsh")
        .args(["-lc", "whence -p w2"])
        .output()
    {
        let found = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !found.is_empty() && Path::new(&found).is_file() {
            return Ok(PathBuf::from(found));
        }
    }
    if let Some(home) = env::var_os("HOME") {
        let versions = PathBuf::from(home).join(".nvm/versions/node");
        if let Ok(entries) = fs::read_dir(versions) {
            let mut found: Vec<PathBuf> = entries
                .flatten()
                .map(|entry| entry.path().join("bin/w2"))
                .filter(|path| path.is_file())
                .collect();
            found.sort();
            if let Some(path) = found.pop() {
                return Ok(path);
            }
        }
    }
    for candidate in ["/opt/homebrew/bin/w2", "/usr/local/bin/w2"] {
        let path = PathBuf::from(candidate);
        if path.is_file() {
            return Ok(path);
        }
    }
    Err("找不到 w2。请先安装 Node.js 和 Whistle（npm i -g whistle），再启动桌面端。".into())
}

fn ensure_plugin(contents: &Path, w2: &Path) -> Result<(), String> {
    let tools = tools_directory(contents)?;
    let plugin = tools.join("whistle.cafe-projects");
    if !plugin.is_dir() {
        return Err("工具目录里缺少 whistle.cafe-projects 插件。".into());
    }
    let bin = w2
        .parent()
        .ok_or_else(|| "找不到 Node 安装目录。".to_string())?;
    let npm = bin.join("npm");
    let output = if npm.is_file() {
        Command::new(&npm).args(["root", "-g"]).output()
    } else {
        Command::new("/bin/zsh")
            .args(["-lc", "npm root -g"])
            .output()
    }
    .map_err(|error| format!("查找全局 node_modules 失败：{error}"))?;
    if !output.status.success() {
        return Err("查找全局 node_modules 失败，请确认 npm 可用。".into());
    }
    let root = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if root.is_empty() {
        return Err("npm root -g 没有返回路径。".into());
    }
    let target = PathBuf::from(root).join("whistle.cafe-projects");
    if target.exists() {
        let same = fs::canonicalize(&target).ok() == fs::canonicalize(&plugin).ok();
        return if same {
            Ok(())
        } else {
            Err(format!(
                "全局已存在另一份 whistle.cafe-projects：{}。请先移除它。",
                target.display()
            ))
        };
    }
    std::os::unix::fs::symlink(&plugin, &target).map_err(|error| {
        format!(
            "链接插件失败：{error}。请手动把 {} 链接到 {}。",
            plugin.display(),
            target.display()
        )
    })
}

pub fn start() -> Result<Status, String> {
    let mut owned = OWNED_WHISTLE.lock().expect("Whistle lifecycle lock");
    let current = status();
    if current != Status::Offline {
        return Ok(current);
    }
    let contents = app_contents()?;
    let executable = find_w2(&contents)?;
    ensure_plugin(&contents, &executable)?;
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
