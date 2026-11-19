#!/bin/zsh
set -eu

tool_dir=${0:A:h}
test_origin='https://cloudgametest2.migufun.com:18443'
url=${1:-"$test_origin/cybercafe-power/#/amsportal"}

if [[ "$url" != "$test_origin/"* ]]; then
  print -u2 '请输入完整的 Cybercafe 测试环境链接。'
  exit 1
fi

if ! /usr/bin/curl --noproxy '*' --fail --silent --max-time 3 \
    'http://127.0.0.1:8899/plugin.cafe-projects/' >/dev/null; then
  print -u2 '无法访问本机 Whistle 面板，请先启动 Whistle 并确认插件已加载。'
  exit 1
fi

exec /usr/bin/open -na 'Google Chrome' --args \
  "--user-data-dir=$tool_dir/Chrome开发配置" \
  '--proxy-server=http://127.0.0.1:8899' \
  "$url"
