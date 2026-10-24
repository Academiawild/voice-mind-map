#!/bin/zsh

cd "$(dirname "$0")" || exit 1

echo "[Voice Mind Map] Checking startup environment..."

node_bin="$(command -v node || true)"
if [[ -z "$node_bin" && -x dependencies/local/node/bin/node ]]; then
  node_bin="$(pwd)/dependencies/local/node/bin/node"
fi

if [[ ! -f .env && -f .env.example ]]; then
  echo "[Voice Mind Map] .env not found. Copying from .env.example..."
  cp .env.example .env
fi

if [[ -z "$node_bin" ]]; then
  echo "[Voice Mind Map] Node.js was not found."
  echo "Install Node.js 22.12 or newer, then open start.command again."
  read -r "?Press Return to close..."
  exit 1
fi

export PATH="$(dirname "$node_bin"):$PATH"

if [[ ! -x dependencies/local/asr-venv/bin/python ]]; then
  echo "[Voice Mind Map] Local Python runtime was not found."
  echo "Open install.command first, then try again."
  read -r "?Press Return to close..."
  exit 1
fi

"$node_bin" scripts/ensure-node-dependencies.mjs || {
  echo "[Voice Mind Map] npm dependency installation failed."
  read -r "?Press Return to close..."
  exit 1
}

echo "[Voice Mind Map] Starting local AI, web, and speech services..."
"$node_bin" scripts/start-hidden.mjs
status=$?

if (( status != 0 )); then
  echo
  echo "[Voice Mind Map] Startup did not complete. Check the *-dev.err.log files in this folder."
  echo "If dependencies are missing, open install.command again."
  echo
  echo "[Voice Mind Map] Running a quick diagnosis..."
  "$node_bin" scripts/doctor.mjs
  read -r "?Press Return to close..."
  exit $status
fi

echo "[Voice Mind Map] Startup complete. The browser should open automatically."
echo "Speech and local AI may need a moment while their models warm up."
