#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_PORT="${TOEFL_BACKEND_PORT:-8000}"
FRONTEND_PORT="${TOEFL_FRONTEND_PORT:-5174}"
APP_URL="http://127.0.0.1:${FRONTEND_PORT}/"
LOG_DIR="$ROOT_DIR/.logs"
BACKEND_LOG="$LOG_DIR/mac-backend.log"
FRONTEND_LOG="$LOG_DIR/mac-frontend.log"
LAUNCH_DIR="$HOME/Library/LaunchAgents"
BACKEND_LABEL="com.toefl-trainer.backend"
FRONTEND_LABEL="com.toefl-trainer.frontend"
BACKEND_PLIST="$LAUNCH_DIR/$BACKEND_LABEL.plist"
FRONTEND_PLIST="$LAUNCH_DIR/$FRONTEND_LABEL.plist"
LAUNCH_DOMAIN="gui/$(id -u)"
BACKEND_SCREEN="toefl_trainer_backend"
FRONTEND_SCREEN="toefl_trainer_frontend"

usage() {
  cat <<EOF
Usage: scripts/start_mac_dev.sh [--status|--stop|--open]

Starts TOEFL Trainer on this Mac:
  - backend:  http://127.0.0.1:${BACKEND_PORT}
  - frontend: http://127.0.0.1:${FRONTEND_PORT}
  - SQLite:   data/toefl_repeat.sqlite3 by default
  - audio:    attempts/ by default

Options:
  --status  Show local service status
  --stop    Stop local backend/frontend processes on the fixed ports
  --open    Open the browser after starting
EOF
}

ensure_dirs() {
  mkdir -p "$LOG_DIR" "$ROOT_DIR/data" "$ROOT_DIR/attempts" "$ROOT_DIR/data/audio/generated" "$LAUNCH_DIR"
}

port_pid() {
  local port="$1"
  lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

wait_for_url() {
  local url="$1"
  local attempts="${2:-30}"
  for _ in $(seq 1 "$attempts"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

show_status() {
  local backend_pid frontend_pid
  backend_pid="$(port_pid "$BACKEND_PORT")"
  frontend_pid="$(port_pid "$FRONTEND_PORT")"
  echo "TOEFL Trainer Mac local status"
  echo "  backend  : ${backend_pid:-stopped} on ${BACKEND_PORT}"
  echo "  frontend : ${frontend_pid:-stopped} on ${FRONTEND_PORT}"
  echo "  app      : $APP_URL"
  echo "  database : $ROOT_DIR/data/toefl_repeat.sqlite3"
  echo "  attempts : $ROOT_DIR/attempts"
  echo "  logs     : $LOG_DIR"
}

stop_local() {
  local pid
  launchctl bootout "$LAUNCH_DOMAIN" "$BACKEND_PLIST" >/dev/null 2>&1 || true
  launchctl bootout "$LAUNCH_DOMAIN" "$FRONTEND_PLIST" >/dev/null 2>&1 || true
  screen -S "$BACKEND_SCREEN" -X quit >/dev/null 2>&1 || true
  screen -S "$FRONTEND_SCREEN" -X quit >/dev/null 2>&1 || true
  for port in "$FRONTEND_PORT" "$BACKEND_PORT"; do
    pid="$(port_pid "$port")"
    if [[ -n "$pid" ]]; then
      echo "Stopping process $pid on port $port"
      kill "$pid" 2>/dev/null || true
    fi
  done
}

write_launch_agents() {
  python3 - "$ROOT_DIR" "$BACKEND_PORT" "$FRONTEND_PORT" "$BACKEND_PLIST" "$FRONTEND_PLIST" "$BACKEND_LABEL" "$FRONTEND_LABEL" "$BACKEND_LOG" "$FRONTEND_LOG" <<'PY'
from pathlib import Path
import plistlib
import sys

root, backend_port, frontend_port, backend_plist, frontend_plist, backend_label, frontend_label, backend_log, frontend_log = sys.argv[1:]
common_env = {
    "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
}
backend = {
    "Label": backend_label,
    "ProgramArguments": [
        "/bin/bash",
        f"{root}/scripts/mac_service.sh",
        "backend",
        backend_port,
    ],
    "WorkingDirectory": root,
    "EnvironmentVariables": {
        **common_env,
        "APP_DATABASE_PATH": "data/toefl_repeat.sqlite3",
        "APP_ATTEMPTS_DIR": "attempts",
        "APP_PROMPT_AUDIO_DIR": "data/audio/generated",
    },
    "RunAtLoad": True,
    "KeepAlive": {"SuccessfulExit": False},
    "StandardOutPath": backend_log,
    "StandardErrorPath": backend_log,
}
frontend = {
    "Label": frontend_label,
    "ProgramArguments": [
        "/bin/bash",
        f"{root}/scripts/mac_service.sh",
        "frontend",
        frontend_port,
    ],
    "WorkingDirectory": root,
    "EnvironmentVariables": common_env,
    "RunAtLoad": True,
    "KeepAlive": {"SuccessfulExit": False},
    "StandardOutPath": frontend_log,
    "StandardErrorPath": frontend_log,
}
for path, data in [(backend_plist, backend), (frontend_plist, frontend)]:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with Path(path).open("wb") as fh:
        plistlib.dump(data, fh)
PY
}

start_launch_agent() {
  local label="$1"
  local plist="$2"
  launchctl bootout "$LAUNCH_DOMAIN" "$plist" >/dev/null 2>&1 || true
  launchctl bootstrap "$LAUNCH_DOMAIN" "$plist"
  launchctl kickstart -k "$LAUNCH_DOMAIN/$label" >/dev/null 2>&1 || true
}

check_dependencies() {
  local missing=0
  if [[ ! -x "$ROOT_DIR/.venv/bin/python" ]]; then
    echo "Missing .venv/bin/python. Create the venv and install backend requirements first."
    missing=1
  fi
  if [[ ! -d "$ROOT_DIR/frontend/node_modules" ]]; then
    echo "Missing frontend/node_modules. Run npm --prefix frontend install first."
    missing=1
  fi
  if [[ ! -f "$ROOT_DIR/.env" ]]; then
    echo "Missing .env. Copy .env.example to .env and add Azure/DeepSeek keys if needed."
    missing=1
  fi
  if [[ "$missing" -ne 0 ]]; then
    exit 1
  fi
}

start_backend() {
  if [[ -n "$(port_pid "$BACKEND_PORT")" ]]; then
    echo "Backend already listening on $BACKEND_PORT"
    return
  fi
  echo "Starting backend on $BACKEND_PORT"
  screen -dmS "$BACKEND_SCREEN" /bin/bash -lc "exec \"$ROOT_DIR/scripts/mac_service.sh\" backend \"$BACKEND_PORT\" >> \"$BACKEND_LOG\" 2>&1"
}

start_frontend() {
  if [[ -n "$(port_pid "$FRONTEND_PORT")" ]]; then
    echo "Frontend already listening on $FRONTEND_PORT"
    return
  fi
  echo "Starting frontend on $FRONTEND_PORT"
  screen -dmS "$FRONTEND_SCREEN" /bin/bash -lc "exec \"$ROOT_DIR/scripts/mac_service.sh\" frontend \"$FRONTEND_PORT\" >> \"$FRONTEND_LOG\" 2>&1"
}

main() {
  local open_browser=0
  case "${1:-}" in
    -h|--help)
      usage
      exit 0
      ;;
    --status)
      show_status
      exit 0
      ;;
    --stop)
      stop_local
      show_status
      exit 0
      ;;
    --open)
      open_browser=1
      ;;
    "")
      ;;
    *)
      usage
      exit 1
      ;;
  esac

  ensure_dirs
  check_dependencies
  start_backend
  start_frontend

  if ! wait_for_url "http://127.0.0.1:${BACKEND_PORT}/api/health" 30; then
    echo "Backend did not become healthy. See $BACKEND_LOG"
    exit 1
  fi
  if ! wait_for_url "$APP_URL" 30; then
    echo "Frontend did not become reachable. See $FRONTEND_LOG"
    exit 1
  fi

  show_status
  if [[ "$open_browser" -eq 1 ]]; then
    open "$APP_URL"
  fi
}

main "$@"
