#!/usr/bin/env bash
# Start all solveWatchAi services: Node.js backend, Python transcriber, Electron HUD
# Usage: ./start.sh [whisper_model]
#   whisper_model: tiny | base (default) | small | medium | large

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

WHISPER_MODEL="${1:-base}"
NODE_PORT=4000
PIDS=()

# ── Colours ────────────────────────────────────────────────────────────────────
RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'
CYAN=$'\033[0;36m'; BOLD=$'\033[1m'; RESET=$'\033[0m'

log()  { echo -e "${CYAN}[start]${RESET} $*"; }
ok()   { echo -e "${GREEN}[  ok ]${RESET} $*"; }
warn() { echo -e "${YELLOW}[ warn]${RESET} $*"; }
die()  { echo -e "${RED}[error]${RESET} $*" >&2; exit 1; }

# ── Cleanup on exit ────────────────────────────────────────────────────────────
cleanup() {
  echo ""
  log "Shutting down all services..."
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  # Give them a moment, then force-kill stragglers
  sleep 1
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
  ok "All services stopped."
}
trap cleanup EXIT INT TERM

# ── Preflight checks ───────────────────────────────────────────────────────────
command -v node   >/dev/null 2>&1 || die "node not found. Install Node.js first."
command -v npm    >/dev/null 2>&1 || die "npm not found."
command -v python3 >/dev/null 2>&1 || die "python3 not found."

# Check electron is installed
if [ ! -f "$SCRIPT_DIR/node_modules/.bin/electron" ]; then
  warn "node_modules missing. Running npm install..."
  npm install --silent
fi

# ── Wait-for-port helper ───────────────────────────────────────────────────────
wait_for_port() {
  local port=$1 label=$2 max_wait=30 elapsed=0
  log "Waiting for $label on port $port..."
  while ! nc -z 127.0.0.1 "$port" 2>/dev/null; do
    sleep 1
    elapsed=$((elapsed + 1))
    if [ "$elapsed" -ge "$max_wait" ]; then
      die "$label did not start within ${max_wait}s. Check logs above."
    fi
  done
  ok "$label is up."
}

# ── Log file setup ─────────────────────────────────────────────────────────────
mkdir -p "$SCRIPT_DIR/logs"
NODE_LOG="$SCRIPT_DIR/logs/node.log"
PYTHON_LOG="$SCRIPT_DIR/logs/transcriber.log"
ELECTRON_LOG="$SCRIPT_DIR/logs/electron.log"

echo -e "\n${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}  solveWatchAi — starting all services${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n"

# ── 1. Node.js backend ─────────────────────────────────────────────────────────
log "Starting Node.js backend (port $NODE_PORT)..."
node src/server.js >"$NODE_LOG" 2>&1 &
NODE_PID=$!
PIDS+=("$NODE_PID")
wait_for_port "$NODE_PORT" "Node.js backend"

# ── 2. Python transcriber ──────────────────────────────────────────────────────
log "Starting Python transcriber (model=$WHISPER_MODEL)..."

TRANSCRIBER_DIR="$SCRIPT_DIR/transcriber"
[ -d "$TRANSCRIBER_DIR" ] || die "transcriber/ directory not found at $TRANSCRIBER_DIR"

# Bootstrap venv if needed (fast no-op if already exists)
if [ ! -d "$TRANSCRIBER_DIR/venv" ]; then
  log "Creating Python virtual environment..."
  python3 -m venv "$TRANSCRIBER_DIR/venv"
  "$TRANSCRIBER_DIR/venv/bin/pip" install -q --upgrade pip
  "$TRANSCRIBER_DIR/venv/bin/pip" install -q -r "$TRANSCRIBER_DIR/requirements.txt"
  ok "Python venv ready."
fi

WHISPER_MODEL="$WHISPER_MODEL" "$TRANSCRIBER_DIR/venv/bin/python" "$TRANSCRIBER_DIR/main.py" \
  >"$PYTHON_LOG" 2>&1 &
PYTHON_PID=$!
PIDS+=("$PYTHON_PID")
ok "Python transcriber started (PID $PYTHON_PID)."

# ── 3. Electron HUD ────────────────────────────────────────────────────────────
log "Starting Electron HUD..."
"$SCRIPT_DIR/node_modules/.bin/electron" electron/main.js \
  >"$ELECTRON_LOG" 2>&1 &
ELECTRON_PID=$!
PIDS+=("$ELECTRON_PID")
ok "Electron HUD started (PID $ELECTRON_PID)."

# ── Status summary ─────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "  ${GREEN}All services running${RESET}"
echo -e "  Node.js      → PID $NODE_PID   logs: logs/node.log"
echo -e "  Transcriber  → PID $PYTHON_PID  logs: logs/transcriber.log"
echo -e "  Electron HUD → PID $ELECTRON_PID  logs: logs/electron.log"
echo -e ""
echo -e "  Toggle HUD:  ${BOLD}Cmd+Shift+H${RESET}"
echo -e "  Stop all:    ${BOLD}Ctrl+C${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n"

# ── Tail logs live ─────────────────────────────────────────────────────────────
# Merge all three log streams with a coloured prefix so you see everything inline
tail -f "$NODE_LOG" | sed "s/^/${CYAN}[node      ]${RESET} /" &
PIDS+=("$!")
tail -f "$PYTHON_LOG" | sed "s/^/${YELLOW}[transcriber]${RESET} /" &
PIDS+=("$!")
tail -f "$ELECTRON_LOG" | sed "s/^/${GREEN}[electron  ]${RESET} /" &
PIDS+=("$!")

# Block until user hits Ctrl+C
wait "$NODE_PID" "$PYTHON_PID" "$ELECTRON_PID"
