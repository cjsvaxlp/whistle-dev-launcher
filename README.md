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

- macOS、Node.js 20+、全局 Whistle（`npm i -g whistle`）；
- 不需要 Rust/Xcode（使用已构建好的 App 时）；
- 测试页面使用默认浏览器；HTTPS 证书和代理按 [使用说明.md](使用说明.md) 配置。

App 使用 ad-hoc 签名，首次打开如果提示「无法验证开发者」，右键选择「打开」即可。

首次打开桌面端时，App 会自动通过登录 shell 查找 `w2`，并把工具目录里的 `whistle.cafe-projects` 链接到全局 `node_modules`，不需要再手动执行链接命令。若提示找不到 `w2`，先确认终端里 `w2 -h` 可用。

## 打包

```sh
./scripts/commands/打包.command             # macOS 安装包 + Windows 安装包
./scripts/commands/打包.command --mac-only  # 只打 macOS
```

macOS 分发生成 DMG，打开后将 Cybercafe.app 拖到「应用程序」安装。使用 release 构建，需要 Xcode 命令行工具、Rust、Node.js 和 Python 3。Windows 插件安装包可以单独生成，需要 Node.js 和 Python 3，运行时通过浏览器打开面板。

版本以 desktop/Cargo.toml 为来源，打包前校验 tauri.conf.json 的版本一致，应用的 Info.plist 在组装时自动同步。产物默认放在 dist/<版本号>/，例如 Cybercafe-0.1.0-macOS-arm64.dmg 和 Cybercafe-0.1.0-Windows.zip。

支持 --windows-only 单独生成 Windows 包，--output-dir 指定输出根目录，例如 ./scripts/commands/打包.command --mac-only --output-dir /tmp/cybercafe-dist。也可通过 CAFE_DIST_DIR 指定输出根目录。TERSER_CLI 可指定 Terser 入口，未安装时直接复制插件脚本。安装包只携带运行所需的插件、浏览器和项目启动脚本。


## 代码目录与职责

代码按功能放在独立文件夹中。下表按职责列出具体文件，便于找到界面与服务端实现。同一功能目录中的 `client.mjs` 负责页面交互，`server.cjs`、`store.cjs` 等负责本机操作和状态。

### Web UI

以下路径相对于 `whistle.cafe-projects/`。

| 目录或文件 | 功能和目的 |
| --- | --- |
| `panel/` | 主面板 HTML、全局布局样式和功能初始化入口。 |
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
| `features/system-proxy/` | 关闭本工具管理的系统代理，并清理旧开发浏览器实例。 |
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
| `desktop/src/main.rs` | 注册桌面模块，处理应用启动和退出事件。 |
| `desktop/src/menu/` | 菜单栏、单色菜单图标、异步操作和状态反馈。 |
| `desktop/src/window/` | 面板与终端窗口、导航范围和下载处理。 |
| `desktop/src/services/` | 本机 Whistle 的发现、启动、停止和浏览器入口。 |
| `desktop/ui/` | 连接异常时显示的本地页面。 |
| `desktop/icons/` | 应用包使用 Cybercafe.icns，Tauri 默认图标使用其同款 PNG，保持 Dock 与应用图标一致。 |

### 工具脚本与打包

| 目录或文件 | 功能和目的 |
| --- | --- |
| `scripts/commands/` | 可双击使用的通用项目启动、手动同步、桌面端启动、浏览器打开和打包入口。 |
| `scripts/browser/` | macOS 默认浏览器标签页查找、复用和新建。 |
| `desktop/windows/` | Windows 安装和启动脚本。 |
| `desktop/packaging/` | 共用资源收集、版本校验、应用组装和签名，供开发启动和分发打包使用。 |
| `desktop/package-macos.sh` | 收集功能模块、脚本与桌面资源，生成可拖拽安装的 macOS DMG。 |
| `desktop/package-cross-platform.py` | 独立收集共用插件资源，生成 Windows 插件安装包。 |

### 本机数据与构建产物

| 目录 | 功能和目的 |
| --- | --- |
| `.cafe-tools/` | 本机状态、日志、构建缓存和桌面应用，由 Git 忽略。 |
| `dist/` | 安装包输出，由 Git 忽略。 |

应用图标更新时，同时更新 desktop/icons/Cybercafe.icns 与其导出的 icon.png。macOS 可执行 `sips -s format png desktop/icons/Cybercafe.icns --out desktop/icons/icon.png` 同步图案。

启动项目后，终端输出直接显示在项目操作面板下方。切换左侧项目时终端同步切换。
