# SolveWatchAi

An AI-powered desktop assistant that monitors your screen, extracts text via OCR, and delivers real-time AI-generated solutions during coding interviews and technical assessments.

---

## Features

### Screenshot Monitoring
Continuously monitors your screen and captures screenshots on mouse click. Extracted text is sent to AI automatically.

**Usage:** Start the server — monitoring begins immediately. Click anywhere on screen to trigger a capture.

### Multi-Provider AI with Fallback
Supports OpenAI, Groq, and Google Gemini. If one provider fails or is rate-limited, it automatically falls back to the next.

**Usage:** Configure providers and fallback order in `backend/config/api-keys.json`. Set API keys in `.env`.

### Prompt Types
Context-aware prompts for different scenarios:
- `coding` — Solve coding problems
- `debug` — Debug code with optional screenshot context
- `theory` — Explain theoretical concepts
- `transcription` — Answer interview questions from audio (default)

**Usage:** Pass `promptType` in API requests or transcription events.

### Electron Overlay HUD
A floating, always-on-top desktop overlay for accessing the assistant without leaving your current window.

**Usage:** Run `npm run hud` to launch. Toggle visibility with `Cmd+Shift+H`.

### Real-time Audio Transcription
Optional Python service that records audio, converts speech to text, and sends transcribed questions to the backend for AI answers.

**Usage:** Run the Python transcriber in `/transcriber`. It connects to the Node backend via WebSocket automatically.

### Context Mode
Uses previous AI responses as context for follow-up questions.

**Usage:** Toggle via `POST /api/context-state` with `{ "enabled": true }`.

### WebSocket Live Updates
Real-time status events pushed to connected clients (OCR started, AI processing, response ready).

**Usage:** Connect to `ws://localhost:4000` and listen for events on the `data-updates` channel.

---

## Setup

**1. Configure API keys**
```bash
cp .env.example .env                                    # Add your OpenAI / Groq / Gemini keys
cp api-keys.json.example backend/config/api-keys.json   # Set provider order and fallback
```

**2. Install dependencies**
```bash
npm install
```

**3. Start everything**
```bash
./start.sh              # Starts Node backend + Python transcriber + Electron HUD
./start.sh small        # Optional: specify Whisper model (tiny | base | small | medium | large)
```

This single script starts all three services, waits for the backend to be ready, streams live logs from each service, and shuts everything down cleanly on `Ctrl+C`.

**Logs** are written to `logs/node.log`, `logs/transcriber.log`, and `logs/electron.log`.

**Alternatively, start services individually:**
```bash
npm start               # Node backend only (port 4000)
npm run hud             # Electron overlay only
cd transcriber && python main.py  # Python transcriber only
```

---

## Stack

- **Backend:** Node.js, Express, Socket.IO, Tesseract.js
- **Desktop:** Electron
- **AI Providers:** OpenAI, Groq, Google Gemini
- **Transcription:** Python, FastAPI
- **Image Processing:** Sharp
