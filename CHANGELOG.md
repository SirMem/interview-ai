# Changelog

All notable changes to SolveWatch AI are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [2.0.0] — 2026-04-20

### Added
- **Windows support** — `start.bat` / `start.ps1` for Windows 10/11; openai-whisper fallback when MLX is unavailable
- **Streaming STT with LocalAgreement-2** — committed/tentative word separation; HUD live strip shows words as they're spoken
- **Speaker diarization** — pyannote-based speaker ID filters out the interviewer's voice; enroll via settings
- **Multi-provider AI fallback chain** — OpenAI → Groq → Gemini → Anthropic; configurable order in `api-keys.json`
- **Screenshot analysis flow** — `uploads/` folder polling → Sharp preprocessing → Tesseract OCR → AI answer
- **Conversation memory** — last 5 Q&A pairs + async Ollama summarization (max 3 compressed summaries)
- **Hot-reload config** — change API keys or prompts without restarting any service
- **Web landing page** — FAQ, comparison table, and feature deep-dive pages
- **GitHub community files** — SECURITY.md, issue templates, PR template, CODE_OF_CONDUCT, CONTRIBUTING

### Changed
- Electron HUD: `setContentProtection(true)` now confirmed invisible across Zoom, Meet, Teams, Loom, OBS, Discord Go Live
- `start.sh` now manages full lifecycle: Ollama, Node, Python transcriber, log tailing, and graceful Ctrl+C
- Default Whisper model changed from `base` to `small` for better accuracy
- Prompt system fully externalised to `prompts/` — hot-reloaded via `fs.watch`

### Fixed
- Hallucination filtering via `_HALLUCINATIONS` set in `always_on_listener.py`
- MLX timestamp jitter workaround (`COMMIT_TS_TOL_S`) for committed word detection
- RMS gate prevents near-silence from triggering transcription

---

## [1.0.0] — 2025-12-01

### Added
- Initial release: screenshot monitor + OCR + OpenAI/Groq/Gemini streaming answers
- Electron HUD overlay with always-on-top frameless window
- Basic Whisper transcription via Python FastAPI service
- `start.sh` single-command launcher
- Settings page at `http://localhost:4000/settings`
