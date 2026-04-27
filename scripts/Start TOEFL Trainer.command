#!/bin/zsh
set -e

PROJECT_DIR="/Users/wuliuqi/Documents/New project"
APP_URL="http://127.0.0.1:5174/"

cd "$PROJECT_DIR"

echo "Starting TOEFL Trainer on this Mac..."
echo "Project: $PROJECT_DIR"
echo "URL: $APP_URL"
echo

./scripts/start_mac_dev.sh --open

echo
echo "TOEFL Trainer is ready."
echo
echo "You can close this Terminal window after the browser opens."
echo "Press any key to close."
read -k 1
