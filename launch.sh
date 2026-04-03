#!/bin/bash
# Rembg for Photopea — Linux launcher
# Starts the backend server (if not already running) and opens the Photopea URL.
# Double-click the .desktop file or run this script directly.

set -euo pipefail

PORT=7001
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
PIDFILE="$PROJECT_DIR/.server.pid"
LOGFILE="$PROJECT_DIR/.server.log"
PYTHON="$PROJECT_DIR/.venv/bin/python"

BASE_URL="https://localhost:$PORT"
CONFIG='{"environment":{"plugins":[{"name":"rembg – Remove Background","url":"'"$BASE_URL"'","icon":"'"$BASE_URL/icon.svg"'"}]}}'
PHOTOPEA_URL="https://www.photopea.com#$(python3 -c "import urllib.parse; print(urllib.parse.quote('$CONFIG'))")"

is_running() {
  if [ -f "$PIDFILE" ]; then
    local pid
    pid=$(cat "$PIDFILE")
    if kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    rm -f "$PIDFILE"
  fi
  return 1
}

start_server() {
  cd "$PROJECT_DIR"

  # Create venv if needed
  if [ ! -f "$PYTHON" ]; then
    python3 -m venv "$PROJECT_DIR/.venv"
  fi

  # Install deps if needed
  MARKER="$PROJECT_DIR/.venv/.deps-installed"
  REQ="$PROJECT_DIR/backend/requirements.txt"
  if [ ! -f "$MARKER" ] || [ "$REQ" -nt "$MARKER" ]; then
    "$PYTHON" -m pip install -q -r "$REQ"
    echo "ok" > "$MARKER"
  fi

  # Start server in background
  nohup "$PYTHON" "$PROJECT_DIR/backend/server.py" --port "$PORT" \
    > "$LOGFILE" 2>&1 &
  echo $! > "$PIDFILE"

  # Wait for it to be ready (up to 15 seconds)
  echo "Starting rembg server..."
  for i in $(seq 1 30); do
    if curl -sk "$BASE_URL/health" >/dev/null 2>&1; then
      echo "Server is ready!"
      return 0
    fi
    sleep 0.5
  done
  echo "Warning: server may not be ready yet"
}

stop_server() {
  if [ -f "$PIDFILE" ]; then
    local pid
    pid=$(cat "$PIDFILE")
    kill "$pid" 2>/dev/null && echo "Server stopped (PID $pid)" || echo "Server wasn't running"
    rm -f "$PIDFILE"
  else
    echo "No PID file found"
  fi
}

case "${1:-start}" in
  stop)
    stop_server
    exit 0
    ;;
  start|"")
    ;;
  *)
    echo "Usage: $0 [start|stop]"
    exit 1
    ;;
esac

# Start server if not already running
if ! is_running; then
  start_server
else
  echo "Server already running (PID $(cat "$PIDFILE"))"
fi

# Open Photopea with the plugin
xdg-open "$PHOTOPEA_URL"
