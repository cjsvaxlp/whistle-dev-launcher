#!/bin/zsh
set -eu

tool_dir=${0:A:h:h:h}
state_dir="$tool_dir/.cafe-tools"
app="$state_dir/Cybercafe.app"
if [[ "$#" -eq 0 && -x "$app/Contents/MacOS/cybercafe-desktop" ]]; then
  exec /usr/bin/open "$app"
fi
if [[ "${1:-}" == "--rebuild" ]]; then
  shift
fi

export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v cargo >/dev/null; then
  print -u2 '缺少 Rust 工具链。请先安装 Rust，再运行此脚本。'
  exit 1
fi

if ! command -v w2 >/dev/null && [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  unsetopt nounset
  source "$HOME/.nvm/nvm.sh"
  nvm use --silent default >/dev/null || true
  setopt nounset
fi

if (( $# )); then
  print -u2 '启动脚本仅支持 --rebuild。'
  exit 2
fi

mkdir -p "$state_dir"
staging=$(mktemp -d "$state_dir/desktop-build.XXXXXX")
backup="$staging/previous.app"
cleanup() {
  if [[ -e "$backup" && ! -e "$app" ]] && ! mv "$backup" "$app"; then
    print -u2 "旧版本备份保留在 $backup"
    return
  fi
  rm -rf -- "$staging"
}
trap cleanup EXIT
candidate="$staging/Cybercafe.app"
"$tool_dir/desktop/packaging/build-app.sh" "$candidate" dev repository

zmodload zsh/system
lock="$state_dir/desktop-package.lock"
: >> "$lock"
if ! zsystem flock -t 15 -f lock_fd "$lock"; then
  print -u2 '另一个桌面端构建正在替换应用包，请稍后重试。'
  exit 1
fi
if [[ -e "$app" ]]; then
  mv "$app" "$backup"
fi
mv "$candidate" "$app"
/usr/bin/open "$app"
