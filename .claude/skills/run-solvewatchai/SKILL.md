---
name: run-solvewatchai
description: Build, run, and drive the SolveWatch AI interview assistant. Starts the Node.js backend, optionally the Python transcriber, and performs smoke tests. Use when asked to start, build, test, screenshot, or interact with SolveWatch AI.
---

SolveWatch AI is a real-time interview assistant: speech-to-text via Python Whisper → AI answer via channel-based scheduling → streaming overlay via Electron HUD. The core testable service is the Node.js backend (Express + Socket.IO, port 4000). The Python transcriber (port 8000) and Electron HUD are optional companions.

An agent drives the backend via `curl` — there is no GUI to screenshot (the HUD is Electron but requires a display). All paths below are relative to the repo root `F:/solveWatchAi/`.

## Prerequisites

```bash
# Node.js 20+ is required (v22.22.0 tested)
node --version  # v22.22.0

# Python 3.11+ with uv for the transcriber
python --version  # 3.13.5
uv --version     # 0.8.22+
```

Dependencies are managed by npm and uv:

```bash
# Node dependencies (already installed)
npm install --silent
# Python virtual environment (already set up)
cd transcriber && uv venv venv && uv pip install -r requirements-windows.txt && cd ..
```

## Setup

create `.env` from the example if it doesn't exist:

```bash
cp .env.example .env 2>/dev/null || echo ".env already exists"
```

Key env vars (all have defaults):

| Variable | Default | Notes |
|---|---|---|
| `PORT` | 4000 | Node.js server port |
| `OLLAMA_ENABLED` | false | Must be `false` since Ollama was removed |
| `STT_MODEL` | small | Whisper model for Python transcriber |
| `AUDIO_SOURCE_MODE` | mic | `mic` or `system` (WASAPI loopback on Windows) |

## Build

No build step needed for the Node.js backend:

```bash
# Verify import works
node -e "import('./src/server.js')" 2>&1 | head -3
```

## Run (agent path)

### 1. Start the Node.js backend

Launch in background and wait for readiness:

```bash
cd "F:/solveWatchAi"
node src/server.js &
SERVER_PID=$!

# Wait up to 30s for the server to be ready
for i in $(seq 1 30); do
  curl -sf http://localhost:4000/settings > /dev/null 2>&1 && break
  sleep 1
done
```

Verify the server is up:

```bash
curl -s http://localhost:4000/settings | head -5
# → <!DOCTYPE html>
# → <html lang="en">
```

### 2. Channel API smoke test

```bash
# List channels (should be empty or show existing)
curl -s http://localhost:4000/api/channels

# Create a test channel
curl -s -X POST http://localhost:4000/api/channels \
  -H "Content-Type: application/json" \
  -d '{"name":"TestAPI","serviceType":"openai-compatible","apiKeys":["sk-test"],"model":"gpt-4o-mini","priority":10}'

# Verify it was created
curl -s http://localhost:4000/api/channels | python -c "import json,sys; d=json.load(sys.stdin); print(f'{len(d[\"channels\"])} channel(s)')"

# Delete test channel
curl -s -X DELETE http://localhost:4000/api/channels/TestAPI
```

### 3. Config endpoint smoke test

```bash
# Get full config (no providers = channels manage this)
curl -s http://localhost:4000/api/config/full | python -c "
import json,sys
d=json.load(sys.stdin)
print(f'STT model: {d.get(\"stt_model\")}')
print(f'Audio source: {d.get(\"audio_source_mode\")}')
print(f'Settings page path: {d.get(\"screenshots_path\")}')
"
```

### 4. Audio device proxy (requires Python transcriber running)

```bash
# Start Python transcriber in background (optional)
cd "F:/solveWatchAi/transcriber"
VIRTUAL_ENV="venv" uv run python main.py &
PY_PID=$!
sleep 8

# Test the audio device endpoint
curl -s http://localhost:4000/api/config/audio-devices | python -c "
import json,sys
d=json.load(sys.stdin)
print(f'Devices: {len(d.get(\"devices\",[]))}')
print(f'Loopback available: {d.get(\"loopback_available\",False)}')
print(f'Current mode: {d.get(\"current_mode\")}')
"
```

### 5. Verify the Electron HUD can start (headless)

```bash
# The HUD requires a display, but verify the entrypoint parses:
node -e "import('./electron/main.js')" 2>&1 | head -5
```

### 6. Stop

```bash
kill $SERVER_PID 2>/dev/null
kill $PY_PID 2>/dev/null
pkill -f "node src/server.js" 2>/dev/null
pkill -f "python main.py" 2>/dev/null
```

## Run (human path)

Start three services in separate terminals:

```powershell
# Terminal 1: Node.js backend
cd F:\solveWatchAi
node src\server.js

# Terminal 2: Python transcriber
cd F:\solveWatchAi\transcriber
uv run python main.py

# Terminal 3: Electron HUD
cd F:\solveWatchAi
npx electron electron\main.js
```

Then open `http://localhost:4000/settings` in a browser.

## Key endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/settings` | GET | Settings page HTML |
| `/api/channels` | GET/POST | List / create channels |
| `/api/channels/:name` | PUT/DELETE | Update / delete channel |
| `/api/channels/:name/status` | PATCH | Toggle channel status |
| `/api/channels/test` | POST | Test channel connectivity |
| `/api/channels/reorder` | POST | Reorder channels |
| `/api/channels/:name/models` | GET | List models for a channel |
| `/api/config/full` | GET/POST | Read / write full config |
| `/api/config/audio-devices` | GET | List audio input devices |
| `/config/audio-devices` | GET | Proxy to Python (from Node) |
| `/data-updates` | WS | Socket.IO namespace for real-time data |

## Gotchas

- **Windows-only WASAPI loopback**: The `system_audio_capture.py` module depends on `pyaudiowpatch`, which is Windows-only. On macOS/Linux it will fall back to mic mode.
- **Python transcriber model download**: First start downloads the Whisper model (~460MB for `small`) to `~/.cache/whisper/`. Set `XDG_CACHE_HOME` to redirect to a different drive.
- **Port conflicts**: If port 4000 is in use, kill the existing process or set `PORT=4001` in `.env`.
- **Ollama was removed**: The old Ollama summarization fallback has been completely removed. Summarization no longer happens.

## Troubleshooting

- **`EADDRINUSE: address already in use :4000`**: Another process is on port 4000. Run `cmd //c "netstat -ano | findstr :4000"` to find the PID, then `taskkill /F /PID <PID>`.
- **`Module not found: sounddevice`**: Python venv not activated. Run `cd transcriber && VIRTUAL_ENV="venv" uv run python main.py`.
- **`Invalid device [PaErrorCode -9996]`**: Audio device index changed. Use device name (not index) in `AUDIO_INPUT_SOURCE`. This was fixed — should no longer occur.
- **`delta.reasoning_content` not being streamed**: This was fixed to fall back to `reasoning_content` when `content` is empty. If it still fails, check the channel's model name matches the API.
