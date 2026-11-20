# whistle-dev-launcher

Cybercafe 本地开发工具：把测试环境里的任意 `cybercafe-*` 子应用切到本机开发服务，入口、路径、登录态保持不变。

- 面板：<http://127.0.0.1:8899/plugin.cafe-projects/>
- 规则：Whistle 里一条托管规则「Cafe 自动代理」
- 徽标：子应用页面右下角显示「本地接管 / 测试部署」
- 完整安装、日常使用、迁移与排查见 [使用说明.md](使用说明.md)

## 选择项目工作区

打开面板右上角的「体检」，点击「选择目录」，选择直接包含 `cybercafe-hub`、`cybercafe-monitor`、`cybercafe-power` 等子项目的 `cloudgame-cybercafe/cybercafe-front` 目录。若仓库克隆在 macOS 的 `~/Desktop/work` 下，完整路径为 `~/Desktop/work/cloudgame-cybercafe/cybercafe-front`。

## macOS 桌面端

双击 [启动桌面端.command](启动桌面端.command) 打开 Cybercafe。首次运行需要 Rust 和 Xcode 命令行工具。已有应用包时可直接启动。打开应用时会自动启动 Whistle，已有实例会直接复用。在面板里启动项目时，桌面端会在应用内打开终端页面显示服务输出，可以直接停止服务并返回面板；手动在外部终端启动的服务会在终端页提示无法读取实时输出，可一键接管并重启。菜单栏可启动或停止 Whistle，退出桌面应用时只会停止由它启动、且尚未被替换的实例。

修改 Rust、应用图标或启动配置后，先退出桌面应用，再从工具目录运行：

```zsh
./启动桌面端.command --rebuild
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
- 测试页面需要 Chrome；HTTPS 证书和代理按 [使用说明.md](使用说明.md) 配置。

App 使用 ad-hoc 签名，首次打开如果提示「无法验证开发者」，右键选择「打开」即可。

首次打开桌面端时，App 会自动通过登录 shell 查找 `w2`，并把工具目录里的 `whistle.cafe-projects` 链接到全局 `node_modules`，不需要再手动执行链接命令。若提示找不到 `w2`，先确认终端里 `w2 -h` 可用。

## 打包

```sh
./打包.command             # macOS 安装包 + Windows 安装包
./打包.command --mac-only  # 只打 macOS
```

需要 Xcode 命令行工具、Rust、Node.js；生成物在 `dist/`。没有全局安装 `terser` 时会使用复制模式打包（不压缩插件 JS，不影响功能）。

## 代码目录与职责

Whistle 插件按功能组织。每个功能的客户端、服务端和资源放在同一目录，公共通信与界面组件放在 shared 中。插件入口和页面 URL 保持兼容，修改功能时应同步检查客户端、服务端和打包入口。

| 目录 | 功能和目的 |
| --- | --- |
| `whistle.cafe-projects/features/projects/` | 项目列表、搜索收藏、启动停止与安装操作，以及项目状态和偏好存储。 |
| `whistle.cafe-projects/features/workspace/` | 工作区路径持久化和本地代理开关，供启动与同步共用。 |
| `whistle.cafe-projects/features/proxy/` | 检测本地服务、生成 Whistle 规则并写入同步状态。 |
| `whistle.cafe-projects/features/startup/` | 跟踪启动阶段、接管结果、退出和超时，提供准确的启动进度。 |
| `whistle.cafe-projects/features/runtime/` | 解析 Node 版本约束、选择本机运行时和依赖安装命令。 |
| `whistle.cafe-projects/features/terminal/` | 后台启动开发服务及应用内终端页面，连接服务控制与实时输出。 |
| `whistle.cafe-projects/features/logs/` | 日志采集、容量限制、历史批次、诊断、下载与日志查看界面。 |
| `whistle.cafe-projects/features/doctor/` | 环境检查、证书、代理与插件配置修复。 |
| `whistle.cafe-projects/features/whistle/` | Whistle 重启、规则查询和面板中的代理控制。 |
| `whistle.cafe-projects/features/browser/` | 项目页面和测试入口的浏览器打开 API，保留已有接口地址。 |
| `whistle.cafe-projects/features/badge/` | 注入测试页面的环境徽标，显示本地接管状态。 |
| `whistle.cafe-projects/shared/config/` | 公共路径、测试入口与项目路由配置。 |
| `whistle.cafe-projects/shared/http/` | HTTP 响应、请求鉴权、客户端令牌刷新和请求方法。 |
| `whistle.cafe-projects/features/rules/` | 规则预览、复制和内嵌 Whistle 编辑器的页面路由。 |
| `whistle.cafe-projects/shared/toast/` | 共用 Apple 风格错误提示、2 秒自动消失和轮询错误去重。 |
| `whistle.cafe-projects/panel/` | 主面板页面、全局布局与功能模块初始化。 |
| `whistle.cafe-projects/server/` | Whistle UI 服务入口、静态资源映射和 API 路由分发。 |
| `whistle.cafe-projects/test/` | 启动生命周期、运行时选择与日志功能的回归测试。 |
| `desktop/src/menu/` | Tauri 菜单栏、异步操作和状态反馈。 |
| `desktop/src/services/` | 本机 Whistle 的发现、启动、停止和浏览器入口。 |
| `desktop/src/window/` | 面板与终端窗口、导航范围和下载处理。 |
| `desktop/ui/` | 桌面连接异常时显示的本地页面。 |
| `desktop/icons/` | 桌面应用和菜单使用的图标资源。 |
| `desktop/windows/` | Windows 安装和启动脚本。 |
| `scripts/browser/` | macOS 默认浏览器标签页查找、复用和新建。 |
| `.cafe-tools/` | 本机状态、日志、构建缓存和桌面应用，由 Git 忽略。 |
| `dist/` | 安装包输出，由 Git 忽略。 |

`whistle.cafe-projects/index.cjs` 是 Whistle 插件入口。`desktop/src/main.rs` 负责注册桌面模块。`desktop/package-macos.sh`、`desktop/package-cross-platform.py` 负责收集完整功能目录并生成分发包。根目录的 `.command` 文件是用户可双击使用的启动、同步和打包入口。
