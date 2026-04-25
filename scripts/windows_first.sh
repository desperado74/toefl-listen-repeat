#!/usr/bin/env bash
set -euo pipefail

REMOTE="${TOEFL_WIN_SSH:-toefl-win}"
REMOTE_PROJECT="${TOEFL_WIN_PROJECT:-D:\\Projects\\toefl-listen-repeat}"
API_BASE="${TOEFL_API_BASE:-http://127.0.0.1:8000}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage: scripts/windows_first.sh <command>

Commands:
  sync              Copy source/docs/data files from this Mac workspace to Windows
  build             Run frontend production build on Windows
  compile           Compile backend Python files on Windows
  validate-listen   Validate the Listen and Repeat bank on Windows
  validate-interview Validate the Interview bank on Windows
  validate-reading  Validate the Reading bank on Windows
  smoke-reading     Smoke test Reading APIs on Windows backend
  check             Run build, compile, validate-listen, validate-interview, validate-reading, and smoke-reading

Environment:
  TOEFL_WIN_SSH       SSH alias or host. Default: toefl-win
  TOEFL_WIN_PROJECT   Windows project path. Default: D:\Projects\toefl-listen-repeat
  TOEFL_API_BASE      Backend API base for smoke-reading. Default: http://127.0.0.1:8000
EOF
}

powershell_quote() {
  printf "'%s'" "${1//\'/\'\'}"
}

remote_ps() {
  local command="$1"
  local project
  project="$(powershell_quote "$REMOTE_PROJECT")"
  ssh "$REMOTE" "powershell -NoProfile -ExecutionPolicy Bypass -Command \"Set-Location -LiteralPath $project; $command\""
}

sync_sources() {
  local project
  project="$(powershell_quote "$REMOTE_PROJECT")"
  cd "$ROOT_DIR"
  COPYFILE_DISABLE=1 tar -cf - \
    --exclude "frontend/node_modules" \
    --exclude "frontend/dist" \
    --exclude "node_modules" \
    --exclude ".git" \
    --exclude ".venv" \
    --exclude "__pycache__" \
    --exclude "._*" \
    --exclude "*.pyc" \
    backend frontend data/interview data/reading data/scenarios data/tools docs scripts README.md .gitignore \
    | ssh "$REMOTE" "powershell -NoProfile -ExecutionPolicy Bypass -Command \"New-Item -ItemType Directory -Force -Path $project | Out-Null; tar -xf - -C $project; Get-ChildItem -LiteralPath $project -Recurse -Force -Filter '._*' | Remove-Item -Force\""
}

smoke_reading() {
  local api
  api="$(powershell_quote "$API_BASE")"
  remote_ps "\$api = $api; \
    \$setsResponse = Invoke-RestMethod -Uri \"\$api/api/reading/sets\"; \
    if (-not \$setsResponse.sets -or \$setsResponse.sets.Count -lt 1) { throw 'No reading sets returned' }; \
    \$set = \$setsResponse.sets[0]; \
    \$detail = Invoke-RestMethod -Uri \"\$api/api/reading/sets/\$([uri]::EscapeDataString(\$set.id))\"; \
    \$answers = @{}; \
    foreach (\$section in \$detail.set.sections) { \
      if (\$section.type -eq 'complete_words') { \
        foreach (\$blank in \$section.blanks) { \$answers[\$blank.id] = \$blank.answer } \
      } else { \
        foreach (\$question in \$section.questions) { \$answers[\$question.id] = 0 } \
      } \
    }; \
    \$payload = @{ setId = \$set.id; answers = \$answers; elapsedMs = 60000 } | ConvertTo-Json -Depth 8; \
    \$attempt = Invoke-RestMethod -Method Post -Uri \"\$api/api/reading/attempts\" -ContentType 'application/json' -Body \$payload; \
    if (-not \$attempt.result -or \$attempt.result.total -lt 1) { throw 'Reading attempt did not return a scored result' }; \
    Write-Output ('Reading API smoke OK: {0} sets, first attempt total={1}, accuracy={2}%' -f \$setsResponse.sets.Count, \$attempt.result.total, \$attempt.result.accuracy)"
}

case "${1:-}" in
  sync)
    sync_sources
    ;;
  build)
    remote_ps "npm --prefix frontend run build"
    ;;
  compile)
    remote_ps ".\\.venv\\Scripts\\python.exe -m compileall backend\\app"
    ;;
  validate-reading)
    remote_ps ".\\.venv\\Scripts\\python.exe data\\tools\\validate_reading_bank.py"
    ;;
  validate-listen)
    remote_ps ".\\.venv\\Scripts\\python.exe data\\tools\\validate_listen_repeat_bank.py"
    ;;
  validate-interview)
    remote_ps ".\\.venv\\Scripts\\python.exe data\\tools\\validate_interview_bank.py"
    ;;
  smoke-reading)
    smoke_reading
    ;;
  check)
    remote_ps "npm --prefix frontend run build"
    remote_ps ".\\.venv\\Scripts\\python.exe -m compileall backend\\app"
    remote_ps ".\\.venv\\Scripts\\python.exe data\\tools\\validate_listen_repeat_bank.py"
    remote_ps ".\\.venv\\Scripts\\python.exe data\\tools\\validate_interview_bank.py"
    remote_ps ".\\.venv\\Scripts\\python.exe data\\tools\\validate_reading_bank.py"
    smoke_reading
    ;;
  ""|-h|--help|help)
    usage
    ;;
  *)
    usage
    exit 2
    ;;
esac
