#!/bin/zsh
set -u
dir=${0:A:h}
print '正在监听本地开发服务；请保持此窗口打开。'
print '页面右下角的徽标会显示当前是否已被本地接管；按 Ctrl+C 停止监听。'
while true; do
  "$dir/同步项目代理.command" || print -u2 '代理同步失败，5 秒后重试。'
  sleep 5
done
