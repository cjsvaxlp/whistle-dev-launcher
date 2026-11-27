# Executed by the application's login zsh only when no installed w2 was found.
set -eu
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
if ! command -v node >/dev/null 2>&1 && [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  source "$HOME/.nvm/nvm.sh"
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  print -u2 '缺少 Node.js/npm，请先安装 Node.js LTS（包含 npm）后重试。'
  exit 1
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)'; then
  print -u2 'Node.js 无法运行或版本低于 20，请安装 Node.js LTS 后重试。'
  exit 1
fi
# Recheck after loading the login environment; never upgrade an existing install.
if ! command -v w2 >/dev/null 2>&1; then
  if ! npm install -g whistle --no-audit --no-fund --fetch-retries=1 --fetch-timeout=30000 >&2; then
    print -u2 '自动安装 Whistle 失败，请检查网络或 npm 全局目录权限；也可手动执行 npm install -g whistle 后重试。'
    exit 1
  fi
fi
rehash
if ! command -v w2 >/dev/null 2>&1; then
  print -u2 'Whistle 已安装但找不到 w2，请检查 npm 全局可执行目录是否已加入 PATH。'
  exit 1
fi
whence -p w2
