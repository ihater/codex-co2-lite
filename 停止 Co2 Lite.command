#!/bin/zsh
set -eu
/bin/launchctl bootout "gui/$(id -u)/local.codex-co2-lite" 2>/dev/null || true
print 'Co2 Lite 已停止。共享数据仍保留，下次启动会恢复原链接。'
