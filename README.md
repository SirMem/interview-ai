<div align="center">

<img src="web/public/logo.png" alt="SolveWatch AI" width="80" />

# SolveWatch AI

**Real-time AI interview assistant — invisible to your interviewer**

Live transcription → instant AI answers → stealth HUD overlay

[![CI](https://github.com/parmeet10/solveWatchAi/actions/workflows/ci.yml/badge.svg)](https://github.com/parmeet10/solveWatchAi/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-a855f7.svg)](LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/parmeet10/solveWatchAi?color=a855f7)](https://github.com/parmeet10/solveWatchAi/releases)
[![macOS](https://img.shields.io/badge/macOS-Apple%20Silicon-black?logo=apple)](https://github.com/parmeet10/solveWatchAi)
[![Windows](https://img.shields.io/badge/Windows-10%2F11-0078D4?logo=windows)](https://github.com/parmeet10/solveWatchAi)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)](https://python.org)

</div>

---

## Demo

<div align="center">
  <a href="https://youtu.be/GE15expmqXs">
    <img src="https://img.youtube.com/vi/GE15expmqXs/maxresdefault.jpg" alt="SolveWatch AI Demo" width="700" />
  </a>

  *Click to watch the demo*
</div>

---

## What is SolveWatch?

SolveWatch listens to your interview through your microphone, transcribes questions in real time using on-device Whisper, and streams AI answers into a floating HUD overlay — completely invisible to Zoom, Google Meet, Teams, and every other screen-capture tool.

No browser extension. No cloud audio. Runs on your machine.

---

## Screenshots

<div align="center">

<img src="web/public/hud-appearance.png" alt="SolveWatch HUD overlay" width="700" />

*The HUD overlay — always on top, invisible in screenshare*

</div>

<br/>

<div align="center">
<img src="web/public/aiproviders.png" alt="AI Providers settings" width="700" />

*Settings page — configure providers, fallback chain, and models*
</div>

<br/>

<div align="center">
<img src="web/public/stt-speaker-diarization.png" alt="STT and speaker diarization" width="700" />

*On-device Whisper STT with speaker diarization*
</div>

---

## Features

| | Feature | Details |
|---|---------|---------|
| 🎤 | **On-device STT** | Whisper via Apple MLX (Mac) or openai-whisper (Windows). Zero API key needed for transcription. Fully offline. |
| 👁️ | **Invisible overlay** | `setContentProtection(true)` — same OS API used by banking apps. Excluded from Zoom, Meet, Teams, Loom, OBS, and all screen recording tools. Works for full-screen share, not just window share. |
| ⚡ | **Sub-second answers** | First token in ~200 ms with Groq. Answers stream token-by-token into the HUD while the model is still generating. |
| 🔁 | **Multi-provider fallback** | Configure a cascade: OpenAI → Groq → Gemini → Claude. If one fails or rate-limits, the next kicks in automatically. |
| 🧠 | **Conversation memory** | Remembers the last 3–5 Q&A pairs. Follow-up questions like *"what are its trade-offs?"* work correctly. |
| 📸 | **Screenshot analysis** | Monitors a folder for new screenshots, runs OCR (Tesseract) + AI, and shows the answer in the HUD. Great for coding problems shared on screen. |
| 🔒 | **No telemetry** | Zero analytics, zero crash reports. The only outbound calls are to your own API keys. |
| 🆓 | **Free & open source** | MIT license. Use it for personal and commercial purposes. |

---

## Quick Start

### 1 — First-time setup

```bash
git clone https://github.com/parmeet10/solveWatchAi.git
cd solveWatchAi
./start.sh --setup
```

This installs Homebrew, Node.js, Python, Ollama, and all dependencies — then starts the app.

### 2 — Add your API keys

Open the settings page and paste in at least one key:

```
http://localhost:4000/settings
```

| Provider | Get a key |
|----------|-----------|
| Groq *(fastest — recommended first)* | [console.groq.com/keys](https://console.groq.com/keys) |
| OpenAI | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| Gemini | [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) |
| Claude | [console.anthropic.com/settings/api-keys](https://console.anthropic.com/settings/api-keys) |

### 3 — Start the app

```bash
./start.sh
```

| Shortcut | Action |
|----------|--------|
| `⌘ Shift H` | Toggle HUD on/off |
| `⌘ Shift X` | Toggle listening on/off |

Press `Ctrl+C` to stop all services.

---

## Start flags

```bash
./start.sh                  # normal start
./start.sh --setup          # install deps + start
./start.sh --setup-only     # install deps only
./start.sh --newlogs        # clear logs then start
./start.sh --debug          # verbose Python transcriber output
./start.sh --newlogs --debug  # flags can be combined
```

---

## Architecture

Three services run together, managed by `start.sh`:

```
Microphone
  │
  ▼
┌─────────────────────────────┐
│  Python Transcriber         │  FastAPI + Whisper (MLX / openai-whisper)
│  VAD → rolling buffer       │  LocalAgreement-2 streaming decoder
│  → stt_partial every 300ms  │  On-device, no cloud, no API key
│  → stt_final on silence     │
└────────────┬────────────────┘
             │ Socket.IO
             ▼
┌─────────────────────────────┐
│  Node.js Backend            │  Express + Socket.IO
│  Assembles prompt           │  Multi-provider AI with fallback chain
│  Streams answer tokens ─────┼──► Electron HUD
│  Session memory             │
└─────────────────────────────┘
             │
             ▼
┌─────────────────────────────┐
│  Electron HUD               │  Frameless, always-on-top overlay
│  380×460px                  │  setContentProtection(true)
│  Invisible in screenshare   │  Renders tokens as they stream in
└─────────────────────────────┘
```

**Screenshot flow** runs in parallel: `uploads/` folder → Sharp preprocessing → Tesseract OCR → same AI pipeline → HUD.

---

## How the overlay stays invisible

`setContentProtection(true)` is an OS-level API — the same one used by banking apps and DRM video players.

- **macOS:** maps to `NSWindow.sharingType = NSWindowSharingNone`
- **Windows:** maps to `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)`

These flags tell the OS compositor to exclude the window from **all** capture streams — window capture and full-screen capture alike. The capture tool receives a frame that was never composed with the overlay. Your interviewer sees only your desktop.

Confirmed invisible on: Zoom · Google Meet · Microsoft Teams · Loom · OBS Studio · macOS Screenshot · Windows Snipping Tool · Discord Go Live

---

## vs Cluely / Parakeet

| | **SolveWatch** | Cluely | Parakeet |
|---|---|---|---|
| Price | **Free (MIT)** | $29–49/mo | $20–40/mo |
| API cost | **Your keys only** | Included (their cloud) | Included (their cloud) |
| Open source | ✅ | ❌ | ❌ |
| Offline STT | ✅ | ❌ | ❌ |
| Custom AI provider | ✅ | ❌ | ❌ |
| Response latency | **~200–400 ms** | ~600–1200 ms | ~500–900 ms |
| macOS | ✅ | ✅ | ✅ |
| Windows | ✅ | ✅ | — |

---

## Troubleshooting

**HUD doesn't appear**
Press `⌘ Shift H`. Check the terminal for Electron startup errors.

**No transcription / mic not working**
Go to `System Settings → Privacy → Microphone` and allow Terminal (macOS). Try switching to the `small` Whisper model.

**AI not responding**
Open settings, check at least one provider is enabled, and use the **Test** button to verify the key.

**Screenshot analysis not working**
Set the screenshots folder in settings and confirm it matches where macOS saves screenshots (`System Settings → Screenshots → Save to`).

**Transcriber not starting**
Run `./start.sh --setup` to recreate the Python venv.

**Ollama missing**
Run `./start.sh --setup` — it pulls `llama3.2:1b` automatically.

---

## Configuration

`config/api-keys.json` — hot-reloaded, no restart needed.

```json
{
  "port": 4000,
  "keys": { "openai": "...", "groq": "...", "gemini": "...", "anthropic": "..." },
  "order": ["groq", "openai", "gemini", "claude"],
  "models": { "openai": "gpt-4o-mini", "grok": "llama-3.3-70b-versatile", "gemini": "gemini-2.5-flash" },
  "ollama_model": "llama3.2:1b",
  "stt_model": "small",
  "audio_input_device": "",
  "hf_token": "hf_...",
  "speaker_id_threshold": 0.70
}
```

Copy from `config/api-keys.json.example` on first setup.

---

## Roadmap

Planned features — contributions welcome:

- [ ] Linux support
- [ ] Browser extension mode (no Electron required)
- [ ] Remote AI endpoint / self-hosted LLM support
- [ ] Answer history panel with copy-to-clipboard
- [ ] Custom hotkey configuration in settings UI
- [ ] Automated release builds (DMG for macOS, EXE installer for Windows)

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=parmeet10/solveWatchAi&type=Date)](https://star-history.com/#parmeet10/solveWatchAi&Date)

---

## License

[MIT](./LICENSE) — free for personal and commercial use.
