#!/bin/bash
# photopea-rembg (v2) launcher — fully in-browser inference.
# Starts the static plugin server (if not running) and opens Photopea
# with the plugin registered.

set -euo pipefail

PORT=7001
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
PIDFILE="$PROJECT_DIR/.server.pid"
LOGFILE="$PROJECT_DIR/.server.log"

BASE_URL="https://localhost:$PORT"
CONFIG='{"environment":{"plugins":[{"name":"rembg – Remove Background","url":"'"$BASE_URL"'","icon":"'"$BASE_URL/icon.svg"'"}]}}'
PHOTOPEA_URL="https://www.photopea.com#$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$CONFIG")"

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
  nohup python3 "$PROJECT_DIR/serve.py" --port "$PORT" > "$LOGFILE" 2>&1 &
  echo $! > "$PIDFILE"
  for i in $(seq 1 20); do
    if curl -sk "$BASE_URL/index.html" >/dev/null 2>&1; then
      echo "Server is ready."
      return 0
    fi
    sleep 0.25
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

if ! is_running; then
  start_server
else
  echo "Server already running (PID $(cat "$PIDFILE"))"
fi

echo
echo "Note: on first use, visit $BASE_URL and accept the self-signed cert."
xdg-open "$PHOTOPEA_URL"
