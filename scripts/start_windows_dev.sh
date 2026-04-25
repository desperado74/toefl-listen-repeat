#!/usr/bin/env bash
set -euo pipefail

REMOTE="${TOEFL_WIN_SSH:-toefl-win}"
REMOTE_PROJECT="${TOEFL_WIN_PROJECT:-D:\\Projects\\toefl-listen-repeat}"
FRONTEND_PORT="${TOEFL_FRONTEND_PORT:-5174}"
BACKEND_PORT="${TOEFL_BACKEND_PORT:-8000}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage: scripts/start_windows_dev.sh [--sync]

Ensures the Windows-first dev environment is online:
  - optional source sync to Windows
  - Windows backend on 8000 through a background SSH session
  - Windows frontend on 5174
  - Mac SSH tunnels for 5174 and 8000
  - local health checks from the Mac

Environment:
  TOEFL_WIN_SSH       SSH alias or host. Default: toefl-win
  TOEFL_WIN_PROJECT   Windows project path. Default: D:\Projects\toefl-listen-repeat
  TOEFL_FRONTEND_PORT Frontend dev port. Default: 5174
  TOEFL_BACKEND_PORT  Backend API port. Default: 8000
EOF
}

remote_ps_encoded() {
  local script="$1"
  local encoded
  encoded="$(printf '%s' "\$ProgressPreference = 'SilentlyContinue'
$script" | iconv -t UTF-16LE | base64 | tr -d '\n')"
  ssh "$REMOTE" "powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded"
}

is_local_port_open() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

kill_local_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    kill $pids 2>/dev/null || true
    sleep 1
    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
      kill -9 $pids 2>/dev/null || true
      sleep 1
    fi
  fi
}

wait_for_http() {
  local url="$1"
  local label="$2"
  local attempts="${3:-20}"
  for _ in $(seq 1 "$attempts"); do
    if curl -fsS --max-time 3 "$url" >/dev/null 2>&1; then
      echo "$label OK: $url"
      return 0
    fi
    sleep 1
  done
  echo "$label failed: $url" >&2
  return 1
}

ensure_windows_services() {
  local project="$REMOTE_PROJECT"
  local frontend_port="$FRONTEND_PORT"
  local backend_port="$BACKEND_PORT"
  remote_ps_encoded "\
\$Project = '$project'
\$FrontendPort = $frontend_port
\$BackendPort = $backend_port
function Test-HttpOk([string]\$Url) {
  try {
    \$response = Invoke-WebRequest -UseBasicParsing -Uri \$Url -TimeoutSec 3
    return [int]\$response.StatusCode -ge 200 -and [int]\$response.StatusCode -lt 500
  } catch {
    return \$false
  }
}
function Start-DetachedCmd([string]\$Title, [string]\$Command) {
  Start-Process -FilePath 'C:\\Windows\\System32\\cmd.exe' -ArgumentList '/k', \$Command -WorkingDirectory \$Project -WindowStyle Minimized | Out-Null
}
Set-Location -LiteralPath \$Project
if (-not (Test-HttpOk \"http://127.0.0.1:\$FrontendPort/\")) {
  Start-DetachedCmd 'TOEFL Frontend' \"cd /d \$Project && npm.cmd --prefix frontend run dev\"
}
Start-Sleep -Seconds 4
\$frontendOk = Test-HttpOk \"http://127.0.0.1:\$FrontendPort/\"
\$ports = Get-NetTCPConnection -LocalPort \$FrontendPort -ErrorAction SilentlyContinue |
  Where-Object { \$_.State -eq 'Listen' } |
  Select-Object LocalAddress,LocalPort,OwningProcess
\$ports | Format-Table -AutoSize
if (-not \$frontendOk) { throw \"Frontend is not responding on \$FrontendPort\" }
Write-Output \"Windows frontend service OK: frontend=\$FrontendPort\"
"
}

stop_windows_backend() {
  local backend_port="$BACKEND_PORT"
  remote_ps_encoded "\
\$BackendPort = $backend_port
\$connections = Get-NetTCPConnection -LocalPort \$BackendPort -State Listen -ErrorAction SilentlyContinue
\$processIds = \$connections | Select-Object -ExpandProperty OwningProcess -Unique
foreach (\$processId in \$processIds) { Stop-Process -Id \$processId -Force }
"
}

ensure_frontend_tunnel() {
  local frontend_port="$FRONTEND_PORT"
  if is_local_port_open "$frontend_port"; then
    if ! curl -fsS --max-time 3 "http://127.0.0.1:$frontend_port/" >/dev/null 2>&1; then
      kill_local_port "$frontend_port"
    fi
  fi

  if ! is_local_port_open "$frontend_port"; then
    ssh -fN -L "$frontend_port:127.0.0.1:$frontend_port" "$REMOTE"
  fi
}

ensure_backend_tunnel() {
  local backend_port="$BACKEND_PORT"

  if is_local_port_open "$backend_port"; then
    if ! curl -fsS --max-time 3 "http://127.0.0.1:$backend_port/api/health" >/dev/null 2>&1; then
      kill_local_port "$backend_port"
    fi
  fi

  if ! curl -fsS --max-time 3 "http://127.0.0.1:$backend_port/api/health" >/dev/null 2>&1; then
    stop_windows_backend
    ssh -f \
      -o ExitOnForwardFailure=yes \
      -L "$backend_port:127.0.0.1:$backend_port" \
      "$REMOTE" \
      "powershell -NoProfile -ExecutionPolicy Bypass -Command \"Set-Location -LiteralPath '$REMOTE_PROJECT'; .\\.venv\\Scripts\\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port $backend_port *> backend-tunnel.log\""
  fi
}

ensure_tunnels() {
  ensure_backend_tunnel
  ensure_frontend_tunnel
}

main() {
  case "${1:-}" in
    --help|-h|help)
      usage
      ;;
    --sync)
      "$ROOT_DIR/scripts/windows_first.sh" sync
      stop_windows_backend
      kill_local_port "$BACKEND_PORT"
      ensure_windows_services
      ensure_tunnels
      wait_for_http "http://127.0.0.1:$BACKEND_PORT/api/health" "Backend tunnel"
      wait_for_http "http://127.0.0.1:$FRONTEND_PORT/" "Frontend tunnel"
      echo "Open: http://127.0.0.1:$FRONTEND_PORT/"
      ;;
    "")
      ensure_windows_services
      ensure_tunnels
      wait_for_http "http://127.0.0.1:$BACKEND_PORT/api/health" "Backend tunnel"
      wait_for_http "http://127.0.0.1:$FRONTEND_PORT/" "Frontend tunnel"
      echo "Open: http://127.0.0.1:$FRONTEND_PORT/"
      ;;
    *)
      usage
      exit 2
      ;;
  esac
}

main "$@"
