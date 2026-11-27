use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    thread,
    time::Duration,
};

use super::{status, Status, PANEL_URL};

fn app_contents() -> Result<PathBuf, String> {
    env::current_exe()
        .ok()
        .and_then(|path| path.parent()?.parent().map(Path::to_path_buf))
        .filter(|path| path.join("Info.plist").is_file())
        .ok_or_else(|| "请通过启动桌面端脚本运行 Cybercafe.app。".into())
}

fn tools_directory(contents: &Path) -> Result<PathBuf, String> {
    let bundled = contents.join("Resources/tools");
    if bundled.join("whistle.cafe-projects").is_dir() {
        return Ok(bundled);
    }
    // The launcher keeps the local app bundle inside the repository’s .cafe-tools directory.
    contents
        .ancestors()
        .nth(3)
        .filter(|path| path.join("whistle.cafe-projects").is_dir())
        .map(Path::to_path_buf)
        .ok_or_else(|| "找不到工具目录，请通过仓库中的启动脚本打开应用。".into())
}

pub fn state_directory() -> Result<PathBuf, String> {
    if let Some(dir) = env::var_os("CAFE_STATE_DIR") { return Ok(PathBuf::from(dir)); }
    let tools = tools_directory(&app_contents()?)?;
    if tools.join(".installed").is_file() {
        Ok(PathBuf::from(env::var_os("HOME").ok_or("无法读取用户目录。")?).join("Library/Application Support/Cybercafe"))
    } else { Ok(tools.join(".cafe-tools")) }
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
    let output = Command::new("/bin/zsh")
        .args(["-lc", include_str!("macos-environment.sh")])
        .output()
        .map_err(|error| format!("自动安装 Whistle 失败：{error}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        let tail: String = detail.chars().rev().take(1500).collect::<Vec<_>>().into_iter().rev().collect();
        return Err(tail.trim().to_owned());
    }
    let found = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
    if found.is_absolute() && found.is_file() { return Ok(found); }
    Err("Whistle 安装后未找到 w2，请检查 npm 全局安装目录。".into())
}

fn ensure_plugin(contents: &Path, w2: &Path, path: &std::ffi::OsStr) -> Result<(), String> {
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
        Command::new(&npm)
            .args(["root", "-g"])
            .env("PATH", path)
            .output()
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
    if current == Status::Ready {
        return Ok(current);
    }
    if current == Status::PanelUnavailable {
        // Whistle 的端口先起来、插件后加载；这里等插件可用，避免菜单刚启动就报“面板不可用”。
        for _ in 0..40 {
            thread::sleep(Duration::from_millis(250));
            let next = status();
            if next == Status::Ready {
                return Ok(next);
            }
        }
        return Ok(Status::PanelUnavailable);
    }
    let contents = app_contents()?;
    let executable = find_w2(&contents)?;
    let bin = executable.parent().expect("w2 parent");
    let path = env::join_paths(
        std::iter::once(bin.to_path_buf())
            .chain(env::split_paths(&env::var_os("PATH").unwrap_or_default())),
    )
    .map_err(|error| error.to_string())?;
    let tools = tools_directory(&contents)?;
    // An installer can replace the app bundle while the Whistle daemon is still running.
    let working_directory = env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute() && path.is_dir())
        .unwrap_or_else(|| PathBuf::from("/"));
    let mut command = Command::new(&executable);
    command.args(["start", "-H", "127.0.0.1", "-p", "8899"]);
    if tools.join(".installed").is_file() {
        command.arg("--addon").arg(&tools);
    } else {
        ensure_plugin(&contents, &executable, &path)?;
    }
    let output = command
        .current_dir(working_directory)
        .env("PATH", path)
        .output()
        .map_err(|error| format!("启动 Whistle 失败：{error}"))?;
    let started = String::from_utf8_lossy(&output.stdout)
        .lines()
        .any(|line| line.contains("Whistle@") && line.trim_end().ends_with(" started"));
    error_output(output, "启动 Whistle 失败")?;
    let mut panel_seen = false;
    for _ in 0..40 {
        let current = status();
        if current == Status::Ready {
            if started {
                *owned = listener_pid();
            }
            return Ok(current);
        }
        if current == Status::PanelUnavailable {
            panel_seen = true;
        }
        thread::sleep(Duration::from_millis(250));
    }
    if panel_seen {
        return Ok(Status::PanelUnavailable);
    }
    Err("Whistle 启动后未监听 8899。".into())
}

pub fn stop() -> Result<Status, String> { stop_managed(false) }

pub fn stop_owned() -> Result<(), String> { stop_managed(true).map(|_| ()) }

fn stop_managed(only_owned: bool) -> Result<Status, String> {
    let mut owned = OWNED_WHISTLE.lock().expect("Whistle lifecycle lock");
    let Some(pid) = *owned else {
        if only_owned { return Ok(status()); }
        return if status() == Status::Offline {
            Ok(Status::Offline)
        } else {
            Err("当前 Whistle 由其他程序启动，请在原启动位置停止。".into())
        };
    };
    if listener_pid() != Some(pid) {
        *owned = None;
        if only_owned { return Ok(status()); }
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

pub fn open_browser_url(url: &str) -> Result<(), String> {
    let contents = app_contents()?;
    let script = tools_directory(&contents)?.join("scripts/browser/open-browser.js");
    let output = Command::new("/usr/bin/osascript")
        .args(["-l", "JavaScript"])
        .arg(script)
        .arg(url)
        .output()
        .map_err(|error| format!("打开浏览器失败：{error}"))?;
    error_output(output, "打开浏览器失败")
}


fn project_request(route: &str, token: Option<&str>) -> Result<(u16, serde_json::Value), String> {
    let mut command = Command::new("/usr/bin/curl");
    command.args(["--noproxy", "*", "-sS", "--max-time", if route == "api/token" { "2" } else { "45" }, "-w", "\n%{http_code}"]);
    if let Some(token) = token {
        command.args(["-X", "POST", "-H"]).arg(format!("X-Cafe-Token: {token}"));
    }
    let response = command.arg(format!("{PANEL_URL}{route}")).output()
        .map_err(|error| format!("无法连接本机插件：{error}"))?;
    if !response.status.success() {
        return Err("无法连接本机 Whistle，请确认服务仍在运行。".into());
    }
    let text = String::from_utf8_lossy(&response.stdout);
    let (body, code) = text.rsplit_once('\n').ok_or("插件响应无效。")?;
    let code = code.trim().parse::<u16>().map_err(|_| "插件响应状态无效。")?;
    let data = serde_json::from_str(body).unwrap_or(serde_json::Value::Null);
    Ok((code, data))
}

fn project_error(code: u16, data: &serde_json::Value) -> String {
    data["message"].as_str().map(str::to_owned)
        .unwrap_or_else(|| format!("插件返回 HTTP {code}，请更新应用并重启 Whistle。"))
}

pub fn stop_project_services() -> Result<(), String> {
    if status() == Status::Offline {
        return Ok(());
    }
    let (code, data) = project_request("api/token", None)?;
    if code != 200 {
        return Err(project_error(code, &data));
    }
    let token = data["token"].as_str().ok_or("无法获取停止服务的操作令牌。")?;
    let (code, data) = project_request("api/stop-all", Some(token))?;
    if code == 200 {
        return Ok(());
    }
    if code != 404 {
        return Err(project_error(code, &data));
    }

    // Older plugin bundles expose per-project stop routes only.
    let (code, data) = project_request("api/projects", None)?;
    if code != 200 {
        return Err(project_error(code, &data));
    }
    let projects = data["projects"].as_array().ok_or("无法读取待停止的项目列表。")?;
    if projects.iter().any(|project| project["installing"] == true || project["launching"] == true) {
        return Err("旧版插件仍有启动或安装任务，请等待任务结束后关闭，或更新应用并重启 Whistle。".into());
    }
    let mut errors = Vec::new();
    for project in projects {
        if project["active"] != true && project["unmatched"].is_null() {
            continue;
        }
        let name = project["name"].as_str().ok_or("项目名称无效。")?;
        if name.is_empty() || !name.bytes().all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == b'-') {
            return Err("项目名称无效，已取消停止。".into());
        }
        let (code, data) = project_request(&format!("api/stop/{name}"), Some(token))?;
        if code != 200 {
            errors.push(format!("{name}：{}", project_error(code, &data)));
        }
    }
    if errors.is_empty() { Ok(()) } else { Err(errors.join("；")) }
}

pub(super) fn request(route: &str, post: bool) -> Result<serde_json::Value, String> {
    let token_data = if post { Some(request("api/token", false)?) } else { None };
    let token = match &token_data {
        Some(data) => Some(data["token"].as_str().ok_or("无法获取本机 Whistle 操作令牌。")?),
        None => None,
    };
    let (code, data) = project_request(route, token)?;
    if code != 200 { return Err(project_error(code, &data)); }
    Ok(data)
}
