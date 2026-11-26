# whistle-dev-launcher

Cybercafe 本地开发工具：把测试环境里的任意 `cybercafe-*` 子应用切到本机开发服务，入口、路径、登录态保持不变。

- 面板：<http://127.0.0.1:8899/plugin.cafe-projects/>
- 规则：Whistle 里一条托管规则「Cafe 自动代理」
- 徽标：子应用页面右下角显示「本地接管 / 测试部署」
- 完整安装、日常使用、迁移与排查见 [使用说明.md](使用说明.md)

## 选择项目工作区

打开面板右上角的「体检」，点击「选择目录」，选择直接包含 `cybercafe-hub`、`cybercafe-monitor`、`cybercafe-power` 等子项目的 `cloudgame-cybercafe/cybercafe-front` 目录。若仓库克隆在 macOS 的 `~/Desktop/work` 下，完整路径为 `~/Desktop/work/cloudgame-cybercafe/cybercafe-front`。

## macOS 桌面端

双击 [启动桌面端.command](scripts/commands/启动桌面端.command) 打开 Cybercafe。首次运行需要 Rust 和 Xcode 命令行工具。已有应用包时可直接启动。打开应用时会自动启动 Whistle，已有实例会直接复用。在面板里启动项目时，服务输出会直接显示在项目操作区下方的内嵌终端，可以在同一面板停止服务或切换项目；手动在外部终端启动的服务会在终端页提示无法读取实时输出，可一键接管并重启。菜单栏可启动或停止 Whistle，退出桌面应用时只会停止由它启动、且尚未被替换的实例。

修改 Rust、应用图标或启动配置后，先退出桌面应用，再从工具目录运行：

```zsh
./scripts/commands/启动桌面端.command --rebuild
```

应用构建在仓库的 `.cafe-tools/Cybercafe.app` 内。它会从工具目录复用 Whistle 插件和默认浏览器打开脚本，因此请保留该目录位置。构建时会记录当前终端找到的 `w2`，供 Finder 启动后的桌面端使用。切换 Node 或重新安装 Whistle 后，可用同一条命令更新路径。

桌面代码位于 `desktop/src/`。`menu/mod.rs` 管理菜单与后台操作，`window/mod.rs` 管理窗口与页面导航，`services/mod.rs` 负责探测和调用本地服务。项目面板由 `whistle.cafe-projects` 提供。

```sh
cargo fmt --manifest-path desktop/Cargo.toml --check
cargo test --locked --manifest-path desktop/Cargo.toml
npm --prefix whistle.cafe-projects test
```

## 分发给其他人

把整个工具目录（包含 `.cafe-tools/Cybercafe.app`）打包发给对方即可，不需要发送本机的 `.git`、`Chrome开发配置`、日志和状态文件。

对方机器需要：

- macOS 或 Windows，本机 Node.js 20+（含 npm）和全局 Whistle（`npm install -g whistle`）；
- 不需要 Rust/Xcode（使用已构建好的 App 时）；
- 测试页面使用默认浏览器；HTTPS 证书和代理按 [使用说明.md](使用说明.md) 配置。

App 使用 ad-hoc 签名，首次打开如果提示「无法验证开发者」，右键选择「打开」即可。

macOS 首次打开桌面端时，App 会自动通过登录 shell 查找 `w2`，并把工具目录里的 `whistle.cafe-projects` 链接到全局 `node_modules`，不需要再手动执行链接命令。若提示找不到 `w2`，先确认终端里 `w2 -h` 可用。

## 打包

```sh
./scripts/commands/打包.command             # macOS DMG，并提示 Windows 在线构建入口
./scripts/commands/打包.command --mac-only  # 只打 macOS
./scripts/commands/本地打包.command        # 本机生成 macOS DMG
```

macOS 分发生成 DMG，打开后将 Cybercafe.app 拖到「应用程序」安装。使用 release 构建，需要 Xcode 命令行工具、Rust、Node.js 和 Python 3。Windows 原生桌面端由 Windows runner 编译，并通过 NSIS 生成 EXE 安装包。

版本以 desktop/Cargo.toml 为来源，打包前校验 tauri.conf.json 的版本一致，应用的 Info.plist 在组装时自动同步。产物直接放在默认 dist/ 目录，文件名带香港时间的构建日期，例如 Cybercafe-2026-11-23-macOS-arm64.dmg 和 Cybercafe-2026-11-23-Windows-x64-Setup.exe。同一天再次构建会替换当天同平台的安装包。

macOS 入口中的 --windows-only 显示 Windows 在线构建提示；--output-dir 指定本机输出目录，例如 ./scripts/commands/打包.command --mac-only --output-dir /tmp/cybercafe-dist。也可通过 CAFE_DIST_DIR 指定输出根目录。TERSER_CLI 可指定 Terser 入口，未安装时直接复制插件脚本。安装包只携带运行所需的插件、浏览器和项目启动脚本。


## GitHub 在线打包

将云端打包工作流提交并推送到默认分支后，在仓库的 Actions 中选择 Build desktop packages，点击 Run workflow 并选择需要构建的分支。完成后在本次运行页面的 Artifacts 下载 macOS Apple Silicon DMG 或 Windows 原生 EXE 安装包，产物保留 14 天。

推送 GitHub tag 后会自动运行同一打包流程，构建该 tag 指向的代码。macOS DMG 和 Windows EXE 均构建成功后，自动上传并发布到该 tag 的 GitHub Release；安装包沿用带日期的文件名，可直接下载，无需解压 Actions 归档。首次发布先创建草稿，两个安装包上传完成后才公开；重跑会覆盖同名附件。普通分支推送不会触发打包，手动 Run workflow 时，`release_tag` 留空只生成 Actions Artifacts；填写已有 tag（如 `v1.0.0`）则检出该 tag 的代码，构建后发布到对应 Release，可用于补发先前创建的 tag。

```bash
git tag v0.1.1
git push origin v0.1.1
```

请先把工作流修改提交到要打 tag 的版本中。发布使用 GitHub 自带的 `GITHUB_TOKEN`，仅发布任务申请 `contents: write`，无需额外配置个人令牌。构建失败时不会执行发布任务，可从 Actions 日志排查后重跑。

构建使用 GitHub 托管机器，本机无需安装 Rust。macOS 包使用现有 ad-hoc 签名。Windows EXE 与 macOS 一样仅包含桌面程序和工具资源，不内置 Node.js、npm 或 Whistle，运行时自动查找本机环境。每次构建先运行相关测试，失败时可在 Actions 日志中查看原因。

## 代码目录与职责

代码按功能放在独立文件夹中。下表按职责列出具体文件，便于找到界面与服务端实现。同一功能目录中的 `client.mjs` 负责页面交互，`server.cjs`、`store.cjs` 等负责本机操作和状态。

### Web UI

以下路径相对于 `whistle.cafe-projects/`。

| 目录或文件 | 功能和目的 |
| --- | --- |
| `panel/` | 主面板 HTML、全局布局样式、浅色/深色主题配色和功能初始化入口。 |
| `features/projects/client.mjs` | 项目列表、搜索、收藏、启动进度和操作按钮。 |
| `features/terminal/client.mjs`、`terminal.html`、`terminal.css` | 应用内终端页面、输出展示和服务控制，均位于 `features/terminal/`。 |
| `features/doctor/client.mjs` | 环境体检结果、工作区设置和修复操作界面。 |
| `features/rules/` | 规则预览、复制及内嵌 Whistle 编辑器弹框。 |
| `features/whistle/client.mjs` | 面板中的 Whistle 重启、同步和浏览器打开操作。 |
| `features/badge/` | 注入测试页面的环境徽标及其样式。 |
| `shared/toast/` | 共用 Apple 风格错误提示，2 秒自动消失，并对轮询错误去重。 |
| `shared/http/client.mjs` | 客户端请求、令牌刷新和操作确认。 |

### 业务服务与状态

以下路径相对于 `whistle.cafe-projects/`。

| 目录或文件 | 功能和目的 |
| --- | --- |
| `features/projects/server.cjs`、`store.cjs` | 项目操作编排、依赖安装、项目状态和偏好存储，均位于 `features/projects/`。 |
| `features/workspace/` | 目录选择、路径持久化和本地代理开关。 |
| `features/proxy/` | 检测本地服务、生成 Whistle 规则并写入同步状态。 |
| `features/startup/` | 跟踪启动阶段、服务退出、接管结果和超时。 |
| `features/dependencies/` | 依赖安装进程、安装日志与安装后启动，维护安装任务状态。 |
| `features/system-proxy/` | 代理接入模式开关、模式保存与状态展示，以及测试域名 PAC 内容和下载路由。 |
| `features/cleanup/` | 清理工具生成的日志、临时文件、同步状态、兼容代理文件和 PAC。 |
| `features/runtime/` | 解析 Node 版本约束，选择运行时和依赖安装命令。 |
| `features/terminal/launcher.cjs` | 后台启动开发服务并连接日志采集。 |
| `features/logs/store.cjs`、`routes.cjs`、`run-log.cjs` | 日志采集、容量限制、归档、诊断与读写 API，均位于 `features/logs/`。 |
| `features/doctor/server.cjs` | 环境检查、证书、代理和插件配置修复。 |
| `features/whistle/server.cjs` | Whistle 重启、规则查询和关闭代理前的清理。 |
| `features/browser/` | 项目页面和测试入口的浏览器打开 API。 |
| `shared/config/` | 公共路径、测试入口和项目路由配置。 |
| `shared/http/http.cjs` | HTTP 响应、令牌与本机请求鉴权。 |
| `server/` | UI 服务入口、静态资源映射和 API 路由分发。 |
| `test/` | 启动生命周期、运行时选择和日志功能的回归测试。 |

`whistle.cafe-projects/index.cjs` 是插件入口。调整功能目录时，需要同步检查模块引用、页面资源映射与打包入口。

### Tauri 桌面端

| 目录或文件 | 功能和目的 |
| --- | --- |
| `desktop/src/lifecycle/` | 统一面板关闭、菜单退出和系统退出的清理顺序，阻止并发启停，清理失败保留窗口。 |
| `desktop/src/main.rs` | 注册桌面模块，处理应用启动和退出事件。 |
| `desktop/src/menu/` | 菜单栏、单色菜单图标、异步操作和状态反馈。 |
| `desktop/src/window/` | 面板与终端窗口、导航范围和下载处理。 |
| `desktop/src/system_proxy/` | macOS PAC 配置、原设置备份和恢复、授权状态及取消重试控制；空 PAC 通过系统配置接口清除，保留其他 VPN 设置。 |
| `desktop/src/services/` | `mod.rs` 共用连接状态校验、暂停状态、代理恢复重试和测试入口；`macos.rs` / `windows.rs` 仅实现本机命令、环境查找及进程操作，Windows 环境脚本由程序嵌入执行。 |
| `desktop/ui/` | 连接异常时显示的本地页面。 |
| `desktop/icons/` | 应用包使用 Cybercafe.icns，Tauri 默认图标使用其同款 PNG，保持 Dock 与应用图标一致。 |

### 工具脚本与打包

| 目录或文件 | 功能和目的 |
| --- | --- |
| `.github/workflows/` | 手动触发云端测试和打包，并上传可下载产物。 |
| `scripts/commands/` | 可双击使用的通用项目启动、手动同步、桌面端启动、浏览器打开和打包入口。 |
| `scripts/browser/` | macOS 默认浏览器标签页查找、复用和新建。 |
| `desktop/windows/` | NSIS 安装钩子及旧版内置运行时升级清理；不再包含另一套 CMD 安装和启动入口，不修改全局 Node/Whistle。 |
| `desktop/packaging/` | 共用资源收集、版本校验、应用组装和签名，供开发启动和分发打包使用。 |
| `desktop/package-macos.sh` | 收集功能模块、脚本与桌面资源，生成可拖拽安装的 macOS DMG。 |

### 本机数据与构建产物

| 目录 | 功能和目的 |
| --- | --- |
| `.cafe-tools/` | 本机状态、日志、构建缓存和桌面应用，由 Git 忽略。 |
| `dist/` | 安装包输出，由 Git 忽略。 |

应用图标更新时，同时更新 desktop/icons/Cybercafe.icns 与其导出的 icon.png。macOS 可执行 `sips -s format png desktop/icons/Cybercafe.icns --out desktop/icons/icon.png` 同步图案。

启动项目后，终端输出直接显示在项目操作面板下方。切换左侧项目时终端同步切换。

### Windows EXE 构建

Windows Tauri NSIS 工作流在 Windows runner 编译原生桌面应用并直接上传带构建日期的 NSIS EXE 安装包。
desktop/tauri.windows.conf.json 定义当前用户安装、WebView2 检测和运行资源。
desktop/src/services/windows.rs 管理 Windows Whistle 和浏览器入口。
桌面端从 PATH、当前用户/系统最新 PATH、常见 Node 安装位置及 NVM/Volta 等活动路径查找本机 Node 和 npm，通过 npm root -g 定位 Whistle；缺失时显示安装方法。项目仍按各自的版本约束选择 Node。
Windows 实机安装、浏览器代理配合和浏览器标签页复用仍需验收。

### Windows 原生安装包

macOS 的 scripts/commands/打包.command 构建本机 DMG，并提示 Windows 在线构建入口。
Windows 原生 EXE 请运行 GitHub Actions 的 Build desktop packages 工作流，下载 Cybercafe-Windows-x64-Setup 产物，解压 GitHub 自动提供的下载归档后即可运行 NSIS EXE。

界面通过 `prefers-color-scheme` 跟随系统自动切换浅色/深色主题，无需刷新；面板、操作弹框、Toast、项目终端及悬浮状态标识同步适配。

`features/proxy/browser-status.cjs` 接收测试页徽标的本地响应探测回报，按工作区和服务实例区分，供项目入口与体检显示最近的浏览器访问确认状态。

`features/doctor/proxy-checks.cjs` 按浏览器代理或 Whistle 代理模式生成适用的体检项，避免显示不需要的 PAC 和系统代理配置提示。

`features/proxy/report-server.cjs` 通过 Whistle 插件协议处理同域页面确认回报，避免转发回 Whistle UI 端口产生重定向。

macOS 证书体检同时检查当前 Whistle CA 是否实际存在于钥匙串以及 SSL 信任是否有效；安装时写入登录钥匙串，避免仅有信任记录导致 Chrome 报 `ERR_CERT_AUTHORITY_INVALID`。相关逻辑位于 `whistle.cafe-projects/features/doctor/mac-ca.cjs`。

Windows 项目服务与 macOS 一样由插件后台启动，标准输出和错误输出写入面板内终端，不再打开独立 PowerShell 窗口；应用退出时清理插件启动的日志进程及其子进程树。启动逻辑位于 `whistle.cafe-projects/features/terminal/launcher.cjs`，日志采集位于 `features/logs/run-log.cjs`。

两端桌面交互：打开测试入口或项目页均使用默认浏览器，不强制 Chrome、不创建独立浏览器配置、不在启动参数中设置全局代理。首次工作区由用户选择或输入，之后读取已保存目录；不扫描并自动选用其他项目。macOS 支持通过浏览器脚本复用标签页；Windows 通过默认浏览器打开地址，精确查找并切换已有标签页尚未支持。系统 PAC 自动接管与恢复目前仍仅支持 macOS，Windows 使用浏览器代理模式。

Windows 首次使用先安装 Node.js LTS（包含 npm），然后执行 `npm install -g whistle`。可以在终端运行 `node --version`、`npm --version` 和 `w2 -h` 验证。无需安装 Rust 或手动启动 Whistle，应用负责启动/复用与加载内置插件。刚安装依赖后，在连接页点击“开启代理 / 启动 Whistle”重试；程序会重新读取当前环境。若使用 NVM，请先 `nvm use` 激活满足项目要求的 Node，并在该环境安装 Whistle。升级安装会移除旧应用目录 `tools/runtime`，不会移除用户自己安装的环境。

macOS 和 Windows 桌面服务统一从 `desktop/src/services/mod.rs` 进入，公共流程只有一份；系统差异保留在两个平台实现中。两端安装包均由 `desktop/packaging/resources.py` 收集插件资源，Windows 仅保留 Actions 原生 EXE 打包，不再维护独立的 Legacy CMD 分发包。
