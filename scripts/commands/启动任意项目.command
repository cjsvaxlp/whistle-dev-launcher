#!/bin/zsh
set -eu

workspace="${CAFE_WORKSPACE:-}"
tool_dir=${0:A:h:h:h}
workspace_file="${CAFE_STATE_DIR:-${CAFE_TOOLS_DIR:-$tool_dir}/.cafe-tools}/workspace"
if [[ ! -s "$workspace_file" && -z "${CAFE_STATE_DIR:-}" ]]; then
  workspace_file="$HOME/.cache/cafe-tools/workspace"
fi
if [[ -s "$workspace_file" ]]; then
  workspace=$(<"$workspace_file")
fi
if [[ -z "$workspace" ]]; then
  print -u2 "请先在 Whistle 面板选择项目工作区。"
  exit 1
fi
if [[ ! -d "$workspace" ]]; then
  print -u2 "找不到项目工作区：$workspace，请在 Whistle 面板重新选择目录。"
  exit 1
fi
projects=()
for entry in "$workspace"/cybercafe-*(/N); do
  [[ -f "$entry/package.json" ]] && projects+=("${entry:t}")
done

if (( ! ${#projects} )); then
  print -u2 "工作区中没有可启动的项目：$workspace"
  exit 1
fi

project=${1:-}
if [[ -z "$project" ]]; then
  PS3='输入要启动的项目编号：'
  select project in "${projects[@]}"; do
    [[ -n "$project" ]] && break
  done
fi
[[ "$project" == cybercafe-* ]] || project="cybercafe-$project"
if (( ! ${projects[(Ie)$project]} )); then
  print -u2 "没有找到项目：$project"
  exit 1
fi

prefix="/$project/"
if [[ -n "${CAFE_NODE_BIN:-}" ]]; then
  export PATH="${CAFE_NODE_BIN:h}:$PATH"
fi
state_file="${CAFE_STATE_DIR:-$HOME/.cache/cafe-tools}/state.json"
if [[ -f "$state_file" ]] && command -v node >/dev/null 2>&1; then
  running_port=$(node -e '
    try {
      const state = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
      const local = state.projects && state.projects[process.argv[2]];
      if (local && local.port) process.stdout.write(String(local.port));
    } catch {}
  ' "$state_file" "${project#cybercafe-}")
  if [[ -n "$running_port" ]]; then
    running_html=$(curl -fsS --max-time 2 "http://127.0.0.1:$running_port$prefix" 2>/dev/null || true)
    if [[ "$running_html" == *"$prefix"* ]]; then
      print "检测到 $project 已在本地运行（端口 $running_port），无需重复启动。"
      print "关闭原终端后重新运行本脚本即可；如需访问，直接刷新测试页面。"
      exit 0
    fi
  fi
fi

cd "$workspace/$project"
print "若 Whistle 和代理监听已运行，服务就绪后测试网址会自动改走本地。"
if [[ -f vite.config.js || -f vite.config.ts ]]; then
  if [[ ! -x node_modules/.bin/vite ]]; then
    print -u2 "缺少 $project 的 Vite 依赖，请先按项目约定安装。"
    exit 1
  fi
  mode=development
  [[ ! -f .env.test && ! -f env/.env.test ]] || mode=test
  export __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=cloudgametest2.migufun.com
  exec ./node_modules/.bin/vite --mode "$mode" --host 127.0.0.1 --base "$prefix"
fi
if [[ ! -x node_modules/.bin/webpack || ! -f build/webpack.dev.conf.js ]]; then
  print -u2 "缺少 $project 的 Webpack 开发依赖或配置。"
  exit 1
fi
export NODE_ENV=development HOST=127.0.0.1
exec ./node_modules/.bin/webpack serve --config build/webpack.dev.conf.js \
  --host 127.0.0.1 --no-open --allowed-hosts cloudgametest2.migufun.com \
  --client-web-socket-url "wss://cloudgametest2.migufun.com:18443${prefix}__hmr"
