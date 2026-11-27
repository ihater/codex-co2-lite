#!/bin/zsh
set -eu
ROOT="${0:A:h}"
if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  source "$HOME/.nvm/nvm.sh"
fi
NODE="$(command -v node 2>/dev/null || true)"
if [[ -z "$NODE" ]]; then
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
    if [[ -x "$candidate" ]]; then
      NODE="$candidate"
      break
    fi
  done
fi
if [[ -z "$NODE" ]]; then
  print -u2 '未找到 Node.js。请先安装 README 要求的 Node.js 版本。'
  exit 1
fi
"$NODE" "$ROOT/lite/install-launch-agent.mjs"
"$NODE" "$ROOT/lite/open-manager.mjs"
