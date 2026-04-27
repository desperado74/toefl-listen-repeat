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
       scripts/start_windows_dev.sh --self-use
       scripts/start_windows_dev.sh --status
       scripts/start_windows_dev.sh --stop

Ensures the Windows-first dev environment is online:
  - optional source sync to Windows
  - self-use persistent local env on Windows
  - Windows backend on 8000 through a Windows scheduled task
  - Windows frontend on fixed port 5174 through a Windows scheduled task
  - Mac SSH tunnels for 5174 and 8000
  - local health checks from the Mac

Environment:
  TOEFL_WIN_SSH       SSH alias or host. Default: toefl-win
  TOEFL_WIN_PROJECT   Windows project path. Default: D:\Projects\toefl-listen-repeat
  TOEFL_FRONTEND_PORT Frontend dev port. Default: 5174
  TOEFL_BACKEND_PORT  Backend API port. Default: 8000

Self-use mode stores data under the Windows project directory:
  - data\toefl_repeat.sqlite3
  - attempts
  - data\audio\generated
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
Set-Location -LiteralPath \$Project
New-Item -ItemType Directory -Force -Path '.logs' | Out-Null
\$BackendTask = 'TOEFLTrainerBackendDev'
\$FrontendTask = 'TOEFLTrainerFrontendDev'
\$BackendScript = Join-Path \$Project '.logs\\run-backend-dev.ps1'
\$FrontendScript = Join-Path \$Project '.logs\\run-frontend-dev.ps1'
Set-Content -LiteralPath \$BackendScript -Encoding UTF8 -Value @(
  \"Set-Location -LiteralPath '\$Project'\",
  '\$env:PYTHONUNBUFFERED = ''1''',
  \"& '\$Project\\.venv\\Scripts\\python.exe' -m uvicorn backend.app.main:app --host 127.0.0.1 --port \$BackendPort *>> '\$Project\\.logs\\backend.task.log'\"
)
Set-Content -LiteralPath \$FrontendScript -Encoding UTF8 -Value @(
  \"Set-Location -LiteralPath '\$Project'\",
  \"& npm.cmd --prefix frontend run dev -- --host 0.0.0.0 --port \$FrontendPort --strictPort *>> '\$Project\\.logs\\frontend.task.log'\"
)
function Start-DevTask([string]\$Name, [string]\$ScriptPath) {
  \$taskCommand = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"' + \$ScriptPath + '\"'
  schtasks.exe /Create /TN \$Name /SC ONCE /ST 23:59 /F /TR \$taskCommand | Out-Null
  schtasks.exe /Run /TN \$Name | Out-Null
}
if (-not (Test-HttpOk \"http://127.0.0.1:\$BackendPort/api/health\")) {
  Start-DevTask \$BackendTask \$BackendScript
}
if (-not (Test-HttpOk \"http://127.0.0.1:\$FrontendPort/\")) {
  Start-DevTask \$FrontendTask \$FrontendScript
}
Start-Sleep -Seconds 4
\$backendOk = Test-HttpOk \"http://127.0.0.1:\$BackendPort/api/health\"
\$frontendOk = Test-HttpOk \"http://127.0.0.1:\$FrontendPort/\"
\$ports = Get-NetTCPConnection -LocalPort @(\$BackendPort, \$FrontendPort) -ErrorAction SilentlyContinue |
  Where-Object { \$_.State -eq 'Listen' } |
  Select-Object LocalAddress,LocalPort,OwningProcess
\$ports | Format-Table -AutoSize
if (-not \$backendOk) { throw \"Backend is not responding on \$BackendPort\" }
if (-not \$frontendOk) { throw \"Frontend is not responding on \$FrontendPort\" }
Write-Output \"Windows backend service OK: backend=\$BackendPort\"
Write-Output \"Windows frontend service OK: frontend=\$FrontendPort\"
"
}

ensure_self_use_env() {
  local project="$REMOTE_PROJECT"
  remote_ps_encoded "\
\$Project = '$project'
Set-Location -LiteralPath \$Project
New-Item -ItemType Directory -Force -Path 'data', 'attempts', 'data\\audio\\generated', '.logs' | Out-Null
\$EnvPath = Join-Path \$Project '.env'
if (-not (Test-Path -LiteralPath \$EnvPath)) {
  New-Item -ItemType File -Path \$EnvPath | Out-Null
}
function Set-EnvValue([string]\$Name, [string]\$Value) {
  \$lines = @(Get-Content -LiteralPath \$EnvPath -ErrorAction SilentlyContinue)
  \$pattern = '^' + [regex]::Escape(\$Name) + '='
  \$replacement = \$Name + '=' + \$Value
  \$found = \$false
  \$next = foreach (\$line in \$lines) {
    if (\$line -match \$pattern) {
      \$found = \$true
      \$replacement
    } else {
      \$line
    }
  }
  if (-not \$found) { \$next += \$replacement }
  [System.IO.File]::WriteAllLines(\$EnvPath, \$next, [System.Text.UTF8Encoding]::new(\$false))
}
Set-EnvValue 'APP_DATABASE_PATH' 'data/toefl_repeat.sqlite3'
Set-EnvValue 'APP_ATTEMPTS_DIR' 'attempts'
Set-EnvValue 'APP_PROMPT_AUDIO_DIR' 'data/audio/generated'
Set-EnvValue 'APP_FRONTEND_DIST_DIR' 'frontend/dist'
Set-EnvValue 'APP_SESSION_COOKIE_SECURE' '0'
Set-EnvValue 'APP_VISITOR_COOKIE_NAME' 'trainer_visitor'
Write-Output 'Self-use persistent storage configured:'
Write-Output '  APP_DATABASE_PATH=data/toefl_repeat.sqlite3'
Write-Output '  APP_ATTEMPTS_DIR=attempts'
Write-Output '  APP_PROMPT_AUDIO_DIR=data/audio/generated'
"
}

show_status() {
  local project="$REMOTE_PROJECT"
  local frontend_port="$FRONTEND_PORT"
  local backend_port="$BACKEND_PORT"
  remote_ps_encoded "\
\$Project = '$project'
\$FrontendPort = $frontend_port
\$BackendPort = $backend_port
Set-Location -LiteralPath \$Project
Write-Output ('Project: ' + \$Project)
\$backendHealth = 'DOWN'
\$frontendHealth = 'DOWN'
try { \$backendHealth = [string](Invoke-WebRequest -UseBasicParsing -Uri \"http://127.0.0.1:\$BackendPort/api/health\" -TimeoutSec 3).StatusCode } catch {}
try { \$frontendHealth = [string](Invoke-WebRequest -UseBasicParsing -Uri \"http://127.0.0.1:\$FrontendPort/\" -TimeoutSec 3).StatusCode } catch {}
Write-Output ('Backend health: ' + \$backendHealth)
Write-Output ('Frontend health: ' + \$frontendHealth)
\$db = Join-Path \$Project 'data\\toefl_repeat.sqlite3'
\$attempts = Join-Path \$Project 'attempts'
Write-Output ('SQLite exists: ' + (Test-Path -LiteralPath \$db))
if (Test-Path -LiteralPath \$db) { Write-Output ('SQLite path: ' + \$db) }
Write-Output ('Attempts dir exists: ' + (Test-Path -LiteralPath \$attempts))
\$ports = Get-NetTCPConnection -LocalPort @(\$BackendPort, \$FrontendPort) -ErrorAction SilentlyContinue |
  Where-Object { \$_.State -eq 'Listen' } |
  Select-Object LocalAddress,LocalPort,OwningProcess
\$ports | Format-Table -AutoSize
Write-Output 'Scheduled tasks:'
\$tasks = Get-ScheduledTask -TaskName 'TOEFLTrainerBackendDev', 'TOEFLTrainerFrontendDev' -ErrorAction SilentlyContinue |
  Select-Object TaskName, State
if (\$tasks) { \$tasks | Format-Table -AutoSize } else { Write-Output '  none' }
"
}

stop_windows_backend() {
  local backend_port="$BACKEND_PORT"
  remote_ps_encoded "\
\$BackendPort = $backend_port
\$TaskName = 'TOEFLTrainerBackendDev'
schtasks.exe /End /TN \$TaskName 2>\$null | Out-Null
\$connections = @(Get-NetTCPConnection -LocalPort \$BackendPort -State Listen -ErrorAction SilentlyContinue)
\$processIds = \$connections | Select-Object -ExpandProperty OwningProcess -Unique
foreach (\$processId in \$processIds) { Stop-Process -Id \$processId -Force }
"
}

stop_windows_frontend() {
  local frontend_port="$FRONTEND_PORT"
  remote_ps_encoded "\
\$FrontendPort = $frontend_port
\$TaskName = 'TOEFLTrainerFrontendDev'
schtasks.exe /End /TN \$TaskName 2>\$null | Out-Null
\$connections = @(Get-NetTCPConnection -LocalPort \$FrontendPort -State Listen -ErrorAction SilentlyContinue)
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
    ssh -fNn -L "$frontend_port:127.0.0.1:$frontend_port" "$REMOTE"
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
    ssh -fNn \
      -o ExitOnForwardFailure=yes \
      -L "$backend_port:127.0.0.1:$backend_port" \
      "$REMOTE"
  fi
}

ensure_tunnels() {
  ensure_backend_tunnel
  ensure_frontend_tunnel
}

stop_all() {
  stop_windows_backend
  stop_windows_frontend
  kill_local_port "$BACKEND_PORT"
  kill_local_port "$FRONTEND_PORT"
  echo "Stopped Windows dev services and local tunnels."
}

main() {
  case "${1:-}" in
    --help|-h|help)
      usage
      ;;
    --sync)
      "$ROOT_DIR/scripts/windows_first.sh" sync
      ensure_self_use_env
      stop_windows_backend
      stop_windows_frontend
      kill_local_port "$BACKEND_PORT"
      kill_local_port "$FRONTEND_PORT"
      ensure_windows_services
      ensure_tunnels
      wait_for_http "http://127.0.0.1:$BACKEND_PORT/api/health" "Backend tunnel"
      wait_for_http "http://127.0.0.1:$FRONTEND_PORT/" "Frontend tunnel"
      echo "Open: http://127.0.0.1:$FRONTEND_PORT/"
      ;;
    --self-use)
      "$ROOT_DIR/scripts/windows_first.sh" sync
      ensure_self_use_env
      stop_windows_backend
      stop_windows_frontend
      kill_local_port "$BACKEND_PORT"
      kill_local_port "$FRONTEND_PORT"
      ensure_windows_services
      ensure_tunnels
      wait_for_http "http://127.0.0.1:$BACKEND_PORT/api/health" "Backend tunnel"
      wait_for_http "http://127.0.0.1:$FRONTEND_PORT/" "Frontend tunnel"
      show_status
      echo "Open: http://127.0.0.1:$FRONTEND_PORT/"
      ;;
    --status)
      show_status
      ;;
    --stop)
      stop_all
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
