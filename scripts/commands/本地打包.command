#!/bin/zsh
set -eu

exec "${0:A:h}/打包.command" "$@" --mac-only
