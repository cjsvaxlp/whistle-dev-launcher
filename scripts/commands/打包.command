#!/bin/zsh
# 一键构建 Cybercafe macOS 安装包（以及可选的 Windows 安装包）。
# 用法：
#   ./scripts/commands/打包.command             # macOS + Windows
#   ./scripts/commands/打包.command --mac-only  # 只打 macOS
set -eu
set -o pipefail

tool_dir=${0:A:h:h:h}
state_dir="$tool_dir/.cafe-tools"
dist_dir="$tool_dir/dist"
mac_only=0

for arg in "$@"; do
  case "$arg" in
    --mac-only|--no-cross)
      mac_only=1
      ;;
    -h|--help)
      print -r -- "用法: $0 [--mac-only]"
      exit 0
      ;;
    *)
      print -u2 "未知参数：$arg（可用 --mac-only）"
      exit 2
      ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  print -u2 '这个打包脚本只支持 macOS。'
  exit 1
fi

export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

missing=()
for tool in cargo node codesign pkgbuild pkgutil ditto zip; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    missing+=("$tool")
  fi
done
if (( ${#missing[@]} )); then
  print -u2 "缺少命令：${missing[*]}。请先安装 Xcode 命令行工具、Rust 和 Node.js。"
  exit 1
fi

if (( ! mac_only )) && ! command -v python3 >/dev/null 2>&1; then
  print -u2 '缺少 python3，无法生成 Windows 安装包；可以改用 ./scripts/commands/打包.command --mac-only。'
  exit 1
fi
if (( ! mac_only )) && [[ "$(uname -m)" != "arm64" ]]; then
  print -u2 'Windows 安装包目前从 arm64 的 macOS 包生成；请改用 ./scripts/commands/打包.command --mac-only。'
  exit 1
fi

# package-macos.sh 需要一个可执行的 Terser JS 入口。找不到时用复制模式兜底，
# 这样打包不会被网络或全局 npm 环境卡住（产物只是没有压缩插件 JS）。
terser_cli="${TERSER_CLI:-}"
if [[ -z "$terser_cli" || ! -f "$terser_cli" ]]; then
  terser_cli="$(command -v terser 2>/dev/null || true)"
fi
if [[ -z "$terser_cli" || ! -f "$terser_cli" ]]; then
  global_root="$(npm root -g 2>/dev/null || true)"
  if [[ -n "$global_root" && -f "$global_root/terser/bin/terser" ]]; then
    terser_cli="$global_root/terser/bin/terser"
  fi
fi
if [[ -z "$terser_cli" || ! -f "$terser_cli" ]]; then
  terser_cli="$(node -e "try { console.log(require.resolve('terser/bin/terser')) } catch {}" 2>/dev/null || true)"
fi
if [[ -z "$terser_cli" || ! -f "$terser_cli" ]]; then
  mkdir -p "$state_dir"
  fallback="$state_dir/package-terser.cjs"
  cat > "$fallback" <<'JS'
const fs = require('node:fs');
const args = process.argv.slice(2);
const input = args[0];
const outputIndex = args.indexOf('--output');
const output = outputIndex >= 0 ? args[outputIndex + 1] : '';
if (!input || !output) {
  console.error('fallback terser: missing input or --output');
  process.exit(1);
}
fs.copyFileSync(input, output);
JS
  terser_cli="$fallback"
  print -u2 '[!] 未找到 terser，使用复制模式打包（不影响功能，只是包体略大）。'
  print -u2 '    想压缩可以安装 terser 后重试：npm install -g terser'
fi
export TERSER_CLI="$terser_cli"

print -r -- '==> 构建 macOS 安装包…'
mac_output="$("$tool_dir/desktop/package-macos.sh" | tail -n 1)"
if [[ ! -f "$mac_output" ]]; then
  print -u2 "macOS 安装包没有生成：$mac_output"
  exit 1
fi

if (( mac_only )); then
  print -r -- ''
  print -r -- '打包完成：'
  print -r -- "  $mac_output"
  exit 0
fi

print -r -- '==> 生成 Windows 安装包…'
windows_output="$(python3 "$tool_dir/desktop/package-cross-platform.py" | tail -n 1)"
if [[ ! -f "$windows_output" ]]; then
  print -u2 "Windows 安装包没有生成：$windows_output"
  exit 1
fi

print -r -- ''
print -r -- '打包完成：'
print -r -- "  macOS:   $mac_output"
print -r -- "  Windows: $windows_output"
/usr/bin/du -h "$mac_output" "$windows_output" | sed 's/^/  /'
