#!/bin/zsh
set -eu
set -o pipefail
tool_dir=${0:A:h:h:h}
mode=all
while (( $# )); do
  case "$1" in
    --mac-only|--no-cross) mode=mac ;;
    --windows-only) mode=windows ;;
    --output-dir)
      if (( $# < 2 )) || [[ -z "$2" ]]; then
        print -u2 '--output-dir 需要目录参数。'
        exit 2
      fi
      export CAFE_DIST_DIR=${2:A}
      shift
      ;;
    -h|--help)
      print -r -- "用法: $0 [--mac-only|--windows-only] [--output-dir 目录]"
      exit 0
      ;;
    *) print -u2 "未知参数：$1"; exit 2 ;;
  esac
  shift
done
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
required=(node python3)
if [[ "$mode" != windows ]]; then
  [[ "$(uname -s)" == Darwin ]] || { print -u2 'macOS 安装包需要在 macOS 构建。'; exit 1; }
  required+=(cargo codesign hdiutil)
fi
for tool in "${required[@]}"; do
  command -v "$tool" >/dev/null || { print -u2 "缺少命令：$tool"; exit 1; }
done
python3 "$tool_dir/desktop/packaging/resources.py" --version >/dev/null
if [[ "$mode" != windows ]]; then
  print -r -- '==> 构建 macOS 安装包…'
  "$tool_dir/desktop/package-macos.sh"
fi
if [[ "$mode" != mac ]]; then
  print -r -- '==> 生成 Windows 插件安装包…'
  python3 "$tool_dir/desktop/package-cross-platform.py"
fi
