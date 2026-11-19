# whistle-dev-launcher

Cybercafe 本地开发工具：把测试环境里的任意 `cybercafe-*` 子应用切到本机开发服务，入口、路径、登录态保持不变。

- 面板：<http://127.0.0.1:8899/plugin.cafe-projects/>
- 规则：Whistle 里一条托管规则「Cafe 自动代理」
- 徽标：子应用页面右下角显示「本地接管 / 测试部署」
- 完整安装、日常使用、迁移与排查见 [使用说明.md](使用说明.md)

## 选择项目工作区

打开面板右上角的「体检」，点击「选择目录」，选择直接包含 `cybercafe-hub`、`cybercafe-monitor`、`cybercafe-power` 等子项目的 `cloudgame-cybercafe/cybercafe-front` 目录。若仓库克隆在 macOS 的 `~/Desktop/work` 下，完整路径为 `~/Desktop/work/cloudgame-cybercafe/cybercafe-front`。
