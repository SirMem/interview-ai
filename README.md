# SolveWatch AI

AI-powered overlay for live technical interviews — transcribes interviewer speech, classifies questions, and streams concise answers automatically.

---

## Prerequisites

- macOS (Apple Silicon recommended for on-device STT)
- API key for at least one AI provider: OpenAI, Groq, or Gemini

---

## First-time setup

```bash
./start.sh --setup
```

This single command installs everything:

| Step | What it does |
|------|-------------|
| Homebrew | Installs if missing |
| Node.js | Via Homebrew |
| Python 3 | Via Homebrew |
| Ollama | Via Homebrew → pulls `llama3.2:1b` (~1.3 GB, free local question classifier) |
| npm packages | `npm install` |
| Python venv | Creates `transcriber/venv` and installs all pip deps (`mlx-whisper`, `openai`, `webrtcvad`, etc.) |

> **`--setup-only`** — install everything but don't start services.

---

## Configure API keys

After setup, open the settings page in your browser:

```
http://localhost:4000/settings
```

Or edit `config/api-keys.json` directly. You need at least one key for AI answers:

| Provider | Where to get a key |
|----------|-------------------|
| OpenAI | platform.openai.com/api-keys |
| Groq (free tier) | console.groq.com/keys |
| Gemini | aistudio.google.com/app/apikey |

---

## Run

```bash
./start.sh
```

Starts three services:

| Service | Port | Logs |
|---------|------|------|
| Node.js backend | 4000 | `logs/node.log` |
| Python transcriber | 8000 | `logs/transcriber.log` |
| Electron HUD | — | `logs/electron.log` |

Stop everything: **Ctrl+C** (also stops Ollama if this script started it).

---

## Usage

1. **Toggle HUD overlay:** `Cmd+Shift+H`
2. Click **Listener** in the HUD to enable the always-on microphone
3. Interviewer speaks → audio is transcribed → question is classified → answer streams automatically in the HUD card
4. Newest questions appear at the **top** of the queue

### Settings page (`http://localhost:4000/settings`)

| Setting | Options |
|---------|---------|
| STT model | Local MLX Whisper (tiny / base / small / medium / large) or OpenAI Whisper API |
| Question classifier | Local Ollama (free, unlimited) or any remote provider |
| Answer provider | Auto fallback chain, Ollama local, or a specific remote provider |
| HUD opacity | 0 = fully opaque → 90 = near-invisible (live preview) |

---

## STT model behaviour

MLX Whisper models are downloaded from HuggingFace **on first use**, not during setup.

- Selecting `small` (default) — already cached after first run
- Selecting `large` — silently downloads ~1.5 GB on the first transcription attempt; the HUD will be quiet during the download
- Watch `logs/transcriber.log` for download progress

---

## Stack

- **Backend:** Node.js · Express · Socket.IO
- **Desktop:** Electron
- **Transcription:** Python · FastAPI · MLX Whisper (on-device) · OpenAI Whisper API
- **Question classifier:** Ollama (`llama3.2:1b` default) · OpenAI / Groq / Gemini fallback
- **AI answers:** OpenAI · Groq · Gemini (configurable, with automatic fallback)
