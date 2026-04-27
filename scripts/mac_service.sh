#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE="${1:-}"
PORT="${2:-}"

cd "$ROOT_DIR"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

case "$SERVICE" in
  backend)
    export APP_DATABASE_PATH="${APP_DATABASE_PATH:-data/toefl_repeat.sqlite3}"
    export APP_ATTEMPTS_DIR="${APP_ATTEMPTS_DIR:-attempts}"
    export APP_PROMPT_AUDIO_DIR="${APP_PROMPT_AUDIO_DIR:-data/audio/generated}"
    exec "$ROOT_DIR/.venv/bin/python" -m uvicorn backend.app.main:app --host 127.0.0.1 --port "${PORT:-8000}"
    ;;
  frontend)
    exec npm --prefix frontend run dev -- --host 127.0.0.1 --port "${PORT:-5174}" --strictPort
    ;;
  *)
    echo "Usage: scripts/mac_service.sh <backend|frontend> <port>" >&2
    exit 64
    ;;
esac
