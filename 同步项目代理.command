#!/bin/zsh
# 把本地开发服务同步到 Whistle：一条托管规则 + 状态文件，供面板和页面徽标读取。
# 环境变量：CAFE_WORKSPACE（前端仓库）、CAFE_WHISTLE_ORIGIN（默认 127.0.0.1:8899）、CAFE_STATE_DIR。
set -u
dir=${0:A:h}
command -v node >/dev/null 2>&1 || { print -u2 '找不到 node，请先安装 Node.js 20+ 并确认 PATH。'; exit 1; }
exec /usr/bin/env node "$dir/whistle.cafe-projects/sync.mjs"
