#!/bin/zsh

cd "$(dirname "$0")" || exit 1

echo "[Voice Mind Map] Starting first-time install..."

node_bin="$(command -v node || true)"
if [[ -z "$node_bin" && -x dependencies/local/node/bin/node ]]; then
  node_bin="$(pwd)/dependencies/local/node/bin/node"
fi

if [[ -z "$node_bin" ]]; then
  echo "[Voice Mind Map] Node.js was not found."
  echo "Install Node.js 22.12 or newer, then open install.command again."
  echo "Homebrew: brew install node python@3.12 git ffmpeg"
  read -r "?Press Return to close..."
  exit 1
fi

export PATH="$(dirname "$node_bin"):$PATH"

"$node_bin" scripts/install.mjs
status=$?

if (( status != 0 )); then
  echo
  echo "[Voice Mind Map] Install failed. Read the message above for the missing requirement."
  read -r "?Press Return to close..."
  exit $status
fi

echo
echo "[Voice Mind Map] Install complete."
echo "Mind-map generation now uses the local Ollama model configured in .env."
echo "Keep Ollama.app installed and make sure LOCAL_AI_MODEL names an installed model."
echo "Then open start.command."
read -r "?Press Return to close..."
