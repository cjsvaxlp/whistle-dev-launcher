#!/bin/zsh
# 兼容旧入口：打开 Whistle 面板以加载插件。
exec /usr/bin/open "${CAFE_WHISTLE_ORIGIN:-http://127.0.0.1:8899}/plugin.cafe-projects/"
