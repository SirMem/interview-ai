# SolveWatch AI — Claude Code Context

> Real-time AI interview assistant: screen capture → OCR → multi-provider AI → streaming overlay.
> Three services run together: Node.js backend, Python transcriber, Electron HUD.

---

## Creating Pull Requests — Required Checklist

Before opening any PR, you MUST complete both steps in order:

1. **Update `CHANGELOG.md`** — add an entry under the correct version (follow [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format: Added / Changed / Fixed / Removed). Commit this on the feature branch before creating the PR.

2. **Fill out `.github/PULL_REQUEST_TEMPLATE.md`** — every section must be completed:
   - **Summary**: 1–3 bullet points describing what the PR does
   - **Type of change**: check all that apply
   - **Affected components**: check every component touched
   - **Testing**: check each item you verified; describe how you tested
   - **Notes for reviewers**: highlight anything non-obvious, risky, or requiring special attention

Only after both are done should you run `gh pr create`. Pass the full filled-out template body via `--body`.

---

## Code Exploration — Two Graph Tools Available, Pick the Right One

This repo has **both** `code-review-graph` MCP and `graphify` available. Use whichever fits the task best. Direct file reads are a last resort.

### Tool selection guide

| Task | Best tool |
|------|-----------|
| "What does X do?" / quick lookup | `code-review-graph` → `semantic_search_nodes` |
| Impact of changing a file | `code-review-graph` → `get_impact_radius` |
| Code review (what changed, risk) | `code-review-graph` → `detect_changes` + `get_review_context` |
| Trace callers / callees / imports | `code-review-graph` → `query_graph` |
| First-time architecture exploration | `graphify` → builds visual community graph |
| "Show me clusters / surprising links" | `graphify` → community detection + HTML viz |
| Query an already-built graphify graph | `graphify query "<question>"` |
| Deep-dive a specific known function | Direct `Read` (last resort) |

### code-review-graph (fast, pre-built, structural)

```
# Find what's affected by a change
get_impact_radius_tool(filepath)

# Pull only the context needed for review
get_review_context_tool(files: [affected_files])

# Search semantically instead of grepping everything
semantic_search_nodes_tool(query: "what you're looking for")

# High-level architecture without reading every file
get_architecture_overview_tool()
```

### graphify (visual, community-aware, persistent)

```
/graphify <path>              # build knowledge graph + HTML viz
/graphify query "<question>"  # BFS/DFS traversal of existing graph
/graphify <path> --update     # incremental update after code changes
```

graphify output lives at `<path>/graphify-out/graph.html` — open in browser.
The `transcriber/` module already has a built graph at `transcriber/graphify-out/`.

**Why this matters:** `node_modules/` alone has thousands of files. Full scans waste 10–50× more tokens than graph-targeted reads. Always prefer a graph tool over Grep/Glob/Read for exploration.

---

## How to Start the App

**Always use `start.sh` — it manages all three services together.**

```bash
./start.sh                # normal start (Node + Python transcriber + Electron HUD)
./start.sh --setup        # first-time setup: installs all deps, then starts
./start.sh --setup-only   # install deps only, don't start services
./start.sh --newlogs      # clear all logs then start fresh
./start.sh --debug        # enable DEBUG log level for Python transcriber (speaker ID scores, VAD frames)
./start.sh --newlogs --debug  # flags can be combined freely
```

`start.sh` does the following on every run:
1. Reads port from `config/api-keys.json` (default: `4000`)
2. Starts **Ollama** server if not already running (manages lifecycle, kills on Ctrl+C)
3. Reads `stt_model` and `audio_input_device` from config
4. Starts **Node.js backend** → waits for port to be ready
5. Starts **Python transcriber** (Whisper STT) → logs to `logs/transcriber.log`
6. Starts **Electron HUD** overlay
7. Tails `logs/transcriber.log` live in terminal
8. On `Ctrl+C` — gracefully kills all 3 services + Ollama (if it started it)

> **Never start services individually during development** unless testing one in isolation. The services depend on each other via Socket.IO.

**First-time setup installs:**
- Homebrew, Node.js, Python 3 (via brew)
- Ollama + pulls default model (`llama3.2:1b` or value from config)
- `npm install` for Node deps
- Python venv at `transcriber/venv/` + `transcriber/requirements.txt`

**Settings page (after starting):** `http://localhost:4000/settings`
**Toggle HUD:** `Cmd+Shift+H`
**Toggle listen mode:** `Cmd+Shift+X`

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  Electron HUD  (electron/main.js + hud.html)            │
│  • Frameless always-on-top overlay                      │
│  • Connects to Node via Socket.IO (/data-updates)       │
│  • Hotkeys: Cmd+Shift+H (toggle), Cmd+Shift+X (listen) │
└────────────────────┬────────────────────────────────────┘
                     │ Socket.IO ws://localhost:4000
┌────────────────────▼────────────────────────────────────┐
│  Node.js Backend  (src/)                                │
│  Express + Socket.IO                                    │
│  • screenshot-monitor polls for new screenshots         │
│  • OCR (Tesseract) extracts text from images            │
│  • ai.service routes to OpenAI/Groq/Gemini/Anthropic   │
│  • Streams answer tokens back to HUD                    │
└────────────────────┬────────────────────────────────────┘
                     │ HTTP POST /transcription-chunk
┌────────────────────▼────────────────────────────────────┐
│  Python Transcriber  (transcriber/)                     │
│  FastAPI + Whisper + VAD                                │
│  • Always-on mic listener or manual toggle              │
│  • VAD detects speech, Whisper transcribes              │
│  • Pushes chunks to Node via Socket.IO client           │
└─────────────────────────────────────────────────────────┘
                     │ local HTTP
┌────────────────────▼────────────────────────────────────┐
│  Ollama  (http://localhost:11434)                       │
│  • Local LLM for Q&A classification + summarization     │
│  • Default model: llama3.2:1b (fast, 1.3 GB)           │
└─────────────────────────────────────────────────────────┘
```

---

## Project File Map

```
solveWatchAi/
├── start.sh                          # THE entry point — starts everything
├── src/
│   ├── server.js                     # HTTP server bootstrap + Socket.IO init
│   │                                 # Clears logs on every startup
│   │                                 # Starts screenshot-monitor on boot
│   ├── app.js                        # Express factory: middleware, routes, static
│   │                                 # Serves /settings page from src/public/
│   ├── config/
│   │   └── constants.js              # PORT, intervals, shared config
│   ├── routes/
│   │   ├── image.routes.js           # POST /api/image — screenshot ingestion
│   │   ├── context.routes.js         # GET/POST /api/context — session context
│   │   └── config.routes.js          # GET/POST /api/config — provider/model config
│   ├── controllers/
│   │   ├── image.controller.js       # Orchestrates: image → OCR → AI pipeline
│   │   ├── context.controller.js     # Session context CRUD
│   │   └── config.controller.js      # AI provider/model config CRUD
│   ├── services/
│   │   ├── ai.service.js             # Multi-provider AI with fallback chain
│   │   │                             # Watches config + prompts dir for hot-reload
│   │   │                             # Default models: gpt-4o-mini, llama-3.3-70b,
│   │   │                             #   gemini-2.5-flash, claude-sonnet-4-5
│   │   ├── image-processing.service.js # Sharp preprocessing before OCR
│   │   ├── ocr.service.js            # Tesseract + tesseract.js wrapper
│   │   └── screenshot-monitor.service.js # Polling loop for new screenshots
│   ├── sockets/
│   │   ├── dataHandler.js            # Socket.IO /data-updates namespace
│   │   │                             # Two flows: screenshot + manual listen
│   │   │                             # TTL cleanup: 30min expiry, 5min interval
│   │   └── InterviewTranscriptBuffer.js # Per-session Q&A memory (summaries + recentPairs)
│   ├── middleware/
│   │   ├── error.middleware.js       # Global Express error + 404 handler
│   │   └── upload.middleware.js      # Multer config for image uploads
│   ├── public/
│   │   └── settings.html             # Browser settings UI at /settings
│   └── utils/
│       ├── logger.js                 # Structured logger (namespaced)
│       ├── file-logger.js            # Writes structured events to logs/app.jsonl
│       └── memory-logger.js          # In-memory ring buffer for recent logs
├── electron/
│   ├── main.js                       # Electron entry: BrowserWindow + hotkeys + IPC
│   │                                 # Window: 380×460, always-on-top, content-protected
│   │                                 # SOCKET_URL from env (default: http://localhost:4000)
│   ├── preload.js                    # Context bridge for IPC (contextIsolation: true)
│   └── hud.html                      # HUD overlay UI
├── transcriber/                      # Python STT service (standalone)
│   ├── main.py                       # FastAPI app + async NDJSON writer
│   │                                 # Pre-warms MLX Whisper at startup (Metal JIT)
│   ├── transcriber.py                # Whisper model wrapper (_mlx_lock, _transcribe_local)
│   ├── streaming_stt.py              # Rolling buffer + LocalAgreement-2 streaming decoder
│   │                                 # Decodes every 300ms → emits stt_partial / stt_final
│   ├── audio_recorder.py             # Mic capture
│   ├── always_on_listener.py         # VAD state machine + StreamingSTT wiring
│   │                                 # Old flush-on-silence path disabled; feeds StreamingSTT
│   ├── keyboard_handler.py           # Global keyboard shortcut handling
│   ├── socket_client.py              # Pushes events to Node backend
│   │                                 # send_stt_partial(), send_stt_final()
│   ├── question_extractor.py         # Heuristics to detect interview questions
│   ├── config.py                     # SAMPLE_RATE, ports, feature flags
│   ├── log_writer.py                 # Disk log writer
│   └── requirements.txt              # Python deps (Whisper, FastAPI, etc.)
├── prompts/                          # Prompt templates (loaded + hot-reloaded by ai.service)
│   ├── system-prompt.txt             # Screenshot-based answer prompt
│   ├── transcription-prompt.txt      # STT answer prompt
│   ├── interview-answer-prompt.txt   # Direct interview answer
│   ├── coding-prompt.txt
│   ├── debug-prompt.txt
│   ├── theory-prompt.txt
│   └── context-prompt.txt
├── config/
│   └── api-keys.json                 # Runtime config: API keys, port, models, audio device
│                                     # Hot-reloaded by ai.service via fs.watch
├── logs/                             # Auto-created; cleared on every server start
│   ├── app.jsonl                     # Structured NDJSON events from Node
│   ├── memory.jsonl                  # Memory logger output
│   └── transcriber.log               # Python transcriber text log
└── uploads/                          # Temp screenshot files (cleaned up after processing)
```

---

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Runtime | Node.js ESM | `"type": "module"` — always `import/export` |
| HTTP | Express ^5.1.0 | |
| Real-time | Socket.IO ^4.7.2 | Namespace: `/data-updates`, transport: websocket only |
| Desktop | Electron ^33.0.0 | `nodeIntegration: false`, `contextIsolation: true` |
| OCR | Tesseract.js ^6.0.0 + node-tesseract | |
| Image | Sharp ^0.34.5 | Preprocessing before OCR |
| AI — OpenAI | openai ^6.10.0 | Default: `gpt-4o-mini` |
| AI — Groq | groq-sdk ^0.36.0 | Default: `llama-3.3-70b-versatile` |
| AI — Gemini | @google/generative-ai ^0.24.1 | Default: `gemini-2.5-flash` |
| AI — Anthropic | @anthropic-ai/sdk ^0.88.0 | Default: `claude-sonnet-4-5` |
| Local LLM | Ollama (http://localhost:11434) | Classification + summarization only |
| STT | Whisper (via Python) | Model set in config: `stt_model` key |
| VAD | Python VAD lib | In `transcriber/vad/` |
| Clipboard | clipboardy ^5.0.1 | |
| Screenshots | screenshot-desktop ^1.15.1 | |

---

## Two Processing Flows

### Flow 1 — Screenshot (automatic)
```
screenshot-monitor polls uploads/
  → image-processing.service (Sharp enhance)
  → ocr.service (Tesseract extract text)
  → DataHandler emits to /data-updates namespace
  → ai.service.classifyAndAnswerInterviewQuestion()
      uses prompt: system-prompt.txt
  → streams answer_chunk tokens to Electron HUD
  → fires question_answer_complete
  → InterviewTranscriptBuffer.addQAPair(q, a)
```

### Flow 2 — Always-On Listen (Cmd+Shift+X)
```
User presses Cmd+Shift+X
  → Electron sends toggle-listen via IPC
  → HUD emits toggle_listen_mode to Node
  → Node POST /always-on-mode {enabled:true} to Python transcriber
  → AlwaysOnListener.start() → StreamingSTT.start()

While speaker is talking (every 300ms):
  → StreamingSTT re-decodes rolling audio buffer
  → LocalAgreement-2 separates committed / tentative words
  → socket_client.send_stt_partial(committed, tentative)
  → Node relays stt_partial → HUD live strip
      committed words: bright | tentative words: dim/italic

When 700ms silence detected (or Cmd+Shift+X pressed again):
  → StreamingSTT emits stt_final (force_final() on manual stop)
  → Node handleSttFinal() → ai.service.answerInterviewQuestion()
      uses prompt: interview-answer-prompt.txt
  → streams question_answer_token to HUD
  → question_answer_complete
  → InterviewTranscriptBuffer.addQAPair(q, a)

User presses Cmd+Shift+X again (stop):
  → Node POST /always-on-mode {enabled:false}
  → StreamingSTT.force_final() → emits any buffered audio as stt_final
  → AlwaysOnListener.stop() + StreamingSTT.stop()
```

---

## Socket.IO Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `toggle_listen_mode` | Client → Server | Toggle always-on listener on/off |
| `stt_partial` | Python → Node → Client | Streaming partial: `{committed, tentative}` — every 300ms while speaking |
| `stt_final` | Python → Node | Final transcript from StreamingSTT — triggers AI answer |
| `interviewer_question` | Server → Client | Question confirmed: `{questionId, questionText}` — initially raw transcript, updated by `question_text_updated` |
| `question_text_updated` | Server → Client | AI-extracted clean question: `{questionId, questionText}` — replaces raw transcript in question card |
| `question_answer_started` | Server → Client | AI starting to answer: `{questionId}` |
| `question_answer_token` | Server → Client | Streaming AI token: `{token, questionId}` |
| `question_answer_complete` | Server → Client | Answer finished: `{questionId, response}` |
| `transcription_chunk` | Server → Client | Legacy: plain text chunk (manual recording flow only) |
| `answer_chunk` | Server → Client | Streaming AI token (screenshot flow) |
| `context_update` | Client → Server | Update session context |
| `hud-drag-start/move/end` | IPC | Electron window drag |
| `hud-set-opacity` | IPC | Overlay opacity control |
| `toggle-listen` | IPC (main→renderer) | Hotkey forwarded to HUD |

---

## AI Provider System (`ai.service.js`)

- **Fallback chain:** OpenAI → Groq → Gemini → Anthropic (order configurable via `config/api-keys.json`)
- **Config hot-reload:** `fs.watch` on `config/api-keys.json` — no restart needed to change keys or models
- **Prompt hot-reload:** `fs.watch` on `prompts/` directory — edit prompts without restart
- **Failed provider tracking:** providers that error are cooled off before retry
- **Ollama** is only used for: (1) Q&A classification, (2) async conversation summarization

**Default models** (overridable in config):
```json
{ "openai": "gpt-4o-mini", "grok": "llama-3.3-70b-versatile", "gemini": "gemini-2.5-flash", "claude": "claude-sonnet-4-5" }
```

**Prompt type → file mapping:**
```
system         → system-prompt.txt
transcription  → transcription-prompt.txt
interview-answer → interview-answer-prompt.txt
coding         → coding-prompt.txt
debug          → debug-prompt.txt
theory         → theory-prompt.txt
context        → context-prompt.txt
```

---

## Conversation Memory (`InterviewTranscriptBuffer.js`)

Per-session, in-memory only (not persisted to disk).

```javascript
conversationMemory = {
  summaries: [],      // compressed old Q&A batches — max 3, ~150 tokens each
  recentPairs: []     // last 5 raw Q&A pairs — always fresh
}
```

- Every AI call injects summaries + recentPairs into the prompt (~850 token max overhead)
- After `question_answer_complete`: `buffer.addQAPair(question, answer)`
- At 5 `recentPairs`: **async** Ollama summarization → push to `summaries[]`, clear batch
- If Ollama is busy: skip summaries, send raw pairs (non-blocking — never delays an answer)
- `summaries` capped at 3 — drop oldest when exceeded

---

## Electron HUD (`electron/`)

- **Window:** 380×460px, frameless, `backgroundColor: '#12121a'`, always-on-top (`screen-saver` level)
- **Security:** `nodeIntegration: false`, `contextIsolation: true`, IPC via `preload.js` context bridge
- **Content protection:** `setContentProtection(true)` — won't appear in screenshots
- **Multi-monitor:** positions on the display nearest the cursor on show
- **Draggable:** custom drag via `hud-drag-start/move/end` IPC messages
- **Opacity:** `hud-set-opacity` IPC (0 = opaque, 100 = transparent, min 0.1)
- **Socket URL:** `process.env.SOCKET_URL` or `http://localhost:4000`
- **Hotkeys registered in `app.whenReady()`:**
  - `Cmd+Shift+H` → toggle overlay show/hide
  - `Cmd+Shift+X` → send `toggle-listen` to renderer

---

## Python Transcriber (`transcriber/`)

Standalone FastAPI service, managed by `start.sh`. Communicates with Node via Socket.IO client.

| File | Role |
|------|------|
| `main.py` | FastAPI app + async NDJSON writer. Pre-warms MLX Whisper at startup. |
| `transcriber.py` | Whisper model wrapper. `_mlx_lock` (module-level) serializes all Whisper calls. |
| `streaming_stt.py` | **Core streaming engine.** Rolling deque buffer, 300ms decode loop, LocalAgreement-2. Emits `stt_partial` (every step) and `stt_final` (1s silence or `force_final()` on stop). |
| `always_on_listener.py` | VAD state machine feeds audio to `StreamingSTT`. Speaker ID check in `_on_stt_final`. |
| `speaker_id.py` | pyannote-based speaker identification. Enrolls candidate voice, filters it out during interview. |
| `keyboard_handler.py` | Global keyboard shortcut handler |
| `socket_client.py` | Pushes events to Node. Key methods: `send_stt_partial()`, `send_stt_final()` |
| `config.py` | `SAMPLE_RATE`, `API_HOST/PORT`, `LOG_LEVEL`, `HF_TOKEN`, `SPEAKER_ID_THRESHOLD`, feature flags |
| `vad/` | Voice activity detection model |

**Runtime config via env vars (set by `start.sh`):**
```
WHISPER_MODEL=small       # set from config/api-keys.json stt_model key
AUDIO_INPUT_DEVICE=       # set from config/api-keys.json audio_input_device key
LOG_LEVEL=INFO            # set to DEBUG via --debug flag for speaker ID scores + VAD detail
```

**Python venv:** `transcriber/venv/` — created by `start.sh --setup`, synced on every start.

---

## Log Files

All in `logs/` — **auto-cleared on every `node src/server.js` start.**

| File | Format | Content |
|------|--------|---------|
| `logs/app.jsonl` | NDJSON | Structured Node.js events (actions, settings, models) |
| `logs/memory.jsonl` | NDJSON | Memory logger ring buffer output |
| `logs/transcriber.log` | Plain text | Python transcriber output (tailed live by `start.sh`) |

Use `--newlogs` flag on `start.sh` to explicitly clear before starting.

---

## Configuration (`config/api-keys.json`)

Hot-reloaded by `ai.service.js` — no restart needed.

```json
{
  "port": 4000,
  "keys": { "openai": "...", "groq": "...", "gemini": "...", "anthropic": "..." },
  "order": ["openai", "groq", "gemini", "claude"],
  "models": { "openai": "gpt-4o-mini", "grok": "llama-3.3-70b-versatile" },
  "ollama_model": "llama3.2:1b",
  "stt_model": "small",
  "audio_input_device": "",
  "hf_token": "hf_...",
  "speaker_id_threshold": 0.70
}
```

`hf_token` — required for speaker identification (pyannote model). Accept model terms at huggingface.co/pyannote/wespeaker-voxceleb-resnet34-LM first.
`speaker_id_threshold` — cosine similarity cutoff (0.0–1.0). Raise toward 0.80 if your voice leaks through; lower toward 0.60 if interviewer is blocked.

Copy from `config/api-keys.json.example` on first setup. Also configurable at `http://localhost:4000/settings`.

---

## Code Conventions

**Module system:** ESM only — `import/export` everywhere. Never `require()`.

**Naming:**
- Files: `kebab-case.js`
- Classes: `PascalCase` (`DataHandler`, `InterviewTranscriptBuffer`)
- Functions/variables: `camelCase`
- Socket events: `snake_case` strings

**Architecture rules:**
- Services are thin, stateless singletons — export instance or pure functions
- Controllers are thin — all logic in services
- All Socket.IO event logic lives in `dataHandler.js`
- No business logic in `server.js` or `app.js`
- Use `logger.js` for all output — no `console.log` in production paths

**Async:** Always `async/await`. Wrap Socket.IO event handlers in try/catch — unhandled rejections crash Node. Ollama calls must always be fire-and-forget.

---

## What NOT To Do

- **Never** use `require()` — ESM only
- **Never** start services individually with `npm start` when testing full flow — use `start.sh`
- **Never** make Ollama calls synchronous — blocks answer streaming
- **Never** hardcode API keys — always `config/api-keys.json` or `process.env`
- **Never** add state outside of `InterviewTranscriptBuffer` for session memory
- **Never** call `ai.service` directly from routes — go through controllers
- **Never** read `node_modules/` during code review — use `semantic_search_nodes_tool` instead
- **Never** modify `electron/main.js` IPC without updating `electron/preload.js` context bridge

---

## Key Files to Read Before Changing

| Changing... | Read first |
|-------------|-----------|
| AI provider logic | `src/services/ai.service.js` |
| Real-time flow | `src/sockets/dataHandler.js` |
| Session memory | `src/sockets/InterviewTranscriptBuffer.js` |
| Prompts | `prompts/*.txt` (affects ALL AI output quality) |
| Startup sequence | `start.sh` |
| Electron window/hotkeys | `electron/main.js` + `electron/preload.js` |
| STT streaming / LocalAgreement-2 | `transcriber/streaming_stt.py` |
| VAD thresholds / audio loop | `transcriber/config.py` + `transcriber/always_on_listener.py` |
| HUD live strip / token render | `electron/hud.html` |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| OCR returns empty | Sharp contrast too aggressive | Tune `image-processing.service.js` |
| AI answers cut off | Stream not closing | Check `answer_chunk` → `question_answer_complete` sequence in `dataHandler.js` |
| Electron HUD blank | Socket.IO not connected / wrong port | Verify `SOCKET_URL` env and `config/api-keys.json` port match |
| Ollama summarization hangs | Ollama not running | `start.sh` manages it — if running manually, run `ollama serve` |
| Provider fallback not triggering | Error swallowed | Ensure provider methods throw on failure, not silently return |
| Transcriber not starting | Python venv missing | Run `./start.sh --setup` to recreate venv |
| Hotkeys not registering | Another app owns `Cmd+Shift+H` | Check `globalShortcut.register` return value in `electron/main.js:129` |
| Live strip never updates | `stt_partial` not firing | Check `streaming_stt.py` decode loop is running; look for errors in `logs/transcriber.log` |
| No AI answer after speaking | `stt_final` not emitted | Verify 700ms silence passes, or check `force_final()` called on stop; look for `stt_final_emitted` in log |
| Committed words never grow | MLX timestamp jitter | Raise `COMMIT_TS_TOL_S` in `streaming_stt.py` (try `0.5` → `1.0`); or timestamps may be 0 (falls back to text-only match automatically) |
| Hallucinations appearing | RMS gate too low or `no_speech_threshold` too loose | Raise `RMS_GATE` or `no_speech_threshold` in `streaming_stt.py`; check `_HALLUCINATIONS` set in `always_on_listener.py` |
